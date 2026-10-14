import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron, type ElectronApplication } from 'playwright';
import { DEFAULT_TOOL_LIMITS, ServerConfig, ToolArtifact, RunState, type ToolCall, type RequestPayload, type ToolResult, type ToolLimits } from '../../packages/shared/src/index.ts';
import { Conversations } from '../../packages/server/src/modules/conversations/service.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import { openAIModel } from '../../packages/server/src/platform/models/openai.ts';
import type { ModelAdapter, ModelOutput } from '../../packages/server/src/platform/models/adapter.ts';
import { filesystemRuntime, loadFilesystemConfig, type FilesystemConfig } from '../../packages/server/src/modules/filesystem/runtime.ts';
import { type ToolRuntime } from '../../packages/server/src/modules/tools/contract.ts';
import { retrievalTool } from '../support/retrieval-tool.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { buildMain } from '../../scripts/dev/build.ts';
import { devRoot, json, atomic, childEnvironment, exec } from '../../scripts/dev/io.ts';
import { makeWorktree } from '../helpers/worktree.ts';
import { sse, successEvents } from '../helpers/openai.ts';

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

test('Filesystem tools: scoped observations and desktop inspection', { timeout: 240000 }, async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ash-tools-'))), source = process.cwd(), checkout = join(base, 'checkout');
  await makeWorktree(source, checkout);
  const root = join(base, 'source'), outside = join(base, 'outside');
  await mkdir(join(root, 'src'), { recursive: true }); await mkdir(join(root, 'private')); await mkdir(outside);
  await writeFile(join(root, 'src/a.ts'), 'export function cancel() {\n  return "first";\n}\n');
  await writeFile(join(root, 'src/b.ts'), 'export const cancel = "second";\n');
  await writeFile(join(root, '.env'), 'CREDENTIAL_SENTINEL_DO_NOT_RETURN');
  await writeFile(join(root, 'private/secret.ts'), 'RESTRICTED_SENTINEL_DO_NOT_RETURN');
  await writeFile(join(outside, 'secret.ts'), 'OUTSIDE_SENTINEL_DO_NOT_RETURN');
  await symlink(outside, join(root, 'escape')); await symlink(join(root, 'src'), join(root, 'alias'));
  let configuration: FilesystemConfig = { version: 1, scopes: [
    { path: root, operations: ['list', 'read', 'glob', 'search'], excludedNames: ['.env', '.git', '.ash-dev'] },
    { path: join(root, 'private'), operations: [], excludedNames: [] },
  ] };
  const fs = filesystemRuntime(async () => configuration);
  const ws = await workspace(checkout, await devRoot()), instance = await createInstance(ws, 'test', 'empty');
  await writeFile(join(instance.root, '.ash-tools.json'), JSON.stringify(configuration));
  const cfg = ServerConfig.parse(await json(join(instance.root, 'server.json'))), db = connectProduct(cfg.databaseUrl);
  const services: Conversations[] = [];
  const service = (model: ModelAdapter = deterministicModel, runtime: ToolRuntime = fs, limits?: ToolLimits, auto = true) => {
    const value = new Conversations(db, model, auto, undefined, runtime, limits); services.push(value); return value;
  };
  const settle = async (value: Conversations, id: string, attempts = 500) => {
    const row = await db.run.findUniqueOrThrow({ where: { id } });
    const view = await until(() => value.readThread(row.threadId!), view => view.runs.some(run => run.id === id && !['queued', 'running'].includes(run.status)), attempts);
    return view.runs.find(run => run.id === id)!;
  };
  const start = async (value: Conversations, text = 'Find source', mode: 'normal' | 'slow' = 'normal') => {
    const thread = randomUUID(); await value.createThread(thread, 'Tool fixture');
    const run = await value.submit(thread, randomUUID(), text, mode); return { thread, run };
  };
  const results = async (runId: string) => {
    const state = RunState.parse((await db.run.findUniqueOrThrow({ where: { id: runId } })).state);
    return Promise.all((state.tools?.calls ?? []).flatMap(call => call.resultArtifactId ? [call.resultArtifactId] : []).map(async id => {
      const payload = ToolArtifact.parse((await db.artifact.findUniqueOrThrow({ where: { id } })).payload);
      assert.equal(payload.type, 'tool_result'); if (payload.type !== 'tool_result') throw new Error('Expected result');
      return payload.result;
    }));
  };
  const read = (path = join(root, 'src/a.ts')) => call('filesystem.read', { path, startLine: 1, maxLines: 20 });
  let app: ElectronApplication | undefined;
  let acceptanceId = '', acceptanceThread = '';
  let citationThread = '', citationRun = '';
  const repeatedSource='artifact/offset/1',opaqueSource='artifact/雪 /'.repeat(40)+'100%';
  try {
    await scenarioStep(t, 'TOOL-01', async () => {
      const value = service(), { thread, run } = await start(value, 'Where is response cancellation implemented?');
      const done = await settle(value, run.id); assert.equal(done.status, 'completed', JSON.stringify(done.error));
      assert.equal(done.state.tools!.rounds.length, 4); assert.ok(done.state.tools!.calls.length >= 4);
      assert.ok((await results(run.id)).flatMap(result => result.references).every(ref => !!ref.contentHash));
      const inspection = await value.inspect(done.state.response_artifact_id!);
      assert.ok(inspection.artifacts.some(artifact => artifact.payload.type === 'tool_call'));
      assert.ok(inspection.artifacts.every(artifact => artifact.layer === 'input' || !!artifact.sourceId));
      assert.match(JSON.stringify(inspection.artifacts.find(artifact=>artifact.id===done.state.response_artifact_id)?.payload), /ash-source:/);
      acceptanceId = run.id; acceptanceThread = thread;
    });
    await scenarioStep(t, 'TOOL-03', async () => {
      {
      const value = service(batchModel([call('missing.tool', {}), { ...read(), arguments: '{' }, call('filesystem.read', { path: root, startLine: 0, maxLines: 1 })]), fs, { ...DEFAULT_TOOL_LIMITS, consecutiveErrors: 5 });
      const { run } = await start(value); await settle(value, run.id);
      assert.deepEqual((await results(run.id)).map(result => result.status), ['error', 'error', 'error']);
      assert.ok(RunState.parse((await db.run.findUniqueOrThrow({ where: { id: run.id } })).state).tools!.calls.every(call => !call.startedAt));
      }
      const cases = [join(root, '../outside/secret.ts'), join(root, 'escape/secret.ts'), join(root, 'private/secret.ts'), join(root, '.env'), root + 'suffix/file', join(root, 'src/a.ts') + '\0'];
      for (const target of cases) {
        const value = service(batchModel([read(target)])), { run } = await start(value); await settle(value, run.id);
        assert.notEqual((await results(run.id))[0].status, 'success');
      }
      const value = service(batchModel([read(join(root, 'alias/a.ts'))])), { run } = await start(value); await settle(value, run.id);
      assert.equal((await results(run.id))[0].status, 'success');
      const scan = service(batchModel([call('filesystem.list', { path: root }), call('filesystem.glob', { path: root, pattern: '**' }), call('filesystem.search', { path: root, query: 'SENTINEL', pattern: null })]));
      const scanned = await start(scan); await settle(scan, scanned.run.id);
      assert.doesNotMatch(JSON.stringify(await results(scanned.run.id)), /CREDENTIAL_SENTINEL|RESTRICTED_SENTINEL|OUTSIDE_SENTINEL/);
      const raced = join(root,'raced.ts'); await writeFile(raced,'safe before swap'); let checks=0;
      const raceRuntime:ToolRuntime={...fs,authorize:async(action,context)=>{
        const result=await fs.authorize(action,context);
        if(action.resources[0]?.id===raced&&++checks===2){await rename(raced,raced+'.saved');await symlink(join(outside,'secret.ts'),raced);}
        return result;
      }};
      const race=service(batchModel([read(raced)]),raceRuntime), racedRun=await start(race);await settle(race,racedRun.run.id);
      assert.notEqual((await results(racedRun.run.id))[0].status,'success');assert.doesNotMatch(JSON.stringify(await results(racedRun.run.id)),/OUTSIDE_SENTINEL/);
      await rm(raced);await rename(raced+'.saved',raced);
    });
    await scenarioStep(t, 'TOOL-04', async () => {
      const original = configuration;
      const value = service(batchModel([read()]), fs, undefined, false), { run } = await start(value);
      configuration = { version: 1, scopes: [] }; value.dispatch(run.id); await settle(value, run.id);
      assert.equal((await results(run.id))[0].status, 'denied');
      const empty = service(), fresh = await start(empty, 'Hello'); await settle(empty, fresh.run.id);
      assert.equal((await db.artifact.findUniqueOrThrow({ where: { id: fresh.run.state.request_artifact_id } })).payload && RunState.parse((await db.run.findUniqueOrThrow({ where: { id: fresh.run.id } })).state).tools, undefined);
      configuration = original;
      const saved = await value.inspect(run.state.request_artifact_id); assert.match(JSON.stringify(saved), /not-performed/);
    });
    await scenarioStep(t, 'TOOL-05', async () => {
      const path = join(root, 'mutable.ts'); await writeFile(path, 'before\n');
      const value = service(scripted(async request => {
        if (request.tools!.previousOutputIds.length === 0) return { kind: 'output', calls: [read(path)] };
        if (request.tools!.previousOutputIds.length === 1) { await writeFile(path, 'after\n'); return { kind: 'output', calls: [read(path)] }; }
        return 'Compared saved observations.';
      }));
      const { run } = await start(value); const done = await settle(value, run.id);
      const observed = await results(run.id); assert.match(JSON.stringify(observed[0]), /before/); assert.match(JSON.stringify(observed[1]), /after/);
      assert.notEqual(observed[0].references[0].contentHash, observed[1].references[0].contentHash);
      const prior = await value.inspect(done.state.response_artifact_id!); await rm(path);
      assert.deepEqual(await value.inspect(done.state.response_artifact_id!), prior);
      const retry = await value.retry(run.id, randomUUID(), 'normal'); await settle(value, retry.id);
      assert.deepEqual(await value.inspect(done.state.response_artifact_id!).then(view => view.artifacts.filter(item => item.runId === run.id)), prior.artifacts.filter(item => item.runId === run.id));
      {
      await writeFile(join(root, 'large.ts'), '💡'.repeat(300000));
      await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
      const value = service(batchModel([read(join(root, 'large.ts')), read(join(root, 'binary')), read(join(root, 'missing'))]), fs, { ...DEFAULT_TOOL_LIMITS, consecutiveErrors: 5 });
      const { run } = await start(value); await settle(value, run.id);
      for (const result of await results(run.id)) assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
      assert.ok((await results(run.id)).every(result => result.status !== 'success' || result.omissions.length));
      const broad=join(root,'many');await mkdir(broad);
      for(let index=0;index<513;index++)await writeFile(join(broad,`${index}.ts`),'fixture');
      try {
        // Raise only this fixture's deadline to isolate the evidence cap from the independent timeout.
        const tools=fs.tools.map(tool=>({...tool,definition:{...tool.definition,limits:{...tool.definition.limits,timeoutMs:30000}}}));
        const runtime={...fs,tools,availability:async()=>({...await fs.availability!('', ''),definitions:tools.map(tool=>tool.definition)})};
        const broadService=service(batchModel([call('filesystem.search',{path:broad,query:'no-match',pattern:null})]),runtime),listing=await start(broadService);await settle(broadService,listing.run.id,1500);
        const exhausted=(await results(listing.run.id))[0];assert.equal(exhausted.status,'error');assert.equal(exhausted.error.code,'access_evidence_limit');
      } finally {await rm(broad,{recursive:true});}
      }
    });
    await scenarioStep(t, 'TOOL-19', async () => {
      const configPath = join(instance.root, '.ash-tools.json'), savedConfig = await readFile(configPath);
      const fileRuntime = filesystemRuntime(() => loadFilesystemConfig(instance.root));
      try {
        for (const contents of ['{', JSON.stringify({ version: 1, scopes: [{ path: join(root, 'removed-directory'), operations: ['read'], excludedNames: [] }] })]) {
          await writeFile(configPath, contents);
          let captured: RequestPayload | undefined;
          const value = service(scripted(request => { captured = request; return 'Ordinary chat still works.'; }), fileRuntime);
          const { run, thread } = await start(value, 'Hello'); const done = await settle(value, run.id);
          assert.equal(done.status, 'completed', JSON.stringify(done.error));
          assert.deepEqual(captured!.tools!.definitions, []); assert.deepEqual(captured!.tools!.resources, []);
          assert.equal(captured!.tools!.availabilityIssues?.[0].code, 'scope_configuration');
          assert.match(captured!.tools!.instructions, /Filesystem tools are unavailable/);
          assert.deepEqual(done.state.tools!.availabilityIssues, captured!.tools!.availabilityIssues);
          assert.deepEqual(await results(run.id), []);
          const request = await db.artifact.findUniqueOrThrow({ where: { id: run.state.request_artifact_id } });
          assert.deepEqual((request.payload as unknown as RequestPayload).tools, captured!.tools);
          const before = await value.inspect(done.state.response_artifact_id!);
          await writeFile(configPath, savedConfig);
          assert.deepEqual(await value.inspect(done.state.response_artifact_id!), before);
          await value.updateThread(thread, { title: 'Unavailable filesystem' });
        }
        await writeFile(configPath, '{');
        let calls = 0;
        const model = openAIModel({ apiKey: 'synthetic', model: 'test-openai-model', options: { api: 'responses', store: false, maxOutputTokens: 256, timeoutMs: 1000 }, reserve: async () => 1000, info: async () => ({ provider: 'openai', model: 'test-openai-model' }) }, async (_url, init) => {
          const body = JSON.parse(init!.body as string); calls++;
          assert.deepEqual(body.tools, []);
          assert.ok(body.input.some((message: { content: unknown }) => typeof message.content === 'string' && message.content.includes('Filesystem tools are unavailable')));
          return sse(successEvents('Chat continues without filesystem access.'));
        });
        const remote = service(model, fileRuntime), mocked = await start(remote, 'Hello');
        assert.equal((await settle(remote, mocked.run.id)).status, 'completed'); assert.equal(calls, 1);
        await writeFile(configPath, savedConfig);
        // Configuration failure after capture still denies dispatch through the current boundary.
        const value = service(batchModel([read()]), fileRuntime, undefined, false), pending = await start(value);
        await writeFile(configPath, '{'); value.dispatch(pending.run.id); await settle(value, pending.run.id);
        const denied = (await results(pending.run.id))[0];
        assert.equal(denied.status, 'denied'); assert.equal(denied.error.code, 'scope_configuration');
        const state = RunState.parse((await db.run.findUniqueOrThrow({ where: { id: pending.run.id } })).state);
        assert.equal(state.tools!.calls[0].authorization?.configurationRevision, 'unavailable');
      } finally { await writeFile(configPath, savedConfig); }
      const fresh = service(), current = await start(fresh, 'Hello'); await settle(fresh, current.run.id);
      const request = await db.artifact.findUniqueOrThrow({ where: { id: current.run.state.request_artifact_id } });
      assert.equal((request.payload as unknown as RequestPayload).tools!.definitions.length, 4);
      assert.equal((request.payload as unknown as RequestPayload).tools!.availabilityIssues, undefined);
    });
    await scenarioStep(t, 'TOOL-20', async () => {
      await mkdir(join(root, 'src/nested'), { recursive: true });
      await writeFile(join(root, 'src/direct.ts'), 'pattern evidence\n');
      await writeFile(join(root, 'src/nested/deep.ts'), 'pattern evidence\n');
      const value = service(batchModel([
        call('filesystem.glob', { path: root, pattern: 'src/**/*.ts' }),
        call('filesystem.glob', { path: join(root, 'alias'), pattern: '*.ts' }),
        call('filesystem.search', { path: root, query: 'pattern evidence', pattern: 'src/**/**/*.ts' }),
        call('filesystem.search', { path: join(root, 'alias'), query: 'pattern evidence', pattern: '*.ts' }),
      ])), { run } = await start(value); const done = await settle(value, run.id);
      assert.equal(done.status, 'completed', JSON.stringify(done.error));
      const observed = await results(run.id); assert.ok(observed.every(result => result.status === 'success'));
      const text = (result: ToolResult) => result.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('\n');
      assert.match(text(observed[0]), /src\/direct\.ts/); assert.match(text(observed[0]), /src\/nested\/deep\.ts/);
      assert.match(text(observed[1]), /src\/direct\.ts/); assert.doesNotMatch(text(observed[1]), /nested\/deep\.ts/);
      assert.deepEqual(observed[2].references.map(ref => ref.location.path).sort(), [join(root, 'src/direct.ts'), join(root, 'src/nested/deep.ts')]);
      assert.deepEqual(observed[3].references.map(ref => ref.location.path), [join(root, 'src/direct.ts')]);
      assert.deepEqual(observed[1].omissions, []); assert.deepEqual(observed[3].omissions, []);
    });
    await scenarioStep(t, 'TOOL-21', async () => {
      const path = join(root, 'utf8.txt'), prefix = 'unicode needle\n';
      const bytes = Buffer.from(prefix + '€'.repeat(400000));
      assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 1048576)));
      await writeFile(path, bytes);
      await writeFile(join(root, 'invalid-utf8.txt'), Buffer.from([0xe2, 0x82]));
      await writeFile(join(root, 'invalid-utf8-large.txt'), Buffer.concat([Buffer.from(prefix), Buffer.from([0xff]), bytes]));
      const value = service(batchModel([
        call('filesystem.read', { path, startLine: 1, maxLines: 1 }),
        call('filesystem.search', { path: root, query: 'unicode needle', pattern: 'utf8.txt' }),
        read(join(root, 'invalid-utf8.txt')), read(join(root, 'invalid-utf8-large.txt')),
      ])), { run } = await start(value); const done = await settle(value, run.id);
      assert.equal(done.status, 'completed', JSON.stringify(done.error));
      const observed = await results(run.id);
      assert.equal(observed.length, 4);
      for (const result of observed.slice(0, 2)) {
        assert.equal(result.status, 'success'); assert.match(JSON.stringify(result.content), /unicode needle/);
        assert.ok(result.omissions.some(omission => omission.includes('byte limit')));
      }
      for (const result of observed.slice(2)) { assert.equal(result.status, 'error'); assert.equal(result.error.code, 'unsupported_file'); }
    });
    await scenarioStep(t,'TOOL-24',async()=>{
      const handler=retrievalTool(async(_run,query)=>({status:'success',content:[{type:'text',text:query==='first'?'FIRST_CAPTURE':'SECOND_CAPTURE'}],references:[
        {kind:'artifact',id:repeatedSource,label:query,observedAt:new Date().toISOString(),location:{offset:query==='first'?0:100}},
        ...(query==='second'?[{kind:'artifact',id:repeatedSource,label:'Another later excerpt',observedAt:new Date().toISOString(),location:{offset:200}},{kind:'artifact',id:opaqueSource,label:'Opaque source',observedAt:new Date().toISOString(),location:{offset:300}}]:[]),
      ],omissions:[]}));
      const runtime:ToolRuntime={tools:[handler],resources:async()=>[{kind:'fixture',id:'scope',label:'Fixture'}],authorize:async()=>({outcome:'allowed',code:'fixture',message:'Covered',configurationRevision:'1',evaluator:'not-performed'})};
      const value=service(scripted(request=>{
        if(!request.tools!.previousOutputIds.length)return {kind:'output',calls:[call('fixture.search',{query:'first'}),call('fixture.search',{query:'second'})]};
        const refs=request.tools!.results[1].result.references;
        return `[Later observation](ash-source:${refs[0].citationId}) · [Another later excerpt](ash-source:${refs[1].citationId}) · [Opaque source](ash-source:${encodeURIComponent(refs[2].id)}) · [Ambiguous old source](ash-source:${repeatedSource})`;
      }),runtime);
      const started=await start(value,'Citation identity');citationThread=started.thread;citationRun=started.run.id;
      const done=await settle(value,citationRun);assert.equal(done.status,'completed');await value.updateThread(citationThread,{title:'Citation identity'});
      const observed=await results(citationRun),refs=observed.flatMap(result=>result.references);
      assert.equal(new Set(refs.map(ref=>ref.citationId)).size,4);assert.equal(refs.filter(ref=>ref.id===repeatedSource).length,3);
      for(const [index,step] of done.state.tools!.calls.entries()){
        assert.deepEqual(step.citationIds,observed[index].references.map(ref=>ref.citationId));
        assert.deepEqual(step.referenceIds,observed[index].references.map(ref=>ref.id));
      }
      const continuation=await db.artifact.findUniqueOrThrow({where:{id:done.state.tools!.rounds[1].requestId}});
      assert.deepEqual((continuation.payload as unknown as RequestPayload).tools!.results.map(item=>item.result.references),observed.map(result=>result.references));
    });
    await scenarioStep(t, 'TOOL-15', async () => {
      await startInstance(ws, instance.id, { headless: true });
      const require = createRequire(join(checkout, 'package.json'));
      const running = await startInstance(ws, instance.id, { headless: true });
      const entry = await buildMain(checkout, join(instance.root, 'build')), path = join(instance.root, 'tools-client.json');
      await atomic(path, { root: instance.root, label: instance.label, instanceId: instance.id, url: running.webUrl, windowed: true, background: true });
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], cwd: checkout, env: { ...childEnvironment(join(instance.root, 'tmp')), ASH_CLIENT_CONFIG: path } as Record<string, string> });
      const page = await app.firstWindow(); const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
      await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor().catch(async error=>{throw new Error(`${error.message}\n${pageErrors.join('\n')}\n${(await page.locator('body').innerText()).slice(0,2000)}`);});
      await page.getByRole('button', { name: 'New conversation', exact: true }).click();
      await page.getByRole('heading', { name: 'New conversation', exact: true }).waitFor();
      await page.getByText('Test response settings',{exact:true}).click();
      await page.locator('#mode').selectOption('slow');
      await page.getByLabel('Message', { exact: true }).fill('Where is response cancellation implemented?');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      const trace=page.getByLabel('Tool activity').getByRole('button').first();
      await trace.click();await trace.click();
      await page.getByText('These citations open the captured source excerpts.', { exact: false }).waitFor();
      assert.equal(await trace.getAttribute('aria-expanded'),'true');
      await page.locator('a[data-source-reference]').first().click();
      await page.getByLabel('Execution steps').waitFor();
      assert.ok(await page.getByLabel('Execution steps').locator('pre:visible').filter({hasText:/\d+: export/}).count());
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      for (const size of [{ width: 1040, height: 830 }, { width: 740, height: 650 }]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size);
        const state: {visible:boolean;focusable:boolean} = await app.evaluate(({ BrowserWindow }) => ({ visible: BrowserWindow.getAllWindows()[0].isVisible(), focusable: BrowserWindow.getAllWindows()[0].isFocusable() }));
        assert.deepEqual(state, { visible: false, focusable: false });
      }
      await page.reload(); await page.getByText('These citations open the captured source excerpts.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Unavailable filesystem', exact: true }).first().click();
      await page.getByText('Filesystem tools are unavailable.', { exact: false }).waitFor();
      await page.getByText('Ordinary chat still works.', { exact: true }).waitFor();
      await page.getByRole('button',{name:'Citation identity',exact:true}).click();
      for(const label of ['Later observation','Another later excerpt','Opaque source']){
        await page.getByRole('link',{name:label,exact:true}).click();
        await page.getByLabel('Execution steps').locator('pre:visible').filter({hasText:'SECOND_CAPTURE'}).waitFor();
        assert.equal(await page.getByLabel('Execution steps').locator('pre:visible').filter({hasText:'FIRST_CAPTURE'}).count(),0);
        await page.getByRole('button',{name:'Close inspector',exact:true}).click();
      }
      await page.getByRole('link',{name:'Ambiguous old source',exact:true}).click();
      await page.getByText('Source citation unavailable',{exact:true}).waitFor();assert.equal(await page.getByLabel('Artifact inspector').count(),0);
      await page.reload();await page.getByRole('link',{name:'Later observation',exact:true}).click();
      await page.getByLabel('Execution steps').locator('pre:visible').filter({hasText:'SECOND_CAPTURE'}).waitFor();
      await page.getByRole('button',{name:'Close inspector',exact:true}).click();
      assert.deepEqual(pageErrors, []);
    });
    await scenarioStep(t, 'TOOL-16', async () => {
      await app!.close(); app = undefined;
      const before = await service().readThread(acceptanceThread);
      const citationsBefore=await service().inspect((await service().readThread(citationThread)).runs.find(run=>run.id===citationRun)!.state.response_artifact_id!);
      await stopInstance(ws, instance.id); await startInstance(ws, instance.id, { headless: true });
      assert.deepEqual(await service().readThread(acceptanceThread), before);
      assert.deepEqual(await service().inspect(citationsBefore.runs.find(run=>run.id===citationRun)!.state.response_artifact_id!),citationsBefore);
      // A queued persisted Run crosses an actual backend process restart with no dispatch.
      await stopInstance(ws, instance.id);
      const value = service(batchModel([read()]), fs, undefined, false), { run } = await start(value);
      await startInstance(ws, instance.id, { headless: true });
      assert.equal((await settle(value, run.id)).status, 'interrupted'); assert.deepEqual(await results(run.id), []);
    });
  } finally {
    await app?.close(); await stopInstance(ws, instance.id);
    for (const value of services) await value.stop();
    await db.$disconnect(); await disposeInstance(ws, instance.id);
    await exec('git', ['worktree', 'remove', '--force', checkout], { cwd: source }); await rm(base, { recursive: true, force: true });
  }
});
