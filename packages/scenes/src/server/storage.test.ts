import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import sharp from 'sharp';
import { DEFAULT_LOCATION, DEFAULT_SCENE_ID, SCENE_REPLACEMENTS, RETIRED_SCENE_IDS, SCENE_ASSET_KEYS, validateLocation, type SceneAssetKey, type SceneLocation } from '../contracts.ts';
import { fixtureManifests } from '../fixtures/manifests.ts';
import { SceneService } from './service.ts';
import { sceneRoutes } from './routes.ts';
import { SCENE_LOCATIONS, searchSceneLocations } from './locations.ts';
import type { SceneRepository, StoredSceneBundle, StoredSceneState } from './repository.ts';
import { SceneError, sceneHash } from './storage.ts';

class Metadata implements SceneRepository {
  state: StoredSceneState = { activeBundleId: null, previousBundleId: null, location: null, revision: 0 };
  bundles = new Map<string, StoredSceneBundle>();
  conflict = false;
  async getState() { return structuredClone(this.state); }
  async getBundle(id: string) { return structuredClone(this.bundles.get(id) ?? null); }
  async listBundles() { return structuredClone([...this.bundles.values()]); }
  async putBundle(bundle: StoredSceneBundle) {
    const existing = this.bundles.get(bundle.id);
    if (existing && existing.manifestHash !== bundle.manifestHash) throw new Error('Immutable identity');
    this.bundles.set(bundle.id, structuredClone(bundle));
  }
  async compareAndSwapPointers(revision: number, pointers: { activeBundleId: string; previousBundleId: string | null }) {
    if (this.conflict || revision !== this.state.revision) return false;
    Object.assign(this.state, pointers, { revision: revision + 1 }); return true;
  }
  async setLocation(location: SceneLocation) { this.state.location = location; this.state.revision++; }
  async removeBundle(id: string) {
    if ([this.state.activeBundleId, this.state.previousBundleId].includes(id)) throw new Error('Referenced bundle');
    this.bundles.delete(id);
  }
}

async function tinyBundle(id = 'fallback', surfaceValue = 1) {
  const manifest = structuredClone(fixtureManifests[0]);
  Object.assign(manifest, { id, width: 2, height: 2 });
  const blobs = {} as Record<SceneAssetKey, Buffer>;
  for (const key of SCENE_ASSET_KEYS) {
    const value = key === 'surfaces' ? surfaceValue : key === 'depth' ? 100 : key === 'mask' ? 255 : 80;
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: value, g: value, b: value } } }).png().toBuffer();
    blobs[key] = bytes;
    manifest.assets[key] = { path: `assets/${id}-${key}.png`, sha256: sceneHash(bytes), bytes: bytes.length, mediaType: 'image/png', width: 2, height: 2 };
  }
  return { manifest, blobs, read: async (_asset: unknown, key: SceneAssetKey) => blobs[key] };
}
async function environment(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'ash-scenes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await tinyBundle(), fixtureRoot = join(root, 'shipped');
  await mkdir(join(fixtureRoot, 'assets'), { recursive: true });
  for (const key of SCENE_ASSET_KEYS) await writeFile(join(fixtureRoot, fixture.manifest.assets[key].path), fixture.blobs[key]);
  const metadata = new Metadata();
  const service = new SceneService({ repository: metadata, storageRoot: join(root, 'instance'), instanceId: 'instance-a', fixtureRoot, fixtures: [fixture.manifest] });
  await service.initialize();
  return { root, fixture, fixtureRoot, metadata, service };
}

test('complete staged publication precedes atomic activation and a failed candidate keeps the current scene', async t => {
  const { service, metadata } = await environment(t);
  const candidate = await tinyBundle('replacement');
  await service.publish(candidate.manifest, candidate.read);
  assert.equal(metadata.state.activeBundleId, 'fallback');
  assert.equal((await service.getState()).manifest.id, 'fallback');
  metadata.conflict = true;
  await assert.rejects(service.activate('replacement'), /settings changed/);
  assert.equal(metadata.state.activeBundleId, 'fallback');
  metadata.conflict = false;
  await service.activate('replacement');
  assert.equal((await service.getState()).manifest.id, 'replacement');
  assert.equal(metadata.state.previousBundleId, 'fallback');
  const broken = await tinyBundle('broken');
  await assert.rejects(service.publish(broken.manifest, async () => Buffer.from('wrong content')), /does not match/);
  assert.equal(await metadata.getBundle('broken'), null);
  assert.equal(metadata.state.activeBundleId, 'replacement');
  assert.ok(!(await readdir(service.storage.root)).some(name => name.startsWith('.staging-') || name === 'broken'));
});

test('corrupt active assets fall back to the previous complete bundle and shipped fallback survives cache damage', async t => {
  const { service, metadata, fixture } = await environment(t);
  const candidate = await tinyBundle('replacement');
  await service.publish(candidate.manifest, candidate.read); await service.activate(candidate.manifest.id);
  const badAsset = candidate.manifest.assets.source;
  await writeFile(join(service.storage.root, candidate.manifest.id, badAsset.sha256), Buffer.alloc(badAsset.bytes));
  assert.equal((await service.getState()).source, 'previous');
  assert.equal((await service.getState()).manifest.id, 'fallback');
  const previousAsset = fixture.manifest.assets.source;
  await writeFile(join(service.storage.root, 'fallback', previousAsset.sha256), Buffer.alloc(previousAsset.bytes));
  assert.equal((await service.getState()).source, 'fallback');
  assert.deepEqual((await service.readAsset('fallback', previousAsset.sha256)).bytes, fixture.blobs.source);
  assert.equal(metadata.state.activeBundleId, candidate.manifest.id);
  // An unsupported saved renderer is never exposed as a compatible bundle.
  const stored = metadata.bundles.get(candidate.manifest.id)!;
  (stored.manifest as unknown as { rendererVersion: number }).rendererVersion = 999;
  await assert.rejects(service.getBundle(candidate.manifest.id), /damaged or incompatible/);
});

test('filesystem boundary rejects traversal, symlinked assets, corrupt manifests and cross-instance reads', async t => {
  const { service, root, fixtureRoot, fixture } = await environment(t);
  const candidate = await tinyBundle('private-scene');
  await service.publish(candidate.manifest, candidate.read);
  const other = new SceneService({ repository: new Metadata(), storageRoot: join(root, 'other-instance'), instanceId: 'instance-b', fixtureRoot, fixtures: [fixture.manifest] });
  await other.initialize();
  await assert.rejects(other.readAsset(candidate.manifest.id, candidate.manifest.assets.source.sha256), /unavailable/);
  await assert.rejects(service.readAsset('../private-scene', candidate.manifest.assets.source.sha256), /Invalid scene identity/);
  await assert.rejects(service.readAsset(candidate.manifest.id, '../../secret'), /Invalid scene asset identity/);
  await assert.rejects(service.readAsset(candidate.manifest.id, '0'.repeat(64)), /does not belong/);
  const asset = candidate.manifest.assets.source, path = join(service.storage.root, candidate.manifest.id, asset.sha256), outside = join(root, 'outside.png');
  await writeFile(outside, candidate.blobs.source); await rm(path); await symlink(outside, path);
  await assert.rejects(service.readAsset(candidate.manifest.id, asset.sha256), /missing or damaged/);
  await writeFile(join(service.storage.root, candidate.manifest.id, 'manifest.json'), '{}');
  await assert.rejects(service.activate(candidate.manifest.id), /missing or damaged/);
});

test('asset decoding and map class validation happen before metadata publication', async t => {
  const { service, metadata } = await environment(t);
  const unsupported = await tinyBundle('unsupported');
  (unsupported.manifest as unknown as { version: number }).version = 2;
  await assert.rejects(service.publish(unsupported.manifest, unsupported.read), /invalid or incompatible/);
  const badMap = await tinyBundle('bad-map', 6);
  await assert.rejects(service.publish(badMap.manifest, badMap.read), /valid map values/);
  assert.equal(await metadata.getBundle('bad-map'), null);
  const mismatched = await tinyBundle('misaligned');
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  mismatched.blobs.mask = bytes;
  Object.assign(mismatched.manifest.assets.mask, { bytes: bytes.length, sha256: sceneHash(bytes) });
  await assert.rejects(service.publish(mismatched.manifest, mismatched.read), /aligned still PNG/);
});

test('authenticated routes expose only owned checked assets, persist valid location and search cities offline', async t => {
  const { service, fixture, metadata } = await environment(t), app = Fastify();
  t.after(async () => { await app.close(); });
  app.addHook('onRequest', async (request, reply) => { if (request.headers.authorization !== 'Bearer test') return reply.code(401).send({ error: 'Unauthorized' }); });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof SceneError ? error.status : 500).send({ error: error instanceof Error ? error.message : 'Unexpected error' }));
  sceneRoutes(app, service);
  const headers = { authorization: 'Bearer test' };
  assert.equal((await app.inject({ url: '/api/scenes/state' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/scenes' })).statusCode, 401);
  const current = await app.inject({ url: '/api/scenes/state', headers });
  assert.equal(current.statusCode, 200); assert.equal(current.json().manifest.id, 'fallback');
  assert.deepEqual(current.json().location, DEFAULT_LOCATION);
  const asset = await app.inject({ url: `/api/scenes/bundles/fallback/assets/${fixture.manifest.assets.source.sha256}`, headers });
  assert.deepEqual(asset.rawPayload, fixture.blobs.source); assert.equal(asset.headers['x-content-type-options'], 'nosniff');
  const location = { name: 'Tokyo, Japan', latitude: 35.6762, longitude: 139.6503, timeZone: 'Asia/Tokyo' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/scenes/location', headers, payload: location })).statusCode, 200);
  assert.deepEqual(metadata.state.location, location);
  assert.equal((await app.inject({ method: 'POST', url: '/api/scenes/location', headers, payload: { ...location, latitude: 100 } })).statusCode, 400);
  assert.deepEqual(metadata.state.location, location);
  const search = await app.inject({ url: '/api/scenes/locations?q=tokyo', headers });
  assert.equal(search.statusCode, 200); assert.equal(search.json().locations[0].timeZone, 'Asia/Tokyo');
  assert.equal((await app.inject({ url: '/api/scenes/locations?q=x', headers })).statusCode, 400);
  assert.ok(SCENE_LOCATIONS.length >= 50);
  for (const city of SCENE_LOCATIONS) assert.doesNotThrow(() => validateLocation(city));
  assert.equal(searchSceneLocations('sao paulo').locations[0].timeZone, 'America/Sao_Paulo');
  const replacement = await tinyBundle('selectable'); await service.publish(replacement.manifest, replacement.read);
  const choices = (await app.inject({ url: '/api/scenes', headers })).json();
  assert.deepEqual(new Set(choices.scenes.map((scene: { id: string }) => scene.id)), new Set(['fallback', 'selectable']));
  const choose = (id: string, expectedRevision: number) => app.inject({ method: 'POST', url: '/api/scenes/select', headers, payload: { id, expectedRevision } });
  const selected = await choose('selectable', choices.revision); assert.equal(selected.statusCode, 200); assert.equal(selected.json().selectedId, 'selectable');
  assert.equal((await choose('fallback', choices.revision)).statusCode, 409, 'Stale selection cannot overwrite the current scene.');
  assert.equal((await choose('fallback', selected.json().revision)).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/scenes/new', headers, payload: {} })).statusCode, 409);
  assert.equal((await service.getState()).manifest.id, 'fallback', 'Unavailable creation keeps the selected background.');
});

test('retention protects fallback, current and previous while removing old unselected scene assets', async t => {
  const { service, metadata } = await environment(t);
  const candidate = await tinyBundle('current'); await service.publish(candidate.manifest, candidate.read); await service.activate('current');
  const retired = await tinyBundle('retired'); await service.publish(retired.manifest, retired.read);
  metadata.bundles.get('retired')!.createdAt = new Date(0);
  const next = await tinyBundle('next'); await service.publish(next.manifest, next.read);
  assert.equal(await metadata.getBundle('retired'), null);
  await assert.rejects(readFile(join(service.storage.root, 'retired', 'manifest.json')));
  await service.activate('next');
  assert.equal(metadata.state.activeBundleId, 'next'); assert.equal(metadata.state.previousBundleId, 'current');
  assert.ok(await metadata.getBundle('fallback'));
  await assert.doesNotReject(service.storage.check(candidate.manifest));
});

test('all shipped reviewed fixture bundles publish without inference or external providers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ash-scene-fixtures-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const metadata = new Metadata(), warnings: string[] = [];
  const service = new SceneService({ repository: metadata, storageRoot: root, instanceId: 'fixture-check', fixtureRoot: fileURLToPath(new URL('../fixtures/', import.meta.url)), onWarning: message => warnings.push(message) });
  await service.initialize();
  assert.deepEqual(warnings, []);
  assert.equal((await metadata.listBundles()).length, fixtureManifests.length);
  assert.equal((await service.getState()).manifest.id, DEFAULT_SCENE_ID);
  const choices=await service.choices();
  assert.ok(choices.scenes.every(scene=>!RETIRED_SCENE_IDS.includes(scene.id)));
  for (const fixture of fixtureManifests) {
    if(RETIRED_SCENE_IDS.includes(fixture.id)){
      await assert.rejects(service.activate(fixture.id),/no longer selectable/);
      await service.storage.check(await service.getBundle(fixture.id));
      continue;
    }
    await service.activate(fixture.id);
    assert.equal((await service.getState()).manifest.id, fixture.id);
  }
  for(const retired of RETIRED_SCENE_IDS){
    metadata.state.activeBundleId=retired;metadata.state.previousBundleId=retired;
    await service.initialize();
    assert.equal(metadata.state.activeBundleId,SCENE_REPLACEMENTS[retired]);
    assert.equal(metadata.state.previousBundleId,null);
  }
});
