import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TOOL_LIMITS, ServerConfig, ToolArtifact, RunState, type ToolCall, type RequestPayload, type ToolResult, type ToolLimits, type ToolJson } from '../../packages/shared/src/index.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import type { ModelAdapter, ModelOutput } from '../../packages/server/src/platform/models/adapter.ts';
import { openAIModel } from '../../packages/server/src/platform/models/openai.ts';
import { composeToolRuntimes, registerTool, ToolActionFailure, type ToolRuntime } from '../../packages/server/src/modules/tools/contract.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { retrievalTool } from '../support/retrieval-tool.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { devRoot, json, exec } from '../../scripts/dev/io.ts';
import { providerResponse, sse, successEvents } from '../helpers/openai.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(get: () => Promise<T>, ready: (value: T) => boolean, attempts = 500): Promise<T> {
  for (let n = 0; n < attempts; n++) { const value = await get(); if (ready(value)) return value; await pause(20); }
  throw new Error('Timed out waiting for tool state');
}
const call = (name: string, args: unknown, callId = randomUUID()): ToolCall => ({ name, callId, arguments: JSON.stringify(args) });
const success = (text = 'fixture'): ToolResult => ({ status: 'success', content: [{ type: 'text', text }], references: [], omissions: [] });
function scripted(round: (request: RequestPayload, signal: AbortSignal) => Promise<ModelOutput | string> | ModelOutput | string): ModelAdapter {
  return { ...deterministicModel, async *stream(request, signal) { yield await round(request, signal); } };
}
const batchModel = (calls: ToolCall[]) => scripted(request => request.tools!.previousOutputIds.length ? 'Finished from saved evidence.' : { kind: 'output', calls });
const fixtureRuntime = (tools: ToolRuntime['tools']): ToolRuntime => ({tools,resources:async()=>[{kind:'fixture',id:'scope',label:'fixture'}],authorize:async()=>({outcome:'allowed',code:'fixture',message:'Fixture scope',configurationRevision:'1',evaluator:'not-performed'})});

test('Inspectable tools: real persistence, dispatch and provider protocol', { timeout: 240000 }, async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ash-tools-'))), source = process.cwd(), checkout = source;
  const defaultRuntime = fixtureRuntime([retrievalTool(async (_run, query) => success(query))]);
  const ws = await workspace(checkout, await devRoot()), instance = await createInstance(ws, 'test', 'empty');
  const cfg = ServerConfig.parse(await json(join(instance.root, 'server.json'))), db = connectProduct(cfg.databaseUrl);
  const services: Threads[] = [];
  const service = (model: ModelAdapter = deterministicModel, runtime: ToolRuntime = defaultRuntime, limits?: ToolLimits, auto = true) => {
    const value = new Threads(db, model, auto, undefined, runtime, limits); services.push(value); return value;
  };
  const settle = async (value: Threads, id: string, attempts = 500) => {
    const row = await db.run.findUniqueOrThrow({ where: { id } });
    const view = await until(() => value.readThread(row.threadId!), view => view.runs.some(run => run.id === id && !['queued', 'running'].includes(run.status)), attempts);
    return view.runs.find(run => run.id === id)!;
  };
  const start = async (value: Threads, text = 'Find source', mode: 'normal' | 'slow' = 'normal') => {
    const thread = randomUUID(); await value.createThread(thread, 'Tool fixture');
    const run = await value.submit(thread, randomUUID(), text, mode); return { thread, run };
  };
  const results = async (runId: string) => {
    const state=RunState.parse((await db.run.findUniqueOrThrow({where:{id:runId}})).state);
    return Promise.all((state.tools?.calls??[]).flatMap(call=>call.resultArtifactId?[call.resultArtifactId]:[]).map(async id=>{
      const payload=ToolArtifact.parse((await db.artifact.findUniqueOrThrow({where:{id}})).payload);
      assert.equal(payload.type,'tool_result');return payload.result;
    }));
  };
  const queryCall = () => call('fixture.search', { query: 'evidence' });
  let acceptanceId = '', opaqueRun = '';
  try {
    await scenarioStep(t, 'TOOL-02', async () => {
      const value = service(batchModel([call('missing.tool', {}), { ...queryCall(), arguments: '{' }, call('fixture.search', { query: 42 })]), defaultRuntime, { ...DEFAULT_TOOL_LIMITS, consecutiveErrors: 5 });
      const { run } = await start(value); await settle(value, run.id);
      assert.deepEqual((await results(run.id)).map(result => result.status), ['error', 'error', 'error']);
      assert.ok(RunState.parse((await db.run.findUniqueOrThrow({ where: { id: run.id } })).state).tools!.calls.every(call => !call.startedAt));
    });
    await scenarioStep(t, 'TOOL-23', async () => {
      const argumentsText='{"extra":'+'['.repeat(10000)+'0'+']'.repeat(10000)+'}';
      const entered:string[]=[];
      const runtime=fixtureRuntime([retrievalTool(async(_run,query)=>{entered.push(query);return success(query);})]);
      const value=service(batchModel([{...queryCall(),arguments:argumentsText},call('fixture.search',{query:'valid after invalid'})]),runtime);
      const {run}=await start(value),done=await settle(value,run.id);
      assert.equal(done.status,'completed',JSON.stringify(done.error));assert.deepEqual(entered,['valid after invalid']);
      const observed=await results(run.id);assert.equal(observed[0].status,'error');assert.equal(observed[0].error.code,'invalid_call');assert.equal(observed[1].status,'success');
      const proposal=ToolArtifact.parse((await db.artifact.findUniqueOrThrow({where:{id:done.state.tools!.calls[0].callArtifactId}})).payload);
      assert.equal(proposal.type,'tool_call');assert.equal(proposal.call.arguments,argumentsText);
      const captured=await db.artifact.findUniqueOrThrow({where:{id:done.state.request_artifact_id}});
      assert.equal((captured.payload as unknown as RequestPayload).tools!.limits.argumentDepth,64);

      const valueSchema:ToolJson={anyOf:[{type:'null'},{$ref:'#/$defs/node'}]};
      const nodeSchema:Record<string,ToolJson>={type:'object',properties:{value:valueSchema},required:['value'],additionalProperties:false};
      let executions=0;
      const recursive=registerTool({
        definition:{...runtime.tools[0].definition,inputSchema:{...nodeSchema,$defs:{node:nodeSchema}}},
        parse(input:unknown){let value=input;while(value!==null){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!('value' in value))throw new TypeError('Expected a node');value=value.value;}return input;},
        async prepare(){return {action:{operation:'fixture.search',effects:['read'],resources:[{kind:'fixture',id:'scope',label:'Fixture'}]}};},
        async execute(){executions++;return success('Depth accepted');},
      });
      for(const depth of [4,64]){
        const tree=(levels:number)=>'{"value":'.repeat(levels)+'null'+'}'.repeat(levels);
        const boundary=service(batchModel([{...queryCall(),arguments:tree(depth+1)},{...queryCall(),arguments:tree(depth)}]),fixtureRuntime([recursive]),{...DEFAULT_TOOL_LIMITS,argumentDepth:depth});
        const started=await start(boundary),finished=await settle(boundary,started.run.id);assert.equal(finished.status,'completed');
        const outcomes=await results(started.run.id);assert.equal(outcomes[0].status,'error');assert.equal(outcomes[0].error.code,'invalid_call');assert.equal(outcomes[1].status,'success');
      }
      assert.equal(executions,2);
    });
    await scenarioStep(t, 'TOOL-06', async () => {
      for(const [execute,code] of [
        [async()=>success('x'.repeat(70000)),'result_limit'],
        [async()=>{throw new ToolActionFailure('fixture_failure','Safe handler message');},'fixture_failure'],
        [async()=>{throw new Error('PRIVATE_EXCEPTION_SENTINEL');},'tool_failed'],
        [async()=>new Promise<ToolResult>(()=>{}),'tool_timeout'],
        [async()=>({status:'success'} as ToolResult),'invalid_call'],
      ] as const) {
        const original=retrievalTool(execute),handler={...original,definition:{...original.definition,limits:{timeoutMs:100,resultBytes:32768}}};
        const fixture=service(batchModel([call('fixture.search',{query:'test'})]),fixtureRuntime([handler])),started=await start(fixture);await settle(fixture,started.run.id);
        const result=(await results(started.run.id))[0];assert.equal(result.status,'error');assert.equal(result.error.code,code);
        assert.doesNotMatch(JSON.stringify(result),/PRIVATE_EXCEPTION_SENTINEL/);
      }
      let executed=false;
      const original=retrievalTool(async()=>{executed=true;return success();});
      const handler={...original,definition:{...original.definition,limits:{timeoutMs:100,resultBytes:32768}}};
      const stalled=service(batchModel([call('fixture.search',{query:'deadline'})]),{...fixtureRuntime([handler]),authorize:async()=>new Promise(()=>{})});
      const started=await start(stalled); await settle(stalled,started.run.id);
      const timedOut=(await results(started.run.id))[0];assert.equal(timedOut.status,'error');assert.equal(timedOut.error.code,'tool_timeout');assert.equal(executed,false);
    });
    await scenarioStep(t, 'TOOL-07', async () => {
      let entered = 0, aborted = 0;
      const retrieval = retrievalTool(async (_run, _query, signal) => { entered++; await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted++; resolve(); }, { once: true })); return success('late'); });
      const runtime: ToolRuntime = { tools: [retrieval], resources: async () => [{ kind: 'fixture', id: 'scope', label: 'fixture' }], authorize: async () => ({ outcome: 'allowed', code: 'fixture', message: 'Fixture scope', configurationRevision: '1', evaluator: 'not-performed' }) };
      const value = service(batchModel([0, 1, 2].map(n => call('fixture.search', { query: String(n) }))), runtime, { ...DEFAULT_TOOL_LIMITS, concurrency: 2 });
      const { run } = await start(value); await until(async () => entered, n => n === 2);
      await value.cancel(run.id); const before = await value.readThread(run.threadId!);
      await until(async () => aborted, n => n === 2); await pause(30);
      assert.equal(entered, 2); assert.deepEqual(await value.readThread(run.threadId!), before);
      assert.equal(before.runs[0].state.tools!.calls[2].status, 'not-started');
      assert.deepEqual(await results(run.id), []);
    });
    await scenarioStep(t, 'TOOL-08', async () => {
      let modelCalls = 0;
      const value = service(scripted(request => { modelCalls++; return request.tools!.previousOutputIds.length ? 'done' : { kind: 'output', calls: [queryCall()] }; }));
      const thread = randomUUID(), key = randomUUID(); await value.createThread(thread, 'duplicate');
      const runs = await Promise.all([value.submit(thread, key, 'source', 'normal'), value.submit(thread, key, 'source', 'normal')]);
      value.dispatch(runs[0].id); value.dispatch(runs[1].id); await settle(value, runs[0].id);
      assert.equal(runs[0].id, runs[1].id); assert.equal(modelCalls, 2); assert.equal((await results(runs[0].id)).length, 1);
      acceptanceId = runs[0].id;
      const duplicate = queryCall(); const bad = service(batchModel([duplicate, duplicate])); const started = await start(bad); const ended = await settle(bad, started.run.id);
      assert.equal(ended.error?.code, 'provider_protocol'); assert.deepEqual(await results(ended.id), []);
    });
    await scenarioStep(t, 'TOOL-09', async () => {
      for (const [bounds, calls, code] of [
        [{ toolCalls: 1 }, [queryCall(), queryCall()], 'tool_call_limit'],
        [{ repeats: 1 }, [queryCall(), queryCall()], 'repetition_limit'],
        [{ totalResultBytes: 512, repeats: 4 }, [queryCall(), queryCall(), queryCall(), queryCall()], 'total_result_limit'],
        [{ consecutiveErrors: 1 }, [call('unknown', {})], 'tool_error_limit'],
        [{ modelCalls: 1 }, [queryCall()], 'model_call_limit'],
      ] as const) {
        const value = service(batchModel([...calls]), defaultRuntime, { ...DEFAULT_TOOL_LIMITS, ...bounds }), { run } = await start(value);
        assert.equal((await settle(value, run.id)).error?.code, code);
      }
    });
    await scenarioStep(t, 'TOOL-10', async () => {
      let invocations = 0;
      const value = service(scripted(() => { invocations++; return 'not dispatched'; }), defaultRuntime, undefined, false);
      const { run } = await start(value); await value.recover();
      assert.equal((await settle(value, run.id)).status, 'interrupted'); assert.equal(invocations, 0);
      const saved = await value.inspect(run.state.request_artifact_id); assert.equal(saved.runs[0].state.response_artifact_id, null);
      let release!:()=>void,entered=false,rounds=0;
      const handler=retrievalTool(async(_run,query)=>{if(query==='pending'){entered=true;await new Promise<void>(resolve=>release=resolve);}return success(query);});
      const live=service(scripted(request=>{rounds++;return request.tools!.previousOutputIds.length?'done':{kind:'output',calls:[call('fixture.search',{query:'done'}),call('fixture.search',{query:'pending'})]};}),fixtureRuntime([handler]));
      const pending=await start(live);
      await until(()=>live.readThread(pending.thread),view=>entered&&view.runs[0].state.tools!.calls.some(call=>call.status==='completed'));
      const recovered=service();await recovered.recover();const snapshot=await recovered.readThread(pending.thread);
      assert.deepEqual(snapshot.runs[0].state.tools!.calls.map(call=>call.status),['completed','unknown']);assert.equal(snapshot.runs[0].status,'interrupted');
      release();await live.stop();assert.equal(rounds,1);assert.deepEqual(await recovered.readThread(pending.thread),snapshot);
    });
    await scenarioStep(t, 'TOOL-11', async () => {
      const bodies: any[] = [];
      const fn = (id: string) => ({ id: `fc_${id}`, type: 'function_call', status: 'completed', name: 'ash_0', call_id: id, arguments: queryCall().arguments });
      const model = openAIModel({ apiKey: 'synthetic-private-key', model: 'test-openai-model', options: { api: 'responses', store: false, maxOutputTokens: 1024, timeoutMs: 5000 }, reserve: async () => 10000, info: async () => ({ provider: 'openai', model: 'test-openai-model' }) }, async (_url, init) => {
        const body = JSON.parse(init!.body as string); bodies.push(body);
        if (bodies.length === 1) return sse([{ type: 'response.completed', response: { ...providerResponse(''), output: [{ type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'OPAQUE_PRIVATE_SENTINEL' }, fn('one'), fn('two')] } }]);
        if (bodies.length === 2) return sse([{ type: 'response.completed', response: { ...providerResponse(''), output: [fn('three')] } }]);
        return sse(successEvents('Provider continuation complete.'));
      });
      const value = service(model), { run } = await start(value); const done = await settle(value, run.id);
      assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(bodies.length, 3);
      assert.equal(bodies[0].parallel_tool_calls, true); assert.equal(bodies[0].store, false);
      assert.deepEqual(bodies[1].input.filter((item: any) => item.type === 'function_call_output').map((item: any) => item.call_id), ['one', 'two']);
      assert.equal(bodies[2].input.filter((item: any) => item.type === 'function_call_output').length, 3);
      assert.match(JSON.stringify(bodies[2]), /OPAQUE_PRIVATE_SENTINEL/); opaqueRun = done.id;
    });
    await scenarioStep(t, 'TOOL-12', async () => {
      let count = 0;
      const model = openAIModel({ apiKey: 'synthetic', model: 'test-openai-model', options: { api: 'responses', store: false, maxOutputTokens: 256, timeoutMs: 1000 }, reserve: async () => 1000, info: async () => ({ provider: 'openai', model: 'test-openai-model' }) }, async () => { count++; return sse([{ type: 'response.function_call_arguments.delta', item_id: 'fc', delta: '{' }]); });
      const value = service(model), { run } = await start(value), done = await settle(value, run.id);
      assert.equal(done.status, 'failed'); assert.equal(done.error?.code, 'provider_stream_incomplete'); assert.equal(count, 1); assert.deepEqual(await results(run.id), []);
    });
    await scenarioStep(t, 'TOOL-13', async () => {
      const row = await db.run.findUniqueOrThrow({ where: { id: opaqueRun } });
      const view = await service().inspect(RunState.parse(row.state).response_artifact_id!);
      assert.doesNotMatch(JSON.stringify(view), /OPAQUE_PRIVATE_SENTINEL|synthetic-private-key/);
      assert.match(JSON.stringify(await db.providerContinuation.findMany({ where: { runId: opaqueRun } })), /OPAQUE_PRIVATE_SENTINEL/);
    });
    await scenarioStep(t, 'TOOL-14', async () => {
      const original = await db.run.findUniqueOrThrow({ where: { id: acceptanceId } }), requestId = RunState.parse(original.state).request_artifact_id;
      await assert.rejects(db.artifact.update({ where: { id: requestId }, data: { payload: { changed: true } } }));
      const resultId=RunState.parse(original.state).tools!.calls[0].resultArtifactId!;
      await assert.rejects(db.artifact.delete({where:{id:resultId}}));
      await assert.rejects(db.providerContinuation.updateMany({ data: { items: [] } }));
      const value = new Threads(db, deterministicModel), { run } = await start(value, 'Hello'); await settle(value, run.id);
      assert.equal((await value.readThread(run.threadId!)).runs[0].state.tools, undefined); await value.stop();
    });
    await scenarioStep(t, 'TOOL-17', async () => {
      const gates = new Map<string, () => void>(), completed: string[] = []; let active = 0, peak = 0;
      const handler = retrievalTool(async (_run, query) => { active++; peak = Math.max(peak, active); await new Promise<void>(resolve => gates.set(query, resolve)); active--; completed.push(query); return success(query); });
      const runtime: ToolRuntime = { tools: [handler], resources: async () => [{ kind: 'fixture', id: 'scope', label: 'fixture' }], authorize: async () => ({ outcome: 'allowed', code: 'fixture', message: 'Fixture scope', configurationRevision: '1', evaluator: 'not-performed' }) };
      const value = service(batchModel([call('fixture.search', { query: 'a' }), call('fixture.search', { query: 'b' })]), runtime), { run } = await start(value);
      await until(async () => gates.size, size => size === 2); gates.get('b')!(); await until(async () => completed.length, n => n === 1); gates.get('a')!();
      const done = await settle(value, run.id); assert.equal(peak, 2); assert.deepEqual(completed, ['b', 'a']); assert.equal(done.state.tools!.calls.length, 2);
      const continuation = await db.artifact.findUniqueOrThrow({ where: { id: done.state.tools!.rounds[1].requestId } });
      assert.deepEqual((continuation.payload as unknown as RequestPayload).tools!.results.map(item => item.result.content[0]), [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
      gates.clear();completed.length=0;peak=0;
      const exclusive={...handler,definition:{...handler.definition,concurrency:'exclusive' as const}};
      const serial=service(batchModel([call('fixture.search',{query:'a'}),call('fixture.search',{query:'b'})]),fixtureRuntime([exclusive])),second=await start(serial);
      await until(async()=>gates.size,size=>size===1);
      assert.deepEqual((await serial.readThread(second.thread)).runs[0].state.tools!.calls.map(call=>call.status),['running','queued']);
      gates.get('a')!();await until(async()=>gates.size,size=>size===2);gates.get('b')!();await settle(serial,second.run.id);assert.equal(peak,1);
    });
    await scenarioStep(t, 'TOOL-22', async () => {
      const gates = new Map<string, () => void>(), entered: string[] = [];
      const original = retrievalTool(async (_run, query, signal) => {
        entered.push(query);
        await new Promise<void>(resolve => {
          gates.set(query, resolve);
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return success('ok');
      });
      const handler = { ...original, definition: { ...original.definition, limits: { timeoutMs: 5000, resultBytes: 512 } } };
      const limits = { ...DEFAULT_TOOL_LIMITS, resultBytes: 512, totalResultBytes: 800, concurrency: 2 };
      const value = service(batchModel([call('fixture.search', { query: 'first' }), call('fixture.search', { query: 'second' })]), fixtureRuntime([handler]), limits);
      const { run, thread } = await start(value);
      const held = await until(() => value.readThread(thread), view => (view.runs[0].state.tools?.calls[0]?.status === 'running' && entered.length > 0) || !['queued', 'running'].includes(view.runs[0].status));
      assert.deepEqual(entered, ['first']);
      assert.deepEqual(held.runs[0].state.tools!.calls.map(call => call.status), ['running', 'queued']);
      assert.equal(held.runs[0].state.tools!.reservedResultBytes, 512);
      gates.get('first')!();
      await until(async () => entered.length, count => count === 2); gates.get('second')!();
      const done = await settle(value, run.id);
      assert.equal(done.status, 'completed', JSON.stringify(done.error));
      assert.equal((await results(run.id)).length, 2);
      assert.equal(done.state.tools!.resultBytes, 2 * Buffer.byteLength(JSON.stringify(success('ok'))));
      assert.equal(done.state.tools!.reservedResultBytes, 0);

      gates.clear(); entered.length = 0;
      const cancellable = service(batchModel([call('fixture.search', { query: 'active' }), call('fixture.search', { query: 'waiting' })]), fixtureRuntime([handler]), limits);
      const pending = await start(cancellable);
      await until(async () => entered.length, count => count === 1);
      await cancellable.cancel(pending.run.id);
      await cancellable.stop();
      const cancelled = await cancellable.readThread(pending.thread);
      assert.deepEqual(entered, ['active']);
      assert.deepEqual(cancelled.runs[0].state.tools!.calls.map(call => call.status), ['unknown', 'not-started']);
      assert.equal(cancelled.runs[0].state.tools!.reservedResultBytes, 0);
      assert.deepEqual(await results(pending.run.id), []);
    });
    await scenarioStep(t, 'TOOL-18', async () => {
      const handler = retrievalTool(async () => ({ status: 'success', content: [{ type: 'data', value: { excerpts: ['bounded'] } }], references: [{ kind: 'artifact', id: randomUUID(), label: 'Retrieved evidence', observedAt: new Date().toISOString(), location: { offset: 0 } }], omissions: [] }));
      const runtime: ToolRuntime = { tools: [handler], resources: async () => [{ kind: 'fixture', id: 'scope', label: 'fixture' }], authorize: async () => ({ outcome: 'allowed', code: 'fixture', message: 'Fixture scope', configurationRevision: '1', evaluator: 'not-performed' }) };
      const other = registerTool({
        definition: {...handler.definition, name: 'fixture.lookup'}, parse(input: unknown) { return input; },
        async prepare() { return {action: {operation: 'fixture.lookup', effects: ['read' as const], resources: [{kind: 'fixture', id: 'other', label: 'Other service'}]}}; },
        async execute() { return success(); },
      });
      const combined = composeToolRuntimes(fixtureRuntime([other]), runtime);
      const value = service(batchModel([call('fixture.search', { query: 'context' }), call('fixture.lookup', {})]), combined), { run } = await start(value); const done = await settle(value, run.id);
      assert.equal(done.status, 'completed'); assert.equal((await results(run.id)).filter(result => result.references.some(ref => ref.kind === 'artifact')).length, 1);
      assert.throws(() => composeToolRuntimes(runtime, runtime), /Duplicate/);
      let effects=0;const effect=retrievalTool(async()=>{effects++;return success();});
      const reconcilable={...effect,definition:{...effect.definition,repeatability:'reconcile' as const}};
      const effectService=service(batchModel([call('fixture.search',{query:'once'})]),fixtureRuntime([reconcilable])),first=await start(effectService);await settle(effectService,first.run.id);
      const retried=await effectService.retry(first.run.id,randomUUID(),'normal');await settle(effectService,retried.id);assert.equal(effects,1);assert.equal((await results(retried.id))[0].status,'denied');
      const many={...runtime,resources:async()=>Array.from({length:100},(_,n)=>({kind:'fixture',id:String(n),label:'x'.repeat(300)}))};
      const metadata:ModelAdapter={...deterministicModel,async *stream(request){
        if(!request.tools!.previousOutputIds.length){yield {requestId:'first-request',status:'completed' as const};yield {kind:'output' as const,calls:[call('fixture.search',{query:'bounded'})]};}
        else {yield {status:'completed' as const};yield 'Done';}
      }};
      const bounded=service(metadata,many),third=await start(bounded),finished=await settle(bounded,third.run.id);
      assert.equal(finished.status,'completed');assert.deepEqual(finished.state.model,{status:'completed'});
      assert.equal(finished.state.tools!.rounds[0].model?.requestId,'first-request');
      const captured=await db.artifact.findUniqueOrThrow({where:{id:finished.state.request_artifact_id}});
      const request=captured.payload as unknown as RequestPayload;assert.ok(request.tools!.instructions.length<16000);assert.match(request.tools!.instructions,/[1-9]\d* resource descriptions omitted/);
      assert.equal(request.tools!.resources.length,100);

      const unavailable: ToolRuntime = { ...fixtureRuntime([other]), availability: async () => ({ definitions: [], resources: [], issues: [{ code: 'fixture_unavailable', message: 'The optional lookup service is unavailable.' }] }) };
      let offered: RequestPayload | undefined;
      const available = service(scripted(request => { offered = request; return request.tools!.previousOutputIds.length ? 'Done' : { kind: 'output', calls: [call('fixture.search', { query: 'still available' })] }; }), composeToolRuntimes(unavailable, runtime));
      const partial = await start(available); assert.equal((await settle(available, partial.run.id)).status, 'completed');
      assert.deepEqual(offered!.tools!.definitions.map(tool => tool.name), ['fixture.search']);
      assert.equal(offered!.tools!.availabilityIssues?.[0].code, 'fixture_unavailable');
      assert.match(offered!.tools!.instructions, /optional lookup service is unavailable/);
    });
  } finally {
    await stopInstance(ws, instance.id);
    for (const value of services) await value.stop();
    await db.$disconnect(); await disposeInstance(ws, instance.id);
     await rm(base, { recursive: true, force: true });
  }
});
