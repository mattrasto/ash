import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile,mkdir } from 'node:fs/promises';
import { ServerConfig,RunState,CodingRequest,type RunView } from '../../packages/shared/src/index.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { Adapt } from '../../packages/server/src/modules/adapt/service.ts';
import { AdaptSources } from '../../packages/server/src/modules/adapt/source.ts';
import { ProviderFailure,EnvironmentExpired,type PreviewController } from '../../packages/server/src/modules/adapt/contract.ts';
import { deterministicCoding } from '../../packages/server/src/platform/adapt/deterministic.ts';
import { Decisions } from '../../packages/server/src/modules/decisions/service.ts';
import { workspace,createInstance } from '../../scripts/dev/workspace.ts';
import { disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { devRoot,json } from '../../scripts/dev/io.ts';
import { scenarioStep } from '../support/node-scenarios.ts';

test('Adapt: captured coding Runs, durable Decisions and adapter recovery',{timeout:180000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty');
  const config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl);
  const root=join(instance.root,'adapt'),sources=new AdaptSources(process.cwd(),join(root,'source'));
  const decisions=new Decisions(db),binding=deterministicCoding(join(root,'fixture'));
  let creates=0,submissions=0,loseCreate=false,expire=false;
  const create=binding.harness.create,submit=binding.harness.submit,observe=binding.harness.observe;
  binding.harness.create=async(...args)=>{creates++;const result=await create(...args);if(loseCreate){loseCreate=false;throw new ProviderFailure(true,'lost_response','Creation response lost.');}return result;};
  binding.harness.submit=async(...args)=>{submissions++;return submit(...args);};
  binding.harness.observe=async(...args)=>{if(expire){expire=false;throw new EnvironmentExpired();}return observe(...args);};
  let adapt=new Adapt(db,sources,binding,decisions),threads=new Threads(db,undefined,true,undefined,undefined,undefined,decisions,undefined,undefined,adapt);
  const services=[threads];
  const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
  async function until<T>(get:()=>Promise<T>,ready:(value:T)=>boolean,timeout=25000){const deadline=Date.now()+timeout;while(Date.now()<deadline){await adapt.pump(id=>threads.dispatch(id));const value=await get();if(ready(value))return value;await pause();}throw new Error('Timed out awaiting Adapt progress.');}
  const settled=async(id:string,status='completed')=>{const row=await until(()=>db.run.findUniqueOrThrow({where:{id}}),row=>{if(['failed','interrupted','cancelled','completed'].includes(row.status)&&row.status!==status)throw new Error(JSON.stringify({status:row.status,error:row.error,state:row.state}));return row.status===status;});if(status==='failed')await until(()=>db.adaptExecution.findUniqueOrThrow({where:{runId:id}}),value=>(value.controller as {closed:boolean}).closed);return row;};
  const newThread=async()=>{const id=randomUUID();await threads.createThread(id,'Adapt integration');await adapt.mode(id,{mode:'adapt',expectedMode:'chat'});return id;};
  let target='',run:RunView;
  try{
    await scenarioStep(t,'adapt-capture',async()=>{
      target=await newThread();const key=randomUUID();
      const [first,duplicate]=await Promise.all([threads.submit(target,key,'Make a source change','normal'),threads.submit(target,key,'Make a source change','normal')]);assert.equal(first.id,duplicate.id);run=first;
      await adapt.mode(target,{mode:'chat',expectedMode:'adapt'});
      await assert.rejects(()=>threads.submit(target,key,'Different request','normal'),/different content/);
      await settled(run.id);
      assert.equal((await threads.submit(target,key,'Make a source change','normal')).id,run.id);
      assert.equal(creates,1);assert.equal(submissions,1);
      const detail=await threads.readThread(target);assert.equal(detail.thread.interactionMode,'chat');assert.equal(detail.workspace?.baseRevision,await sources.revision());assert.ok(detail.workspace?.checkpoint?.patch.includes('ADAPT_FIXTURE.md'));
      const inspect=await threads.inspect(run.state.request_artifact_id),capture=CodingRequest.parse(inspect.artifacts.find(a=>a.id===run.state.request_artifact_id)!.payload);
      assert.equal(capture.workspaceId,detail.workspace!.id);assert.equal(capture.context.messages.at(-1)!.role,'user');
      assert.ok(!JSON.stringify(detail).includes('session-'));assert.ok(!JSON.stringify(inspect).includes('environmentId'));
      const normal=await threads.submit(target,randomUUID(),'Discuss what changed','normal');await settled(normal.id);
      assert.equal((await threads.inspect(normal.state.request_artifact_id)).artifacts.find(a=>a.id===normal.state.request_artifact_id)!.payload.type,'model_request');
    });
    await scenarioStep(t,'adapt-decisions-restart',async()=>{
      const thread=await newThread(),question=await threads.submit(thread,randomUUID(),'Ask me for a label','normal');await settled(question.id,'waiting');
      const before=(await decisions.list(thread))[0];assert.ok(before);assert.equal(before.status,'pending');
      const controller=await db.adaptExecution.findUniqueOrThrow({where:{runId:question.id}});
      await threads.stop();adapt=new Adapt(db,sources,binding,decisions);threads=new Threads(db,undefined,true,undefined,undefined,undefined,decisions,undefined,undefined,adapt);services.push(threads);await threads.recover();
      assert.equal((await db.run.findUniqueOrThrow({where:{id:question.id}})).status,'waiting');
      const answer={submissionId:randomUUID(),value:'Blue'};await decisions.answer(before.id,answer);await decisions.answer(before.id,answer);await assert.rejects(()=>decisions.answer(before.id,{submissionId:randomUUID(),value:'Red'}),/immutable/);
      await settled(question.id);assert.equal((await decisions.list(thread)).length,1);
      const saved=RunState.parse((await db.run.findUniqueOrThrow({where:{id:question.id}})).state);assert.equal(saved.decisions![0].status,'consumed');
      assert.deepEqual((await db.adaptExecution.findUniqueOrThrow({where:{runId:question.id}})).controller&&((await db.adaptExecution.findUniqueOrThrow({where:{runId:question.id}})).controller as {session:unknown}).session,(controller.controller as {session:unknown}).session);
    });
    await scenarioStep(t,'adapt-cancel-parallel',async()=>{
      const a=await newThread(),b=await newThread();const waiting=await threads.submit(a,randomUUID(),'Ask me for a label','normal');await settled(waiting.id,'waiting');
      const pending=(await decisions.list(a))[0],other=await threads.submit(b,randomUUID(),'Make an independent change','normal');
      await threads.cancel(waiting.id);await settled(other.id);await until(()=>db.adaptExecution.findUniqueOrThrow({where:{runId:waiting.id}}),row=>(row.controller as {cancelled:boolean}).cancelled);
      assert.equal((await decisions.list(a))[0].status,'cancelled');await assert.rejects(()=>decisions.answer(pending.id,{submissionId:randomUUID(),value:'Too late'}),/cancelled/);
      assert.equal((await db.run.findUniqueOrThrow({where:{id:waiting.id}})).status,'cancelled');
      assert.notEqual((await threads.readThread(a)).workspace!.id,(await threads.readThread(b)).workspace!.id);
      assert.equal((await db.adaptWorkspace.findUniqueOrThrow({where:{threadId:a}})).controller&&'lease' in ((await db.adaptWorkspace.findUniqueOrThrow({where:{threadId:a}})).controller as object),false);
    });
    await scenarioStep(t,'adapt-recovery',async()=>{
      const unknown=await newThread();loseCreate=true;const first=await threads.submit(unknown,randomUUID(),'Recover a lost response','normal');
      await until(()=>db.adaptExecution.findUniqueOrThrow({where:{runId:first.id}}),row=>(row.controller as {phase:string}).phase==='creating-session'&&!!(row.controller as {retryAt?:number}).retryAt);
      const createdBefore=creates;const row=await db.adaptExecution.findUniqueOrThrow({where:{runId:first.id}});await db.adaptExecution.update({where:{runId:first.id},data:{controller:{...(row.controller as object),retryAt:0}}});
      await settled(first.id);assert.equal(creates,createdBefore);
      const detail=await threads.readThread(unknown),tree=detail.workspace!.checkpoint!.tree;expire=true;
      const lost=await threads.submit(unknown,randomUUID(),'Continue the change','normal');await settled(lost.id,'failed');assert.equal((await threads.readThread(unknown)).workspace!.checkpoint!.tree,tree);
      const retry=await threads.retry(lost.id,randomUUID(),'normal');await settled(retry.id);assert.equal((await threads.readThread(unknown)).workspace!.checkpoint!.tree,tree);
      const stale=await threads.retry(first.id,randomUUID(),'normal');await settled(stale.id,'failed');assert.equal((await db.run.findUniqueOrThrow({where:{id:stale.id}})).error&&((await db.run.findUniqueOrThrow({where:{id:stale.id}})).error as {code:string}).code,'workspace_changed');
      const waiting=await threads.submit(unknown,randomUUID(),'Ask me for a label','normal');await settled(waiting.id,'waiting');await assert.rejects(()=>threads.retry(lost.id,randomUUID(),'normal'),/Workspace is already active/);await threads.cancel(waiting.id);await until(()=>db.adaptExecution.findUniqueOrThrow({where:{runId:waiting.id}}),value=>(value.controller as {closed:boolean}).closed);
      const replacement={...deterministicCoding(join(root,'replacement')),id:'replacement-fixture'};
      await until(()=>db.adaptExecution.findUniqueOrThrow({where:{runId:retry.id}}),row=>(row.controller as {closed:boolean}).closed);
      await threads.stop();adapt=new Adapt(db,sources,replacement,decisions);threads=new Threads(db,undefined,true,undefined,undefined,undefined,decisions,undefined,undefined,adapt);services.push(threads);
      const next=await threads.submit(unknown,randomUUID(),'Continue with another adapter','normal');await settled(next.id);assert.equal((await threads.readThread(unknown)).workspace!.id,detail.workspace!.id);
      assert.equal((await threads.readThread(unknown)).workspace!.checkpoint!.tree,tree);
    });
    await scenarioStep(t,'adapt-checkpoint-boundary',async()=>{
      const snapshot=await sources.snapshot(await sources.revision());await mkdir(root,{recursive:true});
      await sources.verify(snapshot,{patch:'',tree:snapshot.tree,checks:'No changes'});
      await assert.rejects(()=>sources.verify(snapshot,{patch:'diff --git a/../../escape b/../../escape\nnew file mode 100644\n--- /dev/null\n+++ b/../../escape\n@@ -0,0 +1 @@\n+escape\n',tree:snapshot.tree,checks:''}));
      await assert.rejects(()=>sources.verify(snapshot,{patch:'',tree:'0'.repeat(40),checks:''}),/claimed Git tree/);
      const captured=await db.artifact.findUniqueOrThrow({where:{id:run!.state.request_artifact_id}});await assert.rejects(()=>db.artifact.update({where:{id:captured.id},data:{payload:{type:'changed'}}}),/immutable/);
    });
    await scenarioStep(t,'adapt-preview-follow',async()=>{
      let online=false,open=false,busy=false,syncs=0,shown:string|undefined;
      const status=()=>({phase:busy?'preparing' as const:open?'running' as const:'stopped' as const,running:open,checkpointId:shown,message:'Controlled preview.'});
      const previews:PreviewController={available:true,status:async()=>status(),command:async()=>status(),sync:async workspace=>{syncs++;if(!online)throw Error('Controller unavailable');if(open&&!busy)shown=workspace.checkpoint?.id;return status();}};
      const restart=async()=>{await threads.stop();adapt=new Adapt(db,sources,binding,decisions,undefined,previews);threads=new Threads(db,undefined,true,undefined,undefined,undefined,decisions,undefined,undefined,adapt);services.push(threads);await threads.recover();};
      await restart();const thread=await newThread(),first=await threads.submit(thread,randomUUID(),'Save preview follow-up source','normal');await settled(first.id);
      const pending=()=>db.adaptWorkspace.findUniqueOrThrow({where:{threadId:thread}});
      await until(pending,row=>(row.controller as {previewPending?:boolean}).previewPending===true);
      assert.equal((await db.run.findUniqueOrThrow({where:{id:first.id}})).status,'completed','Preview controller failure must not fail completed coding.');
      online=true;await restart();await until(pending,row=>!(row.controller as {previewPending?:boolean}).previewPending);
      assert.ok(syncs>0);assert.equal(shown,undefined,'Completing code must not automatically open a stopped preview.');
      open=true;busy=true;const second=await threads.submit(thread,randomUUID(),'Continue with another source checkpoint','normal');await settled(second.id);
      await until(pending,row=>(row.controller as {previewPending?:boolean}).previewPending===true);
      busy=false;await until(pending,row=>!(row.controller as {previewPending?:boolean}).previewPending);
      assert.equal(shown,(await threads.readThread(thread)).workspace!.checkpoint!.id,'A running preview must follow the latest completed checkpoint.');
    });
  }finally{for(const service of services)await service.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
