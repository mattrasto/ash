import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { SCENE_ASSET_KEYS, validateSceneBundle, type SceneAsset, type SceneAssetKey, type SceneBundle } from '../contracts.ts';

export class SceneError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const SCENE_STORAGE_LIMITS = Object.freeze({ bundleBytes: 128 * 1024 * 1024, totalBytes: 512 * 1024 * 1024, pixels: 24_000_000, staleStagingMs: 60 * 60 * 1000, unselectedRetentionMs: 24 * 60 * 60 * 1000 });
export const sceneHash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function sceneId(id: string) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new SceneError(400, 'Invalid scene identity.');
  return id;
}
export function assetHash(hash: string) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new SceneError(400, 'Invalid scene asset identity.');
  return hash;
}
/** Stable serialization makes the database and saved manifest independently checkable. */
export function serializeScene(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(serializeScene).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + serializeScene((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new SceneError(400, 'Scene metadata contains an invalid value.');
}
export type SceneAssetReader = (asset: SceneAsset, key: SceneAssetKey) => Promise<Uint8Array>;

export async function validateSceneAssetPixels(bytes: Buffer, asset: SceneAsset, key: SceneAssetKey) {
  try {
    // libvips may expose only an APNG's first frame; scan the container too.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new Error('Animated PNG');
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: SCENE_STORAGE_LIMITS.pixels });
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 || metadata.width !== asset.width || metadata.height !== asset.height || (metadata.orientation ?? 1) !== 1) throw new Error('Invalid dimensions or encoding');
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    if (key === 'mask' || key === 'surfaces' || key === 'depth') {
      if (metadata.depth !== 'uchar') throw new Error('Map must use eight-bit samples');
      for (let offset = 0; offset < data.length; offset += info.channels) {
        if (info.channels >= 3 && (data[offset] !== data[offset + 1] || data[offset] !== data[offset + 2])) throw new Error('Map must be grayscale');
        if (info.channels === 2 && data[offset + 1] !== 255 || info.channels === 4 && data[offset + 3] !== 255) throw new Error('Map must be opaque');
        if (key === 'surfaces' && data[offset] > 5) throw new Error('Unknown surface class');
      }
    }
  } catch { throw new SceneError(400, 'Scene assets must decode as aligned still PNG images with valid map values.'); }
}

export class SceneStorage {
  readonly root: string;
  constructor(private instanceRoot: string) { this.root = join(instanceRoot, 'files', 'scenes'); }
  private async directory(path: string) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SceneError(409, 'Scene storage is not a regular instance directory.');
  }
  async prepare() {
    for (const path of [this.instanceRoot, join(this.instanceRoot, 'files'), this.root]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      await this.directory(path);
    }
  }
  private async write(path: string, bytes: Uint8Array | string) {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  }
  private async file(path: string, bytes: number, hash: string) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes) throw new Error('Invalid scene asset');
      const content = await file.readFile();
      if (sceneHash(content) !== hash) throw new Error('Corrupt scene asset');
      return content;
    } finally { await file.close(); }
  }
  async publish(manifest: SceneBundle, read: SceneAssetReader) {
    try { validateSceneBundle(manifest); } catch { throw new SceneError(400, 'The scene manifest is invalid or incompatible.'); }
    const id = sceneId(manifest.id), serialized = serializeScene(manifest);
    const assets = SCENE_ASSET_KEYS.map(key => [key, manifest.assets[key]] as const);
    const sizeBytes = assets.reduce((sum, [, asset]) => sum + asset.bytes, 0) + Buffer.byteLength(serialized);
    if (sizeBytes > SCENE_STORAGE_LIMITS.bundleBytes) throw new SceneError(413, 'The scene bundle exceeds its storage limit.');
    await this.prepare();
    const staging = join(this.root, '.staging-' + randomUUID());
    await mkdir(staging, { mode: 0o700 });
    try {
      const written = new Set<string>();
      for (const [key, asset] of assets) {
        assetHash(asset.sha256);
        const bytes = Buffer.from(await read(asset, key));
        if (bytes.length !== asset.bytes || sceneHash(bytes) !== asset.sha256) throw new SceneError(409, 'Scene asset content does not match its manifest.');
      await validateSceneAssetPixels(bytes, asset, key);
        if (!written.has(asset.sha256)) { await this.write(join(staging, asset.sha256), bytes); written.add(asset.sha256); }
      }
      await this.write(join(staging, 'manifest.json'), serialized);
      // Durably stage all files before making this directory addressable.
      const directory = await open(staging, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      try { await rename(staging, join(this.root, id)); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      await this.check(manifest);
      const root = await open(this.root, 'r');
      try { await root.sync(); } finally { await root.close(); }
      return { manifestHash: sceneHash(serialized), sizeBytes };
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async readAsset(id: string, asset: SceneAsset) {
    sceneId(id); assetHash(asset.sha256);
    try {
      await this.prepare(); await this.directory(join(this.root, id));
      return await this.file(join(this.root, id, asset.sha256), asset.bytes, asset.sha256);
    } catch { throw new SceneError(409, 'The saved scene is missing or damaged.'); }
  }
  async check(manifest: SceneBundle) {
    const id = sceneId(manifest.id), serialized = serializeScene(manifest);
    try {
      await this.prepare(); await this.directory(join(this.root, id));
      await this.file(join(this.root, id, 'manifest.json'), Buffer.byteLength(serialized), sceneHash(serialized));
      for (const asset of Object.values(manifest.assets)) await this.readAsset(id, asset);
    } catch { throw new SceneError(409, 'The saved scene is missing or damaged.'); }
  }
  async remove(id: string) { sceneId(id); await this.prepare(); await rm(join(this.root, id), { recursive: true, force: true }); }
  async sweepUnpublished(known: ReadonlySet<string>, now = Date.now()) {
    await this.prepare();
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (known.has(entry.name) || !entry.name.startsWith('.staging-') && !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.name)) continue;
      const path = join(this.root, entry.name), stat = await lstat(path);
      if (now - stat.mtimeMs > SCENE_STORAGE_LIMITS.staleStagingMs) await rm(path, { recursive: true, force: true });
    }
  }
}
