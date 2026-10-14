import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PreviewInfo } from '@ash/shared';

const exec = promisify(execFile);

// Display metadata only: branch changes must never alter instance ownership.
export function previewSource(checkout: string) {
  let expires = 0;
  let pending: Promise<PreviewInfo['source']>;
  return () => {
    if (!pending || Date.now() >= expires) {
      expires = Date.now() + 5000;
      pending = Promise.all([
        exec('git', ['branch', '--show-current'], { cwd: checkout, timeout: 2000 }),
        exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout, timeout: 2000 }),
      ]).then(([branch, revision]) => ({ branch: branch.stdout.trim() || null, revision: revision.stdout.trim() }))
        .catch(() => null);
    }
    return pending;
  };
}
