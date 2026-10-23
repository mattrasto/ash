import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerConfig } from '../../packages/shared/src/index.ts';
import { DEFAULT_LOCATION, DEFAULT_SCENE_ID, validateSceneBundle, type SceneLocation } from '../../packages/scenes/src/contracts.ts';
import { fixtureManifests } from '../../packages/scenes/src/fixtures/manifests.ts';
import { SceneService, createPrismaSceneRepository, sceneHash, serializeScene, type SceneStateResponse } from '../../packages/scenes/src/server.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { checkedCluster, connect } from '../../scripts/dev/database.ts';
import { devRoot, json } from '../../scripts/dev/io.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, disposeInstance, runtime } from '../../scripts/dev/lifecycle.ts';
import { scenarioStep } from '../support/node-scenarios.ts';

test('scene metadata, immutable assets and cached playback survive real backend restarts without model work', { timeout: 180000 }, async t => {
  const ws = await workspace(process.cwd(), await devRoot()), instance = await createInstance(ws, 'test', 'empty');
  const config = ServerConfig.parse(await json(join(instance.root, 'server.json'))), db = connectProduct(config.databaseUrl);
  const admin = connect(await checkedCluster(instance), instance.database);
  const fixtureRoot = join(instance.checkout, 'packages/scenes/src/fixtures');
  const scenes = new SceneService({ repository: createPrismaSceneRepository(db), storageRoot: instance.root, instanceId: instance.id, fixtureRoot });
  async function request(path: string, body?: object, authorized = true) {
    const live = await runtime(instance);
    assert.ok(live?.serverUrl, 'The isolated scene backend must be running.');
    return fetch(`${live.serverUrl}/api/scenes/${path}`, { method: body ? 'POST' : 'GET', headers: { ...(authorized ? { authorization: `Bearer ${config.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function state() {
    const response = await request('state');
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as SceneStateResponse;
  }
  const audit = async () => ({ runs: await db.run.count(), artifacts: await db.artifact.count(), assessments: await db.threadAssessment.count() });
  try {
    await scenarioStep(t, 'scene-persistence', async () => {
      await startInstance(ws, instance.id, { headless: true });
      assert.equal((await request('state', undefined, false)).status, 401);
      const first = await state();
      const startupRecord = await db.sceneBundle.findUniqueOrThrow({ where: { id: DEFAULT_SCENE_ID } });
      assert.equal(startupRecord.manifestText, serializeScene(fixtureManifests.find(scene=>scene.id===DEFAULT_SCENE_ID)!));
      assert.equal(startupRecord.manifestHash, sceneHash(startupRecord.manifestText));
      await scenes.storage.check(await scenes.getBundle(DEFAULT_SCENE_ID));
      validateSceneBundle(first.manifest);
      assert.equal(first.manifest.id, DEFAULT_SCENE_ID); assert.equal(first.source, 'active');
      assert.deepEqual(first.location, DEFAULT_LOCATION);
      assert.equal(await db.sceneBundle.count(), fixtureManifests.length);
      const saved = await db.sceneBundle.findUniqueOrThrow({ where: { id: first.manifest.id } });
      assert.equal(saved.manifestHash, sceneHash(serializeScene(first.manifest)));
      const source = first.manifest.assets.source;
      const sourcePath = `bundles/${first.manifest.id}/assets/${source.sha256}`;
      assert.equal((await request(sourcePath, undefined, false)).status, 401);
      const sourceResponse = await request(sourcePath);
      assert.equal(sourceResponse.status, 200);
      const bytes = Buffer.from(await sourceResponse.arrayBuffer());
      assert.equal(bytes.length, source.bytes); assert.equal(sceneHash(bytes), source.sha256);
      assert.deepEqual(bytes, await readFile(join(fixtureRoot, source.path)));
      assert.equal((await request(`bundles/${first.manifest.id}/assets/${'0'.repeat(64)}`)).status, 404);
      // Exercise the database's immutable-row trigger with the schema owner's connection.
      await assert.rejects(admin`UPDATE scene_bundles SET manifest_hash = repeat('0', 64) WHERE id = ${first.manifest.id}`, /immutable/i);
      assert.equal((await db.sceneBundle.findUniqueOrThrow({ where: { id: first.manifest.id } })).manifestHash, saved.manifestHash);

      const location: SceneLocation = { name: 'Tokyo, Japan', latitude: 35.6762, longitude: 139.6503, timeZone: 'Asia/Tokyo' };
      const changed = await request('location', location);
      assert.equal(changed.status, 200); assert.deepEqual((await changed.json()).location, location);
      const rejected = await request('location', { ...location, timeZone: 'No/Such_Zone' });
      assert.equal(rejected.status, 400); assert.deepEqual((await state()).location, location);
      const before = await audit(); assert.deepEqual(before, { runs: 0, artifacts: 0, assessments: 0 });
      await stopInstance(ws, instance.id); await startInstance(ws, instance.id, { headless: true });
      assert.deepEqual((await state()).location, location); assert.equal((await state()).manifest.id, DEFAULT_SCENE_ID);
      assert.deepEqual(await audit(), before);

      const lake = fixtureManifests.find(bundle => bundle.id === 'lake-panorama-v3')!;
      assert.ok(lake);
      // Use feature operations against the same real database and files as the running backend.
      await scenes.publish(lake, asset => readFile(join(fixtureRoot, asset.path)));
      assert.equal((await state()).manifest.id, DEFAULT_SCENE_ID, 'Publishing a complete bundle does not activate it.');
      await scenes.activate(lake.id);
      const active = await state();
      assert.equal(active.manifest.id, lake.id); assert.equal(active.previous?.id, DEFAULT_SCENE_ID);
      const pointers = await db.sceneState.findUniqueOrThrow({ where: { id: 'default' } });
      assert.equal(pointers.activeBundleId, lake.id); assert.equal(pointers.previousBundleId, DEFAULT_SCENE_ID);
      await assert.rejects(admin`DELETE FROM scene_bundles WHERE id = ${lake.id}`, /foreign key/i);
      await stopInstance(ws, instance.id); await startInstance(ws, instance.id, { headless: true });
      assert.equal((await state()).manifest.id, lake.id); assert.equal((await state()).previous?.id, DEFAULT_SCENE_ID);
      assert.deepEqual((await state()).location, location); assert.deepEqual(await audit(), before);

      // Damage the active cache; neither failure handling nor restart may change its saved pointer or dispatch work.
      await writeFile(join(scenes.storage.root, lake.id, lake.assets.source.sha256), Buffer.alloc(lake.assets.source.bytes));
      const fallback = await state();
      assert.equal(fallback.manifest.id, DEFAULT_SCENE_ID); assert.equal(fallback.source, 'previous');
      await assert.rejects(scenes.activate(lake.id), /missing or damaged/);
      assert.equal((await db.sceneState.findUniqueOrThrow({ where: { id: 'default' } })).activeBundleId, lake.id);
      await stopInstance(ws, instance.id); await startInstance(ws, instance.id, { headless: true });
      const recovered = await state();
      assert.equal(recovered.manifest.id, DEFAULT_SCENE_ID); assert.equal(recovered.source, 'previous');
      assert.equal((await db.sceneState.findUniqueOrThrow({ where: { id: 'default' } })).activeBundleId, lake.id);
      assert.deepEqual(recovered.location, location); assert.deepEqual(await audit(), before);
    });
  } finally {
    await stopInstance(ws, instance.id);
    await db.$disconnect(); await admin.end(); await disposeInstance(ws, instance.id);
  }
});
