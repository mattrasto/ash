import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Instance } from '@ash/shared';
import { createSession, openSession, readSession, sessionDirectory, type Session } from './session.ts';
import { configureLiveModel } from '../../../../../scripts/dev/live-model.ts';

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'ash-model-session-'));
  await writeFile(join(root,'.env.local'),'OPENAI_API_KEY=synthetic-key\n',{mode:0o600});
  const instance = {id:'a'.repeat(24),workspaceId:'b'.repeat(24),devRoot:root,checkout:root,profile:'preview'} as Instance;
  const session:Session={version:1,id:'c'.repeat(24),instanceId:instance.id,workspaceId:instance.workspaceId,
    model:'test-openai-model',options:{api:'responses',store:false,maxOutputTokens:1024,timeoutMs:60000},
    maxCalls:2,callsUsed:0,expiresAt:new Date(Date.now()+60000).toISOString()};
  return {root,instance,session};
}
test('live call reservations serialize and persist across backend reopen and instance reset',async()=>{
  const {root,instance,session}=await fixture();
  try {
    await createSession(instance,session);
    const adapter=await openSession(instance,session.id);
    const results=await Promise.allSettled([adapter.reserve(),adapter.reserve(),adapter.reserve()]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
    assert.equal((await adapter.info()).session!.callsUsed,2);
    const reopened=await openSession({...instance,generation:'d'.repeat(24)},session.id);
    await assert.rejects(reopened.reserve(),/call allowance/);
    assert.equal('apiKey' in reopened,false);
    assert.deepEqual(await readdir(sessionDirectory(instance,session.id)),['session.json']);
    assert.deepEqual(JSON.parse(await readFile(join(sessionDirectory(instance,session.id),'session.json'),'utf8')),{...session,callsUsed:2});
    await assert.rejects(readSession({...instance,id:'e'.repeat(24)},session.id),/ownership/);
    await assert.rejects(createSession(instance,session),/exist/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('expired sessions cannot dispatch and explicit demos need no live session',async()=>{
  const {root,instance,session}=await fixture();
  try {
    await createSession(instance,{...session,expiresAt:new Date(Date.now()-1000).toISOString()});
    await assert.rejects((await openSession(instance,session.id)).reserve(),/expired/);
    assert.equal((await readSession(instance,session.id)).callsUsed,0);
    assert.equal(await configureLiveModel(instance,{deterministic:true}),undefined);
    assert.equal(await configureLiveModel({...instance,profile:'test'},{}),undefined);
    await assert.rejects(configureLiveModel(instance,{'openai-model':'test-model','live-minutes':'10'}),/live-calls/);
    await assert.rejects(configureLiveModel(instance,{'openai-model':'test-model','live-calls':'5'}),/live-minutes/);
    await assert.rejects(configureLiveModel(instance,{'live-session':session.id,'live-calls':'10'}),/without changing/);
    assert.equal(await configureLiveModel(instance,{'live-session':session.id}),session.id);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('interactive sessions keep counting across reopen without a call cap or expiry',async t=>{
  const {root,instance}=await fixture();
  t.after(()=>rm(root,{recursive:true,force:true}));
  const id=(await configureLiveModel(instance,{'openai-model':'test-model','reasoning-effort':'low'}))!;
  const adapter=await openSession(instance,id);
  const reservations=await Promise.all(Array.from({length:7},()=>adapter.reserve()));
  assert.deepEqual(reservations,Array(7).fill(60000));
  const later=Date.now()+11*60*1000;
  t.mock.method(Date,'now',()=>later);
  const reopened=await openSession(instance,id);
  assert.equal(await reopened.reserve(),60000);
  assert.deepEqual((await reopened.info()).session,{id,callsUsed:8,maxCalls:null,expiresAt:null});
  assert.equal(await configureLiveModel(instance,{'live-session':id}),id);
});
test('disposable live tests require paired explicit limits, including on resume',async t=>{
  const {root,instance,session}=await fixture();
  t.after(()=>rm(root,{recursive:true,force:true}));
  const disposable={...instance,profile:'test' as const};
  await assert.rejects(configureLiveModel(disposable,{'openai-model':'test-model'}),/live-calls and --live-minutes/);
  await assert.rejects(createSession(instance,{...session,maxCalls:null}),/both/);
  await assert.rejects(createSession(instance,{...session,expiresAt:null}),/both/);
  const interactive={...session,maxCalls:null,expiresAt:null};
  await assert.rejects(createSession(disposable,interactive),/require call and time limits/);
  await createSession(instance,interactive);
  await assert.rejects(configureLiveModel(disposable,{'live-session':interactive.id}),/require call and time limits/);
  const bounded=(await configureLiveModel(disposable,{'openai-model':'test-model','live-calls':'3','live-minutes':'5'}))!;
  assert.equal((await readSession(disposable,bounded)).maxCalls,3);
});
