import type { Instance } from '../../packages/shared/src/index.ts';
import { createSession, readSession, Session } from '../../packages/server/src/platform/models/session.ts';
import { id } from './io.ts';

export interface LiveOptions {
  'openai-model'?: string; 'live-session'?: string; 'live-calls'?: string; 'live-minutes'?: string;
  'max-output-tokens'?: string; 'reasoning-effort'?: string;
}
export async function configureLiveModel(instance: Instance, options: LiveOptions) {
  const tuning = ['live-calls','live-minutes','max-output-tokens','reasoning-effort'] as const;
  if (options['live-session']) {
    if (options['openai-model'] || tuning.some(key=>options[key])) throw new Error('Resume a live session without changing its model or limits');
    await readSession(instance,options['live-session']);
    return options['live-session'];
  }
  if (!options['openai-model']) {
    if (tuning.some(key=>options[key])) throw new Error('Live limits require --openai-model');
    return undefined;
  }
  const minutes = Number(options['live-minutes']);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) throw new Error('Set --live-minutes between 0 and 120');
  const session = Session.safeParse({version:1,id:id(),workspaceId:instance.workspaceId,instanceId:instance.id,
    model:options['openai-model'],maxCalls:Number(options['live-calls']),callsUsed:0,expiresAt:new Date(Date.now()+minutes*60000).toISOString(),
    options:{api:'responses',store:false,maxOutputTokens:Number(options['max-output-tokens'] ?? 1024),timeoutMs:60000,
      ...(options['reasoning-effort'] ? {reasoningEffort:options['reasoning-effort']} : {})}});
  if (!session.success) throw new Error('Invalid live settings: choose a model, --live-calls 1–1000 and --max-output-tokens 16–16384');
  await createSession(instance,session.data,process.env.OPENAI_API_KEY ?? '');
  return session.data.id;
}
