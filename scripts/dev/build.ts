import { build as bundle } from 'esbuild';
import { build as viteBuild, type InlineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function rendererConfig(checkout: string, output: string): InlineConfig {
  return {
    configFile: false, root: join(checkout, 'packages/client'), plugins: [svelte({ preprocess: vitePreprocess({ script: true }) })],
    cacheDir: join(output, 'vite-cache'), logLevel: 'warn',
    resolve: { conditions: ['browser', 'module', 'import', 'default'] },
    build: { outDir: join(output, 'renderer'), emptyOutDir: true },
  };
}
export async function buildMain(checkout: string, output: string) {
  await bundle({ entryPoints: [join(checkout, 'packages/client/src/main/index.ts')], outfile: join(output, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' });
  await bundle({ entryPoints: [join(checkout, 'packages/client/src/preload/index.ts')], outfile: join(output, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' });
  return join(output, 'main.cjs');
}
export async function buildAll(checkout: string, output: string) {
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
