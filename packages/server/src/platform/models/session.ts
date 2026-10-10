import { z } from 'zod';
import { mkdir, readFile, writeFile, rename, lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Identity, OpenAIOptions, type Instance, type ModelInfo } from '@ash/shared';
import { ModelFailure } from './adapter.ts';

export const Session = z.object({
  version:z.literal(1), id:Identity, workspaceId:Identity, instanceId:Identity,
  model:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/), options:OpenAIOptions,
  maxCalls:z.number().int().min(1).max(1000), callsUsed:z.number().int().nonnegative(),
  expiresAt:z.string().datetime(),
}).strict();
export type Session = z.infer<typeof Session>;
export function sessionDirectory(instance: Pick<Instance,'devRoot'|'workspaceId'>, id: string) {
  return join(instance.devRoot,'workspaces',Identity.parse(instance.workspaceId),'model-sessions',Identity.parse(id));
}
export async function createSession(instance: Instance, session: Session, apiKey: string) {
  session = Session.parse(session);
  if (session.instanceId !== instance.id || session.workspaceId !== instance.workspaceId) throw new Error('Model session ownership mismatch');
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error('Set OPENAI_API_KEY in the launching terminal for live mode');
  const root = sessionDirectory(instance,session.id);
  await mkdir(join(root,'..'),{recursive:true,mode:0o700});
  await mkdir(root,{mode:0o700});
  await writeFile(join(root,'credential'),apiKey,{mode:0o600,flag:'wx'});
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
  return value.data;
}
export async function openSession(instance: Instance, id: string) {
  const session = await readSession(instance,id);
  const root = sessionDirectory(instance,id);
  const stat = await lstat(join(root,'credential'));
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Model credential must be a private regular file (0600)');
  const apiKey = await readFile(join(root,'credential'),'utf8');
  // The database owner lock guarantees a single backend; this queue serializes its threads.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    apiKey,model:session.model,options:session.options,
    async reserve() {
      const reservation = tail.then(async () => {
        const current = await readSession(instance,id);
        const remaining = Date.parse(current.expiresAt) - Date.now();
        if (remaining <= 0) throw new ModelFailure('session_expired','The live model session has expired. Start a new bounded session to continue.');
        if (current.callsUsed >= current.maxCalls) throw new ModelFailure('session_call_limit','The live model session has used its call allowance.');
        current.callsUsed++;
        const temp = join(root,`${randomUUID()}.tmp`);
        await writeFile(temp,JSON.stringify(current),{mode:0o600,flag:'wx'});
        await rename(temp,join(root,'session.json'));
        const left = Date.parse(current.expiresAt) - Date.now();
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
export async function removeSessionCredentials(instance: Instance) {
  const parent = join(sessionDirectory(instance,'0'.repeat(24)),'..');
  const entries = await readdir(parent).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  for (const id of entries) {
    if (!Identity.safeParse(id).success) continue;
    try { await readSession(instance,id); }
    catch (error) { if (error instanceof Error && error.message === 'Model session ownership mismatch') continue; throw error; }
    await rm(join(sessionDirectory(instance,id),'credential'),{force:true});
  }
}
