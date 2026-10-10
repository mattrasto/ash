import { scenarioTest } from '../support/node-scenarios.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { guardedPath, withLock, childEnvironment, stopProcess, atomic } from '../../scripts/dev/io.ts';

scenarioTest('boundary-paths', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ash-guard-')));
  try {
    await mkdir(join(root, 'owned'));
    await symlink('/tmp', join(root, 'escape'));
    await guardedPath(root, join(root, 'owned/file'));
    await assert.rejects(guardedPath(root, root), /outside/);
    await assert.rejects(guardedPath(root, join(root, '..')), /outside/);
    await assert.rejects(guardedPath(root, join(root, 'escape/file')), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
scenarioTest('boundary-locks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ash-lock-'));
  const sequence: number[] = [];
  try {
    await atomic(join(root, 'locks/same-instance/owner.json'), {pid:process.pid, identity:'expired owner'});
    await Promise.all([1, 2, 3].map(n => withLock(root, 'same-instance', async () => {
      sequence.push(n); await new Promise(r => setTimeout(r, 20)); sequence.push(n);
    })));
    for (let i = 0; i < sequence.length; i += 2) assert.equal(sequence[i], sequence[i + 1]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
scenarioTest('boundary-environment', () => {
  const before = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = 'test-secret'; process.env.DATABASE_URL = 'test-url'; process.env.NODE_OPTIONS = '--test';
    const env = childEnvironment('/tmp/ash-test');
    assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.DATABASE_URL, undefined); assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.TMPDIR, '/tmp/ash-test');
  } finally { process.env = before; }
});
scenarioTest('boundary-process', async () => {
  await stopProcess({ pid: process.pid, identity: 'not this process' }, true);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});
