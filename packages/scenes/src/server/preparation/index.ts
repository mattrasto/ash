import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREPARATION_LIMITS, RECIPE, MODEL_IDS, RUNTIME_VERSION } from './constants.js';
import { verifyModelInstallation } from './models.ts';
import type { PreparedScene, PreparationAvailability, PreparationOptions, SceneModelInstallation, PreparationAssetKey } from './types.ts';
export type { PreparedScene, PreparationAvailability, PreparationOptions, SceneModelInstallation, SceneModelPin, SceneModelFile, PreparationInference, Segmentation, PreparationAssetKey } from './types.ts';
export { PREPARATION_LIMITS, RECIPE, MODEL_IDS, RUNTIME_VERSION, verifyModelInstallation };

export class ScenePreparationError extends Error {
  constructor(public code: 'unavailable' | 'busy' | 'invalid-source' | 'failed' | 'timeout', message: string) { super(message); this.name = 'ScenePreparationError'; }
}
export interface ScenePreparerOptions {
  installation?: SceneModelInstallation;
  /** Host-packaged worker entry; defaults to the adjacent source worker. */
  workerModule?: URL;
  /** Trusted local module exporting createInference. Explicitly recorded as injected, never as pinned production inference. */
  inferenceModule?: URL;
}
const keys: PreparationAssetKey[] = ['source', 'mask', 'candidate', 'depth', 'surfaces'];
async function runtimeAvailable() {
  let path = dirname(fileURLToPath(import.meta.resolve('@huggingface/transformers')));
  for (let level = 0; level < 4; level++, path = dirname(path)) {
    try {
      const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
      if (manifest.name === '@huggingface/transformers') {
        if (manifest.version !== RUNTIME_VERSION) throw new Error('Scene preparation needs Transformers.js 4.3.1.');
        return;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new Error('The pinned local inference runtime is unavailable.');
}

/** One transient CPU worker per preparation; no playback, model installation or durable scheduling side effects. */
export class ScenePreparer {
  private busy = false;
  private options: ScenePreparerOptions;
  constructor(options: ScenePreparerOptions = {}) { this.options = { ...options, ...(options.installation ? { installation: structuredClone(options.installation) } : {}) }; }
  private async check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.options.inferenceModule) {
      if (this.options.inferenceModule.protocol !== 'file:') throw new Error('Injected scene inference must be a trusted local file.');
      const stat = await lstat(fileURLToPath(this.options.inferenceModule));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The injected inference module is unavailable.');
      return;
    }
    if (!this.options.installation) throw new Error('Scene preparation models are not installed. Install the pinned CPU FP32 models separately; cached scene playback needs no models.');
    await runtimeAvailable();
    await verifyModelInstallation(this.options.installation, signal);
  }
  async availability(): Promise<PreparationAvailability> {
    if (this.busy) return { available: false, issues: ['A scene is already being prepared on this local CPU adapter.'] };
    try { await this.check(); return { available: true, issues: [] }; }
    catch (error) { return { available: false, issues: [error instanceof Error ? error.message : 'Scene preparation is unavailable.'] }; }
  }
  async prepare(source: Uint8Array, options: PreparationOptions = {}): Promise<PreparedScene> {
    options.signal?.throwIfAborted();
    if (this.busy) throw new ScenePreparationError('busy', 'A scene is already being prepared. The current scene has been kept.');
    if (!source.length || source.length > PREPARATION_LIMITS.sourceBytes) throw new ScenePreparationError('invalid-source', 'Scene artwork must be a PNG no larger than 24 MiB.');
    const bytes = Uint8Array.from(source), sourceHash = createHash('sha256').update(bytes).digest('hex');
    this.busy = true;
    try {
      try { await this.check(options.signal); }
      catch (error) { options.signal?.throwIfAborted(); throw new ScenePreparationError('unavailable', error instanceof Error ? error.message : 'Scene preparation is unavailable.'); }
      return await new Promise<PreparedScene>((resolve, reject) => {
        const worker = new Worker(this.options.workerModule ?? new URL('./worker.js', import.meta.url), { workerData: { source: bytes, installation: this.options.installation, inferenceModule: this.options.inferenceModule?.href }, transferList: [bytes.buffer], resourceLimits: { maxOldGenerationSizeMb: 512 } });
        let settled = false;
        const finish = (error?: unknown, result?: PreparedScene) => {
          if (settled) return; settled = true; clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);
          void worker.terminate().then(() => { if (error) reject(error); else resolve(result!); }, terminationError => reject(error ?? terminationError));
        };
        const abort = () => finish(options.signal?.reason ?? new DOMException('Scene preparation cancelled.', 'AbortError'));
        const timeout = setTimeout(() => finish(new ScenePreparationError('timeout', 'Local scene preparation exceeded five minutes. The current scene has been kept.')), PREPARATION_LIMITS.timeoutMs);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) { abort(); return; }
        worker.on('message', (message: { type: string; stage?: string; message?: string; result?: PreparedScene }) => {
          if (settled) return;
          if (message.type === 'progress') { try { options.onProgress?.(message.stage!); } catch (error) { finish(error); } }
          else if (message.type === 'error') finish(new ScenePreparationError('failed', message.message ?? 'Local scene preparation failed.'));
          else if (message.type === 'result' && message.result) {
            const result = message.result;
            for (const key of keys) result.assets[key] = Buffer.from(result.assets[key]);
            if (result.provenance.sourceHash !== sourceHash || createHash('sha256').update(result.assets.source).digest('hex') !== sourceHash) finish(new ScenePreparationError('failed', 'Preparation changed the original artwork.'));
            else finish(undefined, result);
          }
        });
        worker.once('error', error => finish(new ScenePreparationError('failed', error.message)));
        worker.once('exit', code => { if (!settled) finish(new ScenePreparationError('failed', `The scene preparation worker stopped before producing a complete scene (${code}).`)); });
      });
    } finally { this.busy = false; }
  }
}
