import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { MODEL_IDS, RUNTIME_VERSION } from './constants.js';
import type { SceneModelInstallation } from './types.ts';

const required = ['config.json', 'preprocessor_config.json', 'onnx/model.onnx'];
async function directory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Model installation must contain regular directories.');
}
/** Validate an explicit installation lock without downloading, modifying or executing model files. */
export async function verifyModelInstallation(installation: SceneModelInstallation, signal?: AbortSignal): Promise<void> {
  if (!installation || installation.runtimeVersion !== RUNTIME_VERSION || typeof installation.cacheRoot !== 'string' || !isAbsolute(installation.cacheRoot) || !Array.isArray(installation.models) || installation.models.length !== 3) throw new Error('Install the pinned Transformers.js 4.3.1 CPU models before preparing a scene.');
  await directory(installation.cacheRoot);
  const roles = new Set<string>();
  for (const model of installation.models) {
    signal?.throwIfAborted();
    if (!model || !(model.role in MODEL_IDS) || roles.has(model.role) || model.id !== MODEL_IDS[model.role] || !/^[a-f0-9]{40}$/.test(model.revision)) throw new Error('Each preparation model needs its exact model ID and pinned commit revision.');
    roles.add(model.role);
    if (!Array.isArray(model.files) || model.files.length > 64 || required.some(path => !model.files.some(file => file.path === path))) throw new Error('The model installation lock is missing required configuration or FP32 weights.');
    const seen = new Set<string>();
    for (const file of model.files) {
      signal?.throwIfAborted();
      if (!file || typeof file.path !== 'string' || file.path.split('/').some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..') || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error('The model installation lock contains an invalid file.');
      seen.add(file.path);
      const parts = [...model.id.split('/'), ...file.path.split('/')];
      let parent = installation.cacheRoot;
      for (const part of parts.slice(0, -1)) { parent = join(parent, part); await directory(parent); }
      const handle = await open(join(parent, parts.at(-1)!), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== file.bytes) throw new Error('A preparation model file is missing or differs from its installation lock.');
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) { signal?.throwIfAborted(); hash.update(chunk); }
        if (hash.digest('hex') !== file.sha256) throw new Error('A preparation model file failed its pinned SHA-256 check.');
      } finally { await handle.close(); }
    }
  }
}
