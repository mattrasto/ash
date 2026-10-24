import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { scenarioTest } from '../support/node-scenarios.ts';
import { preparePreset, presetApi } from '../support/presets.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { devRoot, json } from '../../scripts/dev/io.ts';
import { ServerConfig, messageText, type Instance, type ThreadDetail, type InspectionView, type AssessmentView } from '../../packages/shared/src/index.ts';

scenarioTest('verification-presets', async () => {
  const ws = await workspace(process.cwd(), await devRoot());
  const instances: Instance[] = [];
  try {
    for (let n = 0; n < 2; n++) {
      const instance = await createInstance(ws, 'test', 'empty');instances.push(instance);
      await startInstance(ws, instance.id, { headless: true });
    }
    const [a, b] = instances;
    assert.notEqual(a.database, b.database);
    const ac = ServerConfig.parse(await json(join(a.root, 'server.json'))), bc = ServerConfig.parse(await json(join(b.root, 'server.json')));
    assert.ok(ac.token !== bc.token, 'Fresh instance credentials');
    await assert.rejects(preparePreset({ ...a, profile: 'preview' }, { name: 'blank_slate' }), /disposable test/);
    await assert.rejects(preparePreset(a, { name: 'conversation_ready', message: '' }), /Invalid preset/);
    await assert.rejects(preparePreset(a, { name: 'conversation_ready', message: 'Aborted' }, AbortSignal.abort()), /abort/i);
    await preparePreset(a, { name: 'blank_slate' });
    const [left, right] = await Promise.all(instances.map(instance => preparePreset(instance, { name: 'conversation_ready', message: 'Hello Ash.' })));
    assert.notEqual(left.threadId, right.threadId);
    assert.notEqual(left.runId, right.runId);
    const apiA = await presetApi(a), apiB = await presetApi(b);
    for (const [api, state] of [[apiA, left], [apiB, right]] as const) {
      const detail = await api<ThreadDetail>(`/api/threads/${state.threadId}`);
      assert.equal(detail.thread.title, 'Hello Ash.');
      assert.equal(detail.runs.length, 1);assert.equal(detail.runs[0].status, 'completed');
      assert.equal(detail.thread.lifecycle?.kind, 'indefinite');assert.equal(detail.thread.lifecycle?.deadline, null);
      assert.equal(detail.artifacts.length, 2);assert.equal(detail.changes.length, 1);
      const assessments = await api<AssessmentView[]>(`/api/threads/${state.threadId}/assessments`);
      assert.ok(['naming','visibility'].every(kind => assessments.some(a => a.kind === kind && a.status === 'applied' && a.finishedAt)));
      assert.ok(assessments.every(a => a.status !== 'running'));
      const user = detail.artifacts.find(v => v.payload.type === 'message' && v.payload.speaker === 'user')!;
      assert.equal(user.payload.type === 'message' && messageText(user.payload), 'Hello Ash.');
      const inspection = await api<InspectionView>(`/api/artifacts/${state.responseId}`);
      assert.ok(inspection.artifacts.some(v => v.payload.type === 'model_request' && v.payload.provider === 'deterministic'));
    }
    const detail = await apiA<ThreadDetail>(`/api/threads/${left.threadId}`);
    await apiA(`/api/threads/${left.threadId}`, { title: 'Only copy A changed', expectedVersion: detail.thread.lifecycle!.version, requestId: randomUUID() });
    assert.equal((await apiB<ThreadDetail>(`/api/threads/${right.threadId}`)).thread.title, 'Hello Ash.');
    await assert.rejects(preparePreset(a, { name: 'conversation_ready', message: 'Must not reset' }), /blank instance/);
    assert.equal((await apiA<ThreadDetail>(`/api/threads/${left.threadId}`)).thread.title, 'Only copy A changed');
  } finally {
    // Dispose both copies even if one cleanup fails.
    const results = await Promise.allSettled(instances.map(instance => disposeInstance(ws, instance.id)));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(r => (r as PromiseRejectedResult).reason), 'Preset cleanup failed');
  }
});
