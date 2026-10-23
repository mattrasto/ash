import { SCENE_ASSET_KEYS, validateSceneBundle, type ResolvedSceneBundle, type SceneAsset, type SceneAssetKey } from '../contracts.ts';

const CACHE = 'ash-scenes-assets-v1';
const pinnedHashes = new Map<string, number>();
let cleanupEpoch = 0;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
export async function validateAssetBytes(bytes: Uint8Array, asset: SceneAsset): Promise<void> {
  if (bytes.length !== asset.bytes || bytes.length < 24 || signature.some((n, i) => bytes[i] !== n)) throw new Error('Scene asset encoding or size is invalid.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' || view.getUint32(16) !== asset.width || view.getUint32(20) !== asset.height) throw new Error('Scene asset dimensions do not match its manifest.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error('Scene asset integrity check failed.');
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || response.type === 'opaque' || Number(response.headers.get('content-length')) > limit) throw new Error('Scene asset could not be downloaded.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Scene asset has no content.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > limit) throw new Error('Scene asset exceeds its declared size.'); chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function prepareSceneAssets(bundle: ResolvedSceneBundle, signal: AbortSignal): Promise<{ urls: Record<SceneAssetKey, string>; dispose: () => void }> {
  const manifest = validateSceneBundle(bundle.manifest), objectUrls: string[] = [];
  const hashes = SCENE_ASSET_KEYS.map(key => manifest.assets[key].sha256);
  for (const hash of hashes) pinnedHashes.set(hash, (pinnedHashes.get(hash) ?? 0) + 1);
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    for (const hash of hashes) { const count = (pinnedHashes.get(hash) ?? 1) - 1; if (count) pinnedHashes.set(hash, count); else pinnedHashes.delete(hash); }
  };
  const failure = new AbortController(); signal = AbortSignal.any([signal, failure.signal, AbortSignal.timeout(30000)]);
  let cache: Cache | undefined;
  try { if (typeof caches !== 'undefined') cache = await caches.open(CACHE); } catch { /* Private/disabled storage still permits shipped playback. */ }
  try {
    const results = await Promise.allSettled(SCENE_ASSET_KEYS.map(async key => {
      try {
      const asset = manifest.assets[key], url = new URL(bundle.assetUrls[key], location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || url.username || url.password) throw new Error('Scene assets must come from this Ash instance.');
      const cacheUrl = new URL(`/__ash_scene_cache__/${asset.sha256}`, location.origin).href;
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      const existing = await cache?.match(cacheUrl);
      if (existing) {
        try { bytes = await readBounded(existing, asset.bytes, signal); await validateAssetBytes(bytes, asset); }
        catch (error) { signal.throwIfAborted(); bytes = undefined; await cache?.delete(cacheUrl); }
      }
      if (!bytes) {
        const response = await fetch(url, { signal, credentials: 'same-origin', redirect: 'error' });
        bytes = await readBounded(response, asset.bytes, signal); await validateAssetBytes(bytes, asset); signal.throwIfAborted();
        try { await cache?.put(cacheUrl, new Response(bytes, { headers: { 'content-type': 'image/png' } })); } catch { /* Cache quota never prevents a validated scene. */ }
      }
      signal.throwIfAborted(); const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); objectUrls.push(objectUrl);
      return [key, objectUrl] as const;
      } catch (error) { failure.abort(error); throw error; }
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const values = results.map(result => (result as PromiseFulfilledResult<readonly [SceneAssetKey, string]>).value);
    return { urls: Object.fromEntries(values) as Record<SceneAssetKey, string>, dispose };
  } catch (error) { dispose(); throw error; }
}

/** Bound browser disk storage to the successful current and previous bundles. */
export async function retainSceneAssets(hashes: readonly string[]): Promise<void> {
  const epoch = ++cleanupEpoch;
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE), keep = new Set(hashes);
    for (const request of await cache.keys()) {
      if (epoch !== cleanupEpoch) return;
      const hash = new URL(request.url).pathname.split('/').at(-1)!;
      if (!keep.has(hash) && !pinnedHashes.has(hash)) await cache.delete(request);
    }
  } catch { /* Storage housekeeping is best effort; it never changes active playback. */ }
}
