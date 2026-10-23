import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { join, resolve } from 'node:path';
import {rendererConfig} from './renderer-config.ts';
export {rendererConfig} from './renderer-config.ts';
import { fileURLToPath } from 'node:url';
import {cp,mkdir} from 'node:fs/promises';

export async function buildMain(checkout: string, output: string) {
  await bundle({ entryPoints: [join(checkout, 'packages/client/src/main/index.ts')], outfile: join(output, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' });
  await bundle({ entryPoints: [join(checkout, 'packages/client/src/preload/index.ts')], outfile: join(output, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' });
  return join(output, 'main.cjs');
}
export async function buildAll(checkout: string, output: string) {
  await mkdir(join(output,'scenes'),{recursive:true});
  await cp(join(checkout,'packages/scenes/src/fixtures/assets'),join(output,'scenes/assets'),{recursive:true});
  await buildMain(checkout, output);
  const priorEnvironment = process.env.NODE_ENV;
  try { await viteBuild(rendererConfig(checkout, output)); }
  finally {
    if (priorEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorEnvironment;
  }
  await bundle({ entryPoints: [join(checkout, 'packages/server/src/main.ts')], outfile: join(output, 'server.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'warning' });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildAll(process.cwd(), resolve(process.argv[2] ?? 'dist'));
}
