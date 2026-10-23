import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {ServerConfig,type AdaptApplicationView} from '../../packages/shared/src/index.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {Adapt} from '../../packages/server/src/modules/adapt/service.ts';
import {AdaptApplications} from '../../packages/server/src/modules/adapt/applications.ts';
import {AdaptSources} from '../../packages/server/src/modules/adapt/source.ts';
import {Threads} from '../../packages/server/src/modules/threads/service.ts';
import {Decisions} from '../../packages/server/src/modules/decisions/service.ts';
import {deterministicCoding} from '../../packages/server/src/platform/adapt/deterministic.ts';
import type {ApplicationController} from '../../packages/server/src/modules/adapt/contract.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {disposeInstance} from '../../scripts/dev/lifecycle.ts';
import {devRoot,json} from '../../scripts/dev/io.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Adapt application authority and durable product records',{timeout:120000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty');
  const config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl),decisions=new Decisions(db);
  const jobs=new Map<string,AdaptApplicationView>();let applies=0;
  const controller:ApplicationController={available:true,status:async id=>jobs.get(id??'')??{phase:'idle',message:'Idle',installedVersion:'development:test',canRestore:false},prepare:async input=>{
    if(!jobs.has(input.candidateId))jobs.set(input.candidateId,{phase:'ready',message:'Protected checks passed.',installedVersion:'development:test',canRestore:false,evidence:{type:'adapt_candidate',candidateId:input.candidateId,workspaceId:input.workspaceId,checkpointId:input.checkpoint.id,action:input.action,targetVersion:'development:test',versionId:input.candidateId,sourceTree:input.checkpoint.tree,buildDigest:'a'.repeat(64),policy:'renderer-release-v1',checks:'Controlled external verifier.'}});
    return jobs.get(input.candidateId)!;
  },apply:async id=>{const job=jobs.get(id)!;if(job.phase!=='applied'){applies++;job.phase='applied';job.installedVersion=id;job.message='Applied';}return job;}};
  const binding=deterministicCoding(join(instance.root,'fixture')),sources=new AdaptSources(ws.checkout,join(instance.root,'sources'));
  let applications=new AdaptApplications(db,decisions,controller),adapt=new Adapt(db,sources,binding,decisions,undefined,undefined,undefined,applications),threads=new Threads(db,undefined,true,undefined,undefined,undefined,decisions,undefined,undefined,adapt);
  const until=async<T>(read:()=>Promise<T>,ready:(value:T)=>boolean)=>{const end=Date.now()+25000;while(Date.now()<end){await adapt.pump(id=>threads.dispatch(id));const value=await read();if(ready(value))return value;await new Promise(r=>setTimeout(r,50));}throw Error('Application test timed out.');};
  const thread=randomUUID();
  try{
    await threads.createThread(thread,'Application test');await adapt.mode(thread,{mode:'adapt',expectedMode:'chat'});
    const run=await threads.submit(thread,randomUUID(),'Prepare a UI fixture','normal');await until(()=>db.run.findUniqueOrThrow({where:{id:run.id}}),r=>r.status==='completed');
    const checkpoint=(await threads.readThread(thread)).workspace!.checkpoint!;
    let candidate='',decision='';
    await scenarioStep(t,'adapt-application-authority',async()=>{
      candidate=randomUUID();const command={submissionId:candidate,checkpointId:checkpoint.id,action:'apply'};
      await Promise.all([applications.prepare(thread,command),applications.prepare(thread,command)]);
      const view=await until(()=>applications.view(thread),v=>v.phase==='awaiting_approval');decision=view.decisionId!;assert.ok(decision);
      const prepared=await threads.inspect(run.state.request_artifact_id);assert.ok(prepared.artifacts.some(a=>a.payload.type==='adapt_preparation'));assert.ok(prepared.artifacts.some(a=>a.payload.type==='adapt_candidate'));
      assert.equal(await db.artifact.count({where:{id:candidate}}),1);assert.equal(applies,0);
      await assert.rejects(()=>applications.prepare(thread,{...command,action:'restore'}),/different content/);
      await assert.rejects(()=>decisions.answer(decision,{submissionId:randomUUID(),value:'approve'},'chat'),/Decision controls/);
      await decisions.answer(decision,{submissionId:randomUUID(),value:'approve'});
      await until(()=>applications.view(thread),v=>v.phase==='applied');await applications.pump();assert.equal(applies,1);
      const captures=await db.artifact.findMany({where:{threadId:thread,layer:'act'}});assert.ok(captures.some(a=>(a.payload as {type:string}).type==='adapt_application'));
      assert.ok((await threads.inspect(checkpoint.id)).artifacts.some(a=>a.payload.type==='adapt_application'));
      await assert.rejects(()=>db.artifact.update({where:{id:candidate},data:{payload:{type:'changed'}}}),/immutable/);
    });
    await scenarioStep(t,'adapt-application-stale',async()=>{
      const candidate2=randomUUID();await applications.prepare(thread,{submissionId:candidate2,checkpointId:checkpoint.id});
      const pending=await until(()=>applications.view(thread),v=>v.phase==='awaiting_approval');
      const next=await threads.submit(thread,randomUUID(),'Continue this source change','normal');await until(()=>db.run.findUniqueOrThrow({where:{id:next.id}}),r=>r.status==='completed');
      await until(()=>applications.view(thread),v=>v.phase==='stale');assert.equal((await db.decision.findUniqueOrThrow({where:{id:pending.decisionId!}})).status,'cancelled');assert.equal(applies,1);
    });
    await scenarioStep(t,'adapt-application-recovery',async()=>{
      const current=(await threads.readThread(thread)).workspace!.checkpoint!;
      await applications.prepare(thread,{submissionId:randomUUID(),checkpointId:current.id});
      const original=await until(()=>applications.view(thread),v=>v.phase==='awaiting_approval');
      applications=new AdaptApplications(db,decisions,controller);adapt=new Adapt(db,sources,binding,decisions,undefined,undefined,undefined,applications);
      assert.equal((await applications.view(thread)).decisionId,original.decisionId);
      await decisions.answer(original.decisionId!,{submissionId:randomUUID(),value:'approve'});await applications.pump();await applications.pump();assert.equal(applies,2);
    });
  }finally{await threads.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
