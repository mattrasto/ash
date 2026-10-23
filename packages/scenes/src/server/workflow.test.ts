import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SceneCandidateStorage } from './workflow.ts';

test('candidate metadata cannot bypass admission limits, while prior outcomes stay discoverable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ash-scene-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new SceneCandidateStorage(root), inputId = randomUUID(), callId = randomUUID(), hash = 'a'.repeat(64);
  assert.deepEqual(await storage.claim(inputId, callId, hash), { fresh: true, callId });
  await Promise.all(Array.from({ length: 511 }, async () => writeFile(join(storage.root, 'events', `${randomUUID()}.json`), JSON.stringify({ callId: randomUUID(), intentHash: hash }))));
  await assert.rejects(storage.claim(randomUUID(), randomUUID(), hash), /record limit/);
  assert.equal(await storage.prior(inputId, hash), callId);
  assert.deepEqual(await storage.claim(inputId, randomUUID(), hash), { fresh: false, callId }, 'Full storage must not suppress a previously admitted outcome.');
  await assert.rejects(storage.prior(inputId, 'b'.repeat(64)), /different scene intent/);
});
