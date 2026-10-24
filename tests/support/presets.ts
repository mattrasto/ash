import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ServerConfig, type Instance, type ThreadDetail, type ThreadView, type InspectionView, type PreviewInfo, type RunView, type AssessmentView } from '../../packages/shared/src/index.ts';
import { json, sleep } from '../../scripts/dev/io.ts';
import { runtime } from '../../scripts/dev/lifecycle.ts';
import { measure } from '../../scripts/dev/telemetry.ts';

export type Preset = { name: 'blank_slate' } | { name: 'conversation_ready'; message: string };
export interface PresetState { name: Preset['name']; threadId?: string; runId?: string; responseId?: string }

// Recipes construct only preconditions. Every invocation owns a fresh instance, never a reset shared app.
export async function preparePreset(instance: Instance, preset: Preset, signal = AbortSignal.timeout(30_000)): Promise<PresetState> {
  if (instance.profile !== 'test') throw new Error('Presets require a disposable test instance');
  if (!['blank_slate', 'conversation_ready'].includes(preset.name)) throw new Error('Unknown test preset');
  if (preset.name === 'conversation_ready' && (!preset.message.trim() || preset.message.length > 4000)) throw new Error('Invalid preset message');
  signal.throwIfAborted();
  return measure(`preset.${preset.name}`, async () => {
    const api = await presetApi(instance, signal);
    const [threads, topics, info] = await Promise.all([api<ThreadView[]>('/api/threads'), api<unknown[]>('/api/topics'), api<PreviewInfo>('/api/info')]);
    if (threads.length || topics.length) throw new Error('Preset requires a blank instance; existing state will not be cleared');
    if (info.model?.provider !== 'deterministic') throw new Error('Preset construction requires the deterministic model');
    if (preset.name === 'blank_slate') return { name: preset.name };
    const threadId = randomUUID();
    await api('/api/threads', { id: threadId, title: 'Untitled' });
    const run = await api<RunView>(`/api/threads/${threadId}/messages`, { text: preset.message, mode: 'normal', requestKey: randomUUID() });
    let detail: ThreadDetail;
    do {
      signal.throwIfAborted();
      detail = await api<ThreadDetail>(`/api/threads/${threadId}`);
      const current = detail.runs.find(value => value.id === run.id);
      if (current && !['queued', 'running'].includes(current.status)) {
        if (current.status !== 'completed') throw new Error(`Preset response ended as ${current.status}`);
        // Await naming/visibility settlement too: consumers must not race background preconditions.
        const lifecycle = detail.thread.lifecycle;
        if (lifecycle && lifecycle.kind === 'indefinite' && lifecycle.deadline === null) {
          // Lifecycle counters mark claims, not finished work. Check saved outcomes before reuse.
          const assessments = await api<AssessmentView[]>(`/api/threads/${threadId}/assessments`);
          if (['naming', 'visibility'].every(kind => assessments.some(a => a.kind === kind && a.status === 'applied' && a.finishedAt)) && assessments.every(a => a.status !== 'running')) {
            detail = await api<ThreadDetail>(`/api/threads/${threadId}`);
            break;
          }
        }
        if (lifecycle && ['until', 'immediate', 'failed'].includes(lifecycle.kind)) throw new Error(`Preset visibility ended as ${lifecycle.kind}; expected indefinite history`);
      }
      await sleep(25);
    } while (true);
    if (detail.runs.length !== 1 || detail.artifacts.length !== 2 || detail.thread.activeWork || detail.thread.waitingWork || detail.thread.isArchived || detail.thread.lifecycle?.kind !== 'indefinite' || detail.thread.lifecycle.deadline !== null) throw new Error('Preset did not reach one completed visible exchange without expiry');
    const response = detail.artifacts.find(value => value.payload.type === 'message' && value.payload.speaker === 'ash');
    if (!response) throw new Error('Preset response is missing');
    const inspection = await api<InspectionView>(`/api/artifacts/${response.id}`);
    if (!inspection.artifacts.some(value => value.id === detail.runs[0].state.request_artifact_id && value.payload.type === 'model_request' && value.payload.provider === 'deterministic')) throw new Error('Preset captured request is missing');
    return { name: preset.name, threadId, runId: run.id, responseId: response.id };
  }, instance.id);
}

export async function presetApi(instance: Instance, signal = AbortSignal.timeout(15_000)) {
  const current = await runtime(instance);
  if (!current) throw new Error('Preset instance is not running');
  const config = ServerConfig.parse(await json(join(instance.root, 'server.json')));
  return async <T = unknown>(path: string, body?: object): Promise<T> => {
    const response = await fetch(`${current.serverUrl}${path}`, {
      method: body ? 'POST' : 'GET', signal,
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Preset API ${path}: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  };
}
