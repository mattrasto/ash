import { DEFAULT_LOCATION, type SceneBundle, type SceneLocation } from '../contracts.ts';
import { serializeScene } from './storage.ts';

export interface StoredSceneBundle {
  id: string;
  manifest: SceneBundle;
  manifestHash: string;
  sizeBytes: number;
  createdAt: Date;
}
export interface StoredSceneState {
  activeBundleId: string | null;
  previousBundleId: string | null;
  location: SceneLocation | null;
  revision: number;
}

/** The host supplies metadata persistence; assets are owned by SceneStorage. */
export interface SceneRepository {
  getState(): Promise<StoredSceneState>;
  getBundle(id: string): Promise<StoredSceneBundle | null>;
  listBundles(): Promise<StoredSceneBundle[]>;
  putBundle(bundle: StoredSceneBundle): Promise<void>;
  compareAndSwapPointers(revision: number, pointers: { activeBundleId: string; previousBundleId: string | null }): Promise<boolean>;
  setLocation(location: SceneLocation): Promise<void>;
  removeBundle(id: string): Promise<void>;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type LocationJson = { name: string; latitude: number; longitude: number; timeZone: string };
type BundleRow = Omit<StoredSceneBundle, 'manifest'> & { manifest: unknown; manifestText: string };
type StateRow = Omit<StoredSceneState, 'location'> & { location: unknown };
/** Structural subset of Prisma: the package never imports the host database. */
export interface ScenePrismaClient {
  sceneBundle: {
    findUnique(args: { where: { id: string } }): PromiseLike<BundleRow | null>;
    findMany(): PromiseLike<BundleRow[]>;
    create(args: { data: Omit<StoredSceneBundle, 'manifest'> & { manifest: { [key: string]: Json }; manifestText: string } }): PromiseLike<BundleRow>;
    deleteMany(args: { where: { id: string } }): PromiseLike<{ count: number }>;
  };
  sceneState: {
    upsert(args: { where: { id: string }; create: { id: string; revision: number; location: LocationJson; updatedAt: Date }; update: Record<string, never> }): PromiseLike<StateRow>;
    updateMany(args: { where: { id: string; revision: number }; data: { activeBundleId: string; previousBundleId: string | null; revision: { increment: number }; updatedAt: Date } }): PromiseLike<{ count: number }>;
    update(args: { where: { id: string }; data: { location: LocationJson; revision: { increment: number }; updatedAt: Date } }): PromiseLike<unknown>;
  };
}

export function createPrismaSceneRepository(db: ScenePrismaClient, defaultLocation: SceneLocation = DEFAULT_LOCATION): SceneRepository {
  const stateId = 'default';
  const state = () => db.sceneState.upsert({ where: { id: stateId }, create: { id: stateId, revision: 0, location: defaultLocation, updatedAt: new Date() }, update: {} });
  return {
    async getState() { return await state() as StoredSceneState; },
    async getBundle(id) {
      const row = await db.sceneBundle.findUnique({ where: { id } });
      if (!row) return null;
      // Prisma's JSON number transport can round diagnostics. Exact saved text owns the hash.
      let manifest: SceneBundle;
      try { manifest = JSON.parse(row.manifestText); } catch { manifest = null as unknown as SceneBundle; }
      return { ...row, manifest };
    },
    async listBundles() { return await db.sceneBundle.findMany() as StoredSceneBundle[]; },
    async putBundle(bundle) {
      const manifestText = serializeScene(bundle.manifest);
      let saved = await db.sceneBundle.findUnique({ where: { id: bundle.id } });
      if (!saved) {
        try { saved = await db.sceneBundle.create({ data: { ...bundle, manifestText, manifest: bundle.manifest as unknown as { [key: string]: Json } } }); }
        catch (error) {
          saved = await db.sceneBundle.findUnique({ where: { id: bundle.id } });
          if (!saved) throw error;
        }
      }
      if (saved.manifestHash !== bundle.manifestHash || saved.sizeBytes !== bundle.sizeBytes || saved.manifestText !== manifestText) throw new Error('An immutable scene identity already refers to different content.');
    },
    async compareAndSwapPointers(revision, pointers) {
      await state();
      return (await db.sceneState.updateMany({ where: { id: stateId, revision }, data: { ...pointers, revision: { increment: 1 }, updatedAt: new Date() } })).count === 1;
    },
    async setLocation(location) {
      await state();
      await db.sceneState.update({ where: { id: stateId }, data: { location, revision: { increment: 1 }, updatedAt: new Date() } });
    },
    async removeBundle(id) { await db.sceneBundle.deleteMany({ where: { id } }); },
  };
}
