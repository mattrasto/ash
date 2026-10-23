import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_LOCATION, DEFAULT_SCENE_ID, SCENE_REPLACEMENTS, SCENE_ASSET_KEYS, validateLocation, validateSceneBundle, type SceneAsset, type SceneBundle, type SceneLocation, type SceneChoices } from '../contracts.ts';
import { fixtureManifests } from '../fixtures/manifests.ts';
import type { SceneRepository } from './repository.ts';
import { SCENE_STORAGE_LIMITS, SceneError, SceneStorage, assetHash, sceneHash, sceneId, serializeScene, type SceneAssetReader } from './storage.ts';

export interface SceneStateResponse {
  revision: number;
  manifest: SceneBundle;
  previous: SceneBundle | null;
  location: SceneLocation;
  source: 'active' | 'previous' | 'fallback';
}
export interface SceneServiceOptions {
  repository: SceneRepository;
  /** The already isolated Ash instance directory, never a shared upload directory. */
  storageRoot: string;
  instanceId: string;
  /** Root containing the shipped assets/ directory, supplied by host packaging. */
  fixtureRoot: string;
  fixtures?: readonly SceneBundle[];
  onWarning?: (message: string) => void;
}

export class SceneService {
  readonly storage: SceneStorage;
  private readonly fixtures: ReadonlyMap<string, SceneBundle>;
  private readonly fallback: SceneBundle;
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private options: SceneServiceOptions) {
    if (!options.instanceId) throw new SceneError(400, 'Scene storage requires an instance identity.');
    this.storage = new SceneStorage(options.storageRoot);
    const fixtures = options.fixtures ?? fixtureManifests;
    if (!fixtures.length) throw new SceneError(500, 'The shipped scene fallback is missing.');
    for (const fixture of fixtures) { validateSceneBundle(fixture); sceneId(fixture.id); }
    this.fixtures = new Map(fixtures.map(fixture => [fixture.id, fixture]));
    this.fallback = fixtures.find(fixture => fixture.id === DEFAULT_SCENE_ID) ?? fixtures[0];
  }
  private replacement(id:string|null){return id?this.fixtures.get(SCENE_REPLACEMENTS[id]):undefined;}
  private retired(id: string | null) { return !!this.replacement(id); }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action, action);
    this.mutation = result.catch(() => undefined);
    return result;
  }
  private fixtureReader: SceneAssetReader = async asset => {
    // Paths come from a validated shipped manifest, never a request pathname.
    const bytes = await readFile(join(this.options.fixtureRoot, asset.path));
    if (bytes.length !== asset.bytes || sceneHash(bytes) !== asset.sha256) throw new SceneError(409, 'The shipped scene fallback is damaged.');
    return bytes;
  };
  async initialize() {
    await this.storage.prepare();
    await this.options.repository.getState();
    for (const fixture of this.fixtures.values()) {
      try { await this.publish(fixture, this.fixtureReader); }
      catch (error) {
        // A damaged cache cannot block Ash startup. The read-only shipped fallback remains available.
        this.options.onWarning?.(error instanceof Error ? error.message : 'The scene cache could not be initialized.');
      }
    }
    const state = await this.options.repository.getState();
    const replacement=this.replacement(state.activeBundleId)??this.fallback;
    if ((!state.activeBundleId || this.retired(state.activeBundleId)) && await this.checkedBundle(replacement.id)) {
      await this.options.repository.compareAndSwapPointers(state.revision, { activeBundleId: replacement.id, previousBundleId: this.retired(state.previousBundleId) ? null : state.previousBundleId });
    }
    const known = new Set((await this.options.repository.listBundles()).map(bundle => bundle.id));
    await this.storage.sweepUnpublished(known);
    await this.prune();
  }
  async publish(input: SceneBundle, read: SceneAssetReader) {
    return this.serialized(async () => {
      let manifest: SceneBundle;
      try { manifest = validateSceneBundle(structuredClone(input)); } catch { throw new SceneError(400, 'The scene manifest is invalid or incompatible.'); }
      const serialized = serializeScene(manifest), manifestHash = sceneHash(serialized);
      const existing = await this.options.repository.getBundle(sceneId(manifest.id));
      if (existing && existing.manifestHash !== manifestHash) throw new SceneError(409, 'An immutable scene identity already refers to different content.');
      await this.prune();
      const sizeBytes = SCENE_ASSET_KEYS.reduce((sum, key) => sum + manifest.assets[key].bytes, Buffer.byteLength(serialized));
      const total = (await this.options.repository.listBundles()).reduce((sum, bundle) => sum + (bundle.id === manifest.id ? 0 : bundle.sizeBytes), sizeBytes);
      if (total > SCENE_STORAGE_LIMITS.totalBytes) throw new SceneError(413, 'Scene storage is full. The current scene has been kept.');
      const published = await this.storage.publish(manifest, read);
      await this.options.repository.putBundle({ id: manifest.id, manifest, ...published, createdAt: new Date() });
      return manifest;
    });
  }
  /** Publication never changes the active pointer; activation checks the exact saved bundle. */
  async activate(id: string, expectedRevision?: number) {
    return this.serialized(async () => {
      if (this.retired(id)) throw new SceneError(400, 'This legacy scene is no longer selectable.');
      const manifest = await this.getBundle(id);
      await this.storage.check(manifest);
      for (let attempt = 0; attempt < 8; attempt++) {
        const state = await this.options.repository.getState();
        if (state.activeBundleId === id) return;
        if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new SceneError(409, 'The scene changed. Choose a scene again.');
        if (await this.options.repository.compareAndSwapPointers(state.revision, { activeBundleId: id, previousBundleId: state.activeBundleId })) {
          await this.prune();
          return;
        }
      }
      throw new SceneError(409, 'Scene settings changed during activation. The current scene has been kept.');
    });
  }
  async choices(): Promise<SceneChoices> {
    const state = await this.getState();
    const scenes: SceneChoices['scenes'] = [];
    for (const record of await this.options.repository.listBundles()) {
      if (this.retired(record.id)) continue;
      try { const bundle = await this.getBundle(record.id); scenes.push({ id: bundle.id, name: bundle.name }); }
      catch { /* Damaged or incompatible saved metadata is not a selectable scene. */ }
    }
    if (!scenes.some(scene => scene.id === state.manifest.id)) scenes.push({ id: state.manifest.id, name: state.manifest.name });
    return { selectedId: state.manifest.id, revision: state.revision, scenes };
  }
  async getBundle(id: string): Promise<SceneBundle> {
    sceneId(id);
    const record = await this.options.repository.getBundle(id);
    if (!record) throw new SceneError(404, 'The scene bundle is unavailable.');
    try {
      const manifest = validateSceneBundle(record.manifest);
      if (manifest.id !== id || record.manifestHash !== sceneHash(serializeScene(manifest))) throw new Error('Corrupt manifest');
      return manifest;
    } catch { throw new SceneError(409, 'The saved scene manifest is damaged or incompatible.'); }
  }
  private async checkedBundle(id: string | null) {
    if (!id) return null;
    try { const manifest = await this.getBundle(id); await this.storage.check(manifest); return manifest; }
    catch { return null; }
  }
  async getState(): Promise<SceneStateResponse> {
    const state = await this.options.repository.getState();
    let location: SceneLocation;
    try { location = validateLocation(state.location); } catch { location = { ...DEFAULT_LOCATION }; }
    const previous = this.retired(state.previousBundleId) ? null : await this.checkedBundle(state.previousBundleId);
    const active = await this.checkedBundle(this.replacement(state.activeBundleId)?.id??state.activeBundleId);
    if (active) return { revision: state.revision, manifest: active, previous, location, source: 'active' };
    if (previous) return { revision: state.revision, manifest: previous, previous: null, location, source: 'previous' };
    for (const key of SCENE_ASSET_KEYS) await this.fixtureReader(this.fallback.assets[key], key);
    return { revision: state.revision, manifest: this.fallback, previous: null, location, source: 'fallback' };
  }
  async readAsset(id: string, hash: string): Promise<{ bytes: Buffer; asset: SceneAsset }> {
    sceneId(id); assetHash(hash);
    let manifest: SceneBundle;
    try { manifest = await this.getBundle(id); }
    catch (error) { const fixture = this.fixtures.get(id); if (!fixture) throw error; manifest = fixture; }
    const key = SCENE_ASSET_KEYS.find(key => manifest.assets[key].sha256 === hash);
    if (!key) throw new SceneError(404, 'This asset does not belong to the scene bundle.');
    const asset = manifest.assets[key];
    try { return { bytes: await this.storage.readAsset(id, asset), asset }; }
    catch (error) {
      const fixture = this.fixtures.get(id);
      if (!fixture || fixture.assets[key].sha256 !== hash) throw error;
      return { bytes: Buffer.from(await this.fixtureReader(fixture.assets[key], key)), asset };
    }
  }
  async updateLocation(input: unknown) {
    let location: SceneLocation;
    try { location = validateLocation(input); } catch { throw new SceneError(400, 'Choose a valid city and timezone.'); }
    await this.options.repository.setLocation(location);
    return this.getState();
  }
  private async prune() {
    const state = await this.options.repository.getState();
    const keep = new Set([...this.fixtures.keys(), state.activeBundleId, state.previousBundleId]);
    for (const bundle of await this.options.repository.listBundles()) {
      if (keep.has(bundle.id) || Date.now() - bundle.createdAt.getTime() < SCENE_STORAGE_LIMITS.unselectedRetentionMs) continue;
      // FK protection prevents deleting a scene which another activation has just selected.
      try { await this.options.repository.removeBundle(bundle.id); } catch { continue; }
      await this.storage.remove(bundle.id);
    }
  }
}
