import { z } from 'zod';
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Identity, OpenAIOptions, type Instance, type ModelInfo } from '@ash/shared';
import { ModelFailure } from './adapter.ts';

export const Session = z.object({
  version:z.literal(1), id:Identity, workspaceId:Identity, instanceId:Identity,
  model:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/), options:OpenAIOptions,
  maxCalls:z.number().int().min(1).max(1000).nullable(), callsUsed:z.number().int().nonnegative(),
  expiresAt:z.string().datetime().nullable(),
}).strict().refine(value=>(value.maxCalls===null)===(value.expiresAt===null),'Call limit and expiry must both be set or both be null');
export type Session = z.infer<typeof Session>;
export function sessionDirectory(instance: Pick<Instance,'devRoot'|'workspaceId'>, id: string) {
  return join(instance.devRoot,'workspaces',Identity.parse(instance.workspaceId),'model-sessions',Identity.parse(id));
}
export async function createSession(instance: Instance, session: Session) {
  session = Session.parse(session);
  if (session.instanceId !== instance.id || session.workspaceId !== instance.workspaceId) throw new Error('Model session ownership mismatch');
  if (session.maxCalls === null && instance.profile !== 'preview') throw new Error('Disposable live tests require call and time limits');
  const root = sessionDirectory(instance,session.id);
  await mkdir(join(root,'..'),{recursive:true,mode:0o700});
  await mkdir(root,{mode:0o700});
  await writeFile(join(root,'session.json'),JSON.stringify(session),{mode:0o600,flag:'wx'});
}
export async function readSession(instance: Instance, id: string) {
  const root = sessionDirectory(instance,id);
  for (const path of [join(root,'..'),root,join(root,'session.json')]) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Refusing a symlink in model session state');
  }
  const value = Session.safeParse(JSON.parse(await readFile(join(root,'session.json'),'utf8')));
  if (!value.success) throw new Error('Invalid model session configuration');
  if (value.data.id !== id || value.data.instanceId !== instance.id || value.data.workspaceId !== instance.workspaceId) throw new Error('Model session ownership mismatch');
  if (value.data.maxCalls === null && instance.profile !== 'preview') throw new Error('Disposable live tests require call and time limits');
  return value.data;
}
export async function openSession(instance: Instance, id: string) {
  const session = await readSession(instance,id);
  const root = sessionDirectory(instance,id);
  // The database owner lock guarantees a single backend; this queue serializes its threads.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    model:session.model,options:session.options,
    async reserve() {
      const reservation = tail.then(async () => {
        const current = await readSession(instance,id);
        const remaining = current.expiresAt === null ? current.options.timeoutMs : Date.parse(current.expiresAt) - Date.now();
        if (remaining <= 0) throw new ModelFailure('session_expired','The live model session has expired. Start a new bounded session to continue.');
        if (current.maxCalls !== null && current.callsUsed >= current.maxCalls) throw new ModelFailure('session_call_limit','The live model session has used its call allowance.');
        current.callsUsed++;
        const temp = join(root,`${randomUUID()}.tmp`);
        await writeFile(temp,JSON.stringify(current),{mode:0o600,flag:'wx'});
        await rename(temp,join(root,'session.json'));
        const left = current.expiresAt === null ? current.options.timeoutMs : Date.parse(current.expiresAt) - Date.now();
        if (left <= 0) throw new ModelFailure('session_expired','The live model session expired before dispatch.');
        return left;
      });
      tail = reservation.catch(() => {});
      return reservation;
    },
    async info():Promise<ModelInfo> {
      const current = await readSession(instance,id);
      return {provider:'openai',model:current.model,session:{id,callsUsed:current.callsUsed,maxCalls:current.maxCalls,expiresAt:current.expiresAt}};
    },
  };
}
