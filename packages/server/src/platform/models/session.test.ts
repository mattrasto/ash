import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Instance } from '@ash/shared';
import { createSession, openSession, readSession, sessionDirectory, type Session } from './session.ts';
import { configureLiveModel } from '../../../../../scripts/dev/live-model.ts';

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'ash-model-session-'));
  const instance = {id:'a'.repeat(24),workspaceId:'b'.repeat(24),devRoot:root} as Instance;
  const session:Session={version:1,id:'c'.repeat(24),instanceId:instance.id,workspaceId:instance.workspaceId,
    model:'test-openai-model',options:{api:'responses',store:false,maxOutputTokens:1024,timeoutMs:60000},
    maxCalls:2,callsUsed:0,expiresAt:new Date(Date.now()+60000).toISOString()};
  return {root,instance,session};
}
test('live call reservations serialize and persist across backend reopen and instance reset',async()=>{
  const {root,instance,session}=await fixture();
  try {
    await createSession(instance,session,'test-private-key');
    const adapter=await openSession(instance,session.id);
    const results=await Promise.allSettled([adapter.reserve(),adapter.reserve(),adapter.reserve()]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
    assert.equal((await adapter.info()).session!.callsUsed,2);
    const reopened=await openSession({...instance,generation:'d'.repeat(24)},session.id);
    await assert.rejects(reopened.reserve(),/call allowance/);
    assert.ok(!JSON.stringify(await reopened.info()).includes('test-private-key'));
    assert.equal((await stat(join(sessionDirectory(instance,session.id),'credential'))).mode & 0o777,0o600);
    assert.ok(!(await readFile(join(sessionDirectory(instance,session.id),'session.json'),'utf8')).includes('test-private-key'));
    await assert.rejects(readSession({...instance,id:'e'.repeat(24)},session.id),/ownership/);
    await assert.rejects(createSession(instance,session,'test-private-key'),/exist/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('expired sessions cannot dispatch and default launches ignore inherited credentials',async()=>{
  const {root,instance,session}=await fixture();
  try {
    await createSession(instance,{...session,expiresAt:new Date(Date.now()-1000).toISOString()},'test-private-key');
    await assert.rejects((await openSession(instance,session.id)).reserve(),/expired/);
    assert.equal((await readSession(instance,session.id)).callsUsed,0);
    assert.equal(await configureLiveModel(instance,{}),undefined);
    await assert.rejects(configureLiveModel(instance,{'openai-model':'test-model'}),/live-minutes/);
    await assert.rejects(configureLiveModel(instance,{'openai-model':'test-model','live-minutes':'10'}),/live-calls/);
    await assert.rejects(configureLiveModel(instance,{'live-session':session.id,'live-calls':'10'}),/without changing/);
    assert.equal(await configureLiveModel(instance,{'live-session':session.id}),session.id);
  } finally {await rm(root,{recursive:true,force:true});}
});
