import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import Fastify from 'fastify';
import { FeatureEvidence, RequestPayload, RunState, ServerConfig, ToolArtifact } from '../../packages/shared/src/index.ts';
import { DEFAULT_SCENE_ID } from '../../packages/scenes/src/contracts.ts';
import { SceneService, SceneWorkflow, ScenePreparer, sceneEventReceipt, sceneExecutionHost, sceneRuntime, sceneRoutes,
  createPrismaSceneRepository, SceneIntent, SCENE_GENERATION_SIZE, sceneHash } from '../../packages/scenes/src/server.ts';
import type { SceneGenerationAdapter } from '../../packages/scenes/src/server.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import type { ModelAdapter } from '../../packages/server/src/platform/models/adapter.ts';
import { Incoming } from '../../packages/server/src/modules/artifacts/service.ts';
import { ensureEngineInstructions } from '../../packages/server/src/modules/artifacts/instructions.ts';
import { Threads, ThreadError } from '../../packages/server/src/modules/threads/service.ts';
import { toolEvidenceHost } from '../../packages/server/src/modules/tools/evidence-host.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { devRoot, json } from '../../scripts/dev/io.ts';
import { disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { scenarioStep } from '../support/node-scenarios.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  for (let n = 0; n < 1500; n++) { const value = await read(); if (ready(value)) return value; await delay(20); }
  throw new Error('Scene workflow did not settle.');
}
const intent = SceneIntent.parse({ landscape: 'lakeside', vegetation: 'clustered', landmark: 'none' });
const event = () => ({ id: randomUUID(), source: { name: 'scene-test-source', eventId: randomUUID(), label: 'Synthetic scene event' }, intent });

test('routed scene events use normal Runs, immutable evidence and an isolated cancellable preparation worker', { timeout: 180000 }, async t => {
  const ws = await workspace(process.cwd(), await devRoot()), instance = await createInstance(ws, 'test', 'empty');
  const config = ServerConfig.parse(await json(join(instance.root, 'server.json'))), db = connectProduct(config.databaseUrl);
  const scenes = new SceneService({ repository: createPrismaSceneRepository(db), storageRoot: instance.root, instanceId: instance.id, fixtureRoot: join(instance.checkout, 'packages/scenes/src/fixtures') });
  const host = sceneExecutionHost(toolEvidenceHost(db));
  const preparer = new ScenePreparer({ inferenceModule: new URL('../../packages/scenes/src/server/preparation/test-inference.js', import.meta.url) });
  let generations = 0, hold = false, repeated = false, generatorReady = true, invalid = false;
  const {width,height}=SCENE_GENERATION_SIZE, pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(y < 310 ? [110, 150, 220] : x > 1000 && y > 500 ? [15, 40, 110] : x < 250 && y > 480 ? [20, 70, 20] : [60, 90, 40], (y * width + x) * 3);
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const generator: SceneGenerationAdapter = {
    async availability() { return { available: generatorReady, issues: generatorReady ? [] : ['Synthetic generator unavailable.'] }; },
    configuration() { return { provider: 'controlled-test', model: 'synthetic-wide-art-v1', options: { ...SCENE_GENERATION_SIZE, quality: null, format: 'png', seed: null } }; },
    async generate(request, signal) {
      generations++;
      assert.equal(request.reference.sceneId, 'meadow'); assert.equal(request.reference.role, 'style-only');
      assert.equal(request.reference.sha256, sceneHash(request.reference.bytes));
      assert.ok(request.prompt.includes('ORIGINAL MIDJOURNEY MEADOW')); assert.ok(request.prompt.includes('3840×1536'));
      assert.ok(request.prompt.includes('low-saturation')); assert.equal(request.recent.length, 1);
      if (hold) await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); if (signal.aborted) reject(signal.reason); });
      signal.throwIfAborted();
      return { bytes: invalid ? await sharp(source).resize(100, 100).png().toBuffer() : source, metadata: { provider: 'controlled-test', model: 'synthetic-wide-art-v1', requestId: `synthetic-${generations}`, seed: null, usage: null } };
    },
  };
  const workflow = new SceneWorkflow({ scenes, instanceRoot: instance.root, host, generator, preparer });
  const tools = sceneRuntime(workflow, host, instance.id);
  const model: ModelAdapter = { ...deterministicModel,
    async *stream(request, signal) {
      if (request.purpose === 'engine_assess' && JSON.parse(String(request.messages.at(-1)!.content)).input.event?.kind === 'scene.generate') {
        yield JSON.stringify({ type: 'act_plan', action: true, showSource: false, showResponse: true, reason: 'Controlled scene workflow boundary test.' }); return;
      }
      if (request.purpose?.startsWith('engine_')) { yield* deterministicModel.stream(request, signal); return; }
      if (!request.tools?.definitions.some(definition => definition.name === 'scene.generate')) { yield 'Scene generation is unavailable; the approved scene remains.'; return; }
      const round = request.tools.previousOutputIds.length;
      if (round === 0 || repeated && round === 1) {
        if (round === 1) generatorReady = false; // Completed evidence remains reusable when the provider becomes unavailable.
        yield { kind: 'output', calls: [{ callId: `scene-${round}`, name: 'scene.generate', arguments: JSON.stringify(request.incoming?.event?.data.intent ?? intent) }] }; return;
      }
      yield 'Candidate prepared for review; approved scene retained.';
    },
  };
  const threads = new Threads(db, model, true, undefined, tools), incoming = new Incoming(db, threads, model, false);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ThreadError ? error.status : 500).send({ error: error instanceof Error ? error.message : 'Unexpected test request error.' }));
  app.addHook('onRequest', async (request, reply) => { if (request.headers.authorization !== 'Bearer synthetic-local-token') return reply.code(401).send({ error: 'Unauthorized' }); });
  sceneRoutes(app, scenes, { workflow, receive: receipt => incoming.receive(receipt) });
  const receive = async (body: ReturnType<typeof event>) => {
    const response = await app.inject({ method: 'POST', url: '/api/scenes/events', headers: { authorization: 'Bearer synthetic-local-token' }, payload: body });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  const dispatch = async (id: string) => { incoming.dispatch(id); await incoming.idle(); return incoming.get(id); };
  const settled = (id: string) => until(() => db.run.findUniqueOrThrow({ where: { id } }), run => !['queued', 'running'].includes(run.status));
  try {
    await ensureEngineInstructions(db); await scenes.initialize();
    await scenarioStep(t, 'scene-event-workflow', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/api/scenes/events', payload: event() })).statusCode, 401);
      const body = event(), first = await receive(body), duplicate = await receive({ ...body, id: randomUUID() });
      assert.equal(first.id, duplicate.id); assert.equal(await db.run.count(), 0);
      repeated = true;
      const processed = await dispatch(first.id); assert.ok(processed.state.threadId); assert.ok(processed.state.runId);
      const run = await settled(processed.state.runId!); assert.equal(run.status, 'completed', JSON.stringify(run.error));
      assert.equal(generations, 1, 'A second model tool call for the same event reuses the completed candidate.');
      assert.equal(await db.run.count({ where: { inputArtifactId: first.id } }), 1);
      const view = await threads.inspect(first.id);
      assert.equal(view.input.payload.type, 'incoming_input');
      if (view.input.payload.type === 'incoming_input') { assert.equal(view.input.payload.source.name, body.source.name); assert.deepEqual(view.input.payload.event?.data.intent, intent); }
      const savedRequest = RequestPayload.parse(view.artifacts.find(artifact => artifact.payload.type === 'model_request')!.payload);
      assert.deepEqual(savedRequest.incoming?.event?.data.intent, intent);
      const captures = view.artifacts.filter(artifact => artifact.payload.type === 'feature_evidence').map(artifact => ({ artifact, payload: FeatureEvidence.parse(artifact.payload) }));
      assert.deepEqual(captures.map(capture => capture.payload.stage), ['generation-request', 'generation-result', 'preparation-result', 'profile-proposal', 'review-required']);
      for (let n = 1; n < captures.length; n++) assert.equal(captures[n].artifact.sourceId, captures[n - 1].artifact.id);
      const steps = RunState.parse(run.state).tools!.calls;
      const candidate = await workflow.candidates.get(steps[0].id);
      assert.equal(candidate.status, 'review'); assert.equal(candidate.manifest.framing.mode, 'cover'); assert.equal(candidate.manifest.assets.source.sha256, sceneHash(source));
      assert.equal(candidate.manifest.profile.water, true); assert.equal(candidate.manifest.profile.starBrightness, 120);
      assert.ok(!('verification' in candidate.manifest));
      for (const gate of Object.values(candidate.gates)) assert.equal(gate.status, 'review');
      assert.equal((await scenes.getState()).manifest.id, DEFAULT_SCENE_ID, 'Unreviewed candidates cannot replace the approved background.');
      for (const key of ['source', 'mask', 'candidate', 'depth', 'surfaces'] as const) {
        const path = `/api/scenes/candidates/${candidate.id}/assets/${candidate.manifest.assets[key].sha256}`;
        assert.equal((await app.inject({ url: path })).statusCode, 401);
        const asset = await app.inject({ url: path, headers: { authorization: 'Bearer synthetic-local-token' } });
        assert.equal(asset.statusCode, 200); assert.equal(sceneHash(asset.rawPayload), candidate.manifest.assets[key].sha256);
      }
      const restarted = new SceneWorkflow({ scenes, instanceRoot: instance.root, host, generator, preparer });
      assert.deepEqual(await restarted.candidates.get(candidate.id), candidate, 'Candidate evidence survives worker/service disposal.');
      const last = ToolArtifact.parse((await db.artifact.findUniqueOrThrow({ where: { id: steps[1].resultArtifactId! } })).payload);
      assert.ok(last.type === 'tool_result' && last.result.status === 'success');
      const conflict = await app.inject({ method: 'POST', url: '/api/scenes/events', headers: { authorization: 'Bearer synthetic-local-token' }, payload: { ...body, intent: { ...intent, landscape: 'meadow' } } });
      assert.equal(conflict.statusCode, 409);
      repeated = false;
      generatorReady = true;
    });
    await scenarioStep(t, 'scene-event-interruption', async () => {
      invalid = true;
      const invalidSubmission = await receive(event()), invalidProcessed = await dispatch(invalidSubmission.id);
      const invalidRun = await settled(invalidProcessed.state.runId!), invalidStep = RunState.parse(invalidRun.state).tools!.calls[0];
      const invalidResult = ToolArtifact.parse((await db.artifact.findUniqueOrThrow({ where: { id: invalidStep.resultArtifactId! } })).payload);
      assert.ok(invalidResult.type === 'tool_result' && invalidResult.result.status === 'error' && invalidResult.result.error.effect === 'unknown', 'Provider dispatch followed by rejected art must not claim no effect.');
      invalid = false;
      hold = true; const before = generations;
      const submitted = await receive(event()), processed = await dispatch(submitted.id), runId = processed.state.runId!;
      await until(async () => generations, count => count === before + 1);
      await threads.cancel(runId); assert.equal((await settled(runId)).status, 'cancelled');
      hold = false;
      const retry = await threads.retry(runId, randomUUID(), 'normal'); await settled(retry.id);
      assert.equal(generations, before + 1, 'An unknown-outcome dispatched call is not blindly generated again on Retry.');
      assert.equal((await scenes.getState()).manifest.id, DEFAULT_SCENE_ID);
      const failedCalls = RunState.parse((await db.run.findUniqueOrThrow({ where: { id: retry.id } })).state).tools!.calls;
      const failure = ToolArtifact.parse((await db.artifact.findUniqueOrThrow({ where: { id: failedCalls[0].resultArtifactId! } })).payload);
      assert.ok(failure.type === 'tool_result' && failure.result.status === 'denied' && failure.result.error.code === 'retry_requires_reconciliation');
    });
    await scenarioStep(t, 'scene-unavailable', async () => {
      generatorReady = false; const before = generations;
      const submitted = await receive(event()), processed = await dispatch(submitted.id); await settled(processed.state.runId!);
      assert.equal(generations, before);
      const view = await threads.inspect(submitted.id), request = RequestPayload.parse(view.artifacts.find(artifact => artifact.payload.type === 'model_request')!.payload);
      assert.deepEqual(request.tools?.definitions, []); assert.ok(request.tools?.availabilityIssues?.some(issue => issue.code === 'scene_unavailable'));
      const noModels = new SceneWorkflow({ scenes, instanceRoot: instance.root, host, generator, preparer: new ScenePreparer() });
      const readiness = await noModels.availability(); assert.equal(readiness.available, false); assert.ok(readiness.issues.some(issue => issue.includes('models are not installed')));
      assert.equal((await scenes.getState()).manifest.id, DEFAULT_SCENE_ID);
    });
  } finally { await incoming.stop(); await threads.stop(); await app.close(); await db.$disconnect(); await disposeInstance(ws, instance.id); }
});
