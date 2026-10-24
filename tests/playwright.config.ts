import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const outputOwner = process.env.ASH_TEST_NODE_ID;

export default defineConfig({
  testDir: './e2e',
  // Each runner clears its output directory at startup; graph nodes must own separate roots.
  outputDir: join(process.env.ASH_TEST_EVIDENCE ?? 'out/verification', 'desktop', outputOwner ? createHash('sha256').update(outputOwner).digest('hex') : 'direct'),
  workers: Number(process.env.ASH_TEST_WORKERS ?? 1),
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', scale: 'css', maxDiffPixels: 0 } },
  updateSnapshots: 'none',
  snapshotPathTemplate: `{testDir}/../baselines/${process.platform}-${process.arch}/{arg}{ext}`,
  reporter: [['list'], ['./support/playwright-reporter.ts']],
});
