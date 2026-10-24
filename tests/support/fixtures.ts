import { test as base, expect } from '@playwright/test';
import { join } from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { devRoot, exists, id, atomic } from '../../scripts/dev/io.ts';
import { workspace, createInstance, instancePath } from '../../scripts/dev/workspace.ts';
import { startInstance, disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { desktop } from './desktop.ts';
import { redact } from './results.ts';
import type { Instance } from '../../packages/shared/src/index.ts';
import { scenario } from '../scenarios.ts';
import { preparePreset, type PresetState } from './presets.ts';

type Desktop = Awaited<ReturnType<typeof desktop>>;
export const test = base.extend<{ instance: Instance; given: PresetState; ash: Desktop }>({
  instance: async ({}, use, testInfo) => {
    const ws = await workspace(process.cwd(), await devRoot());
    const instanceId = id();
    const root = instancePath(ws, instanceId);
    try {
      const instance = await createInstance(ws, 'test', 'scratchpad', instanceId);
      await startInstance(ws, instanceId, { headless: true });
      await use(instance);
    } finally {
      // Keep diagnostic logs before disposal, but never copy runtime config/credentials.
      let diagnosticError: string | undefined;
      try {
        await mkdir(testInfo.outputDir, { recursive: true });
        for (const name of await readdir(join(root, 'logs')).catch(() => [])) {
          const path = testInfo.outputPath(name);
          await writeFile(path, redact(await readFile(join(root, 'logs', name), 'utf8')));
          await testInfo.attach(name, { path, contentType: 'text/plain' });
        }
      } catch (error) { diagnosticError = redact(String(error)); }
      let cleanupError: string | undefined;
      try {
        if (await exists(join(root, 'instance.json'))) await disposeInstance(ws, instanceId);
      } catch (error) { cleanupError = redact(String(error)); }
      await atomic(testInfo.outputPath('cleanup.json'), { instanceId, cleanupError, diagnosticError, completedAt: new Date().toISOString() });
      if (cleanupError || diagnosticError) throw new Error([cleanupError, diagnosticError].filter(Boolean).join('\n'));
    }
  },
  given: async ({ instance }, use, testInfo) => {
    const preset = scenario(testInfo.title.split(':')[0]).preset;
    // Fresh provisioning already supplies blank_slate; populated recipes finish before app boot.
    await use(preset ? await preparePreset(instance, preset) : { name: 'blank_slate' });
  },
  ash: async ({ instance, given }, use, testInfo) => {
    const ash = await desktop(instance);
    // Exclude network/DOM snapshots: they may capture authenticated requests. The trace retains actions and screenshots.
    try {
      await ash.app.context().tracing.start({ screenshots: true, snapshots: false, sources: false });
      await use(ash);
    }
    finally {
      try {
        if (!ash.page.isClosed()) {
          const screenshot = testInfo.outputPath('final.png');
          await ash.page.screenshot({ path: screenshot });
          await testInfo.attach('final', { path: screenshot, contentType: 'image/png' });
          const trace = testInfo.outputPath('trace.zip');
          await ash.app.context().tracing.stop({ path: trace });
          await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
        }
      } finally { if (!ash.page.isClosed()) await ash.close(); }
      expect(ash.errors, 'Unexpected renderer errors').toEqual([]);
    }
  },
});
export { expect };
