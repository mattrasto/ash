import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {ServerConfig,RunState,CodingRequest,RequestPayload,modelContentText,type AdaptCheckpoint} from '../../packages/shared/src/index.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {disposeInstance} from '../../scripts/dev/lifecycle.ts';
import {devRoot,json,atomic,sleep} from '../../scripts/dev/io.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {Adapt} from '../../packages/server/src/modules/adapt/service.ts';
import {adaptRuntime} from '../../packages/server/src/modules/adapt/tools.ts';
import {AdaptSources,git,gitOutput} from '../../packages/server/src/modules/adapt/source.ts';
import {Threads} from '../../packages/server/src/modules/threads/service.ts';
import {ModelRouting} from '../../packages/server/src/modules/threads/model-routing.ts';
import {Decisions} from '../../packages/server/src/modules/decisions/service.ts';
import {AdaptApplications} from '../../packages/server/src/modules/adapt/applications.ts';
import {deterministicCoding} from '../../packages/server/src/platform/adapt/deterministic.ts';
import {releaseRoot,versionRoot,owner,directoryDigest} from '../../scripts/dev/release-store.ts';
import {refreshWorkspace} from '../../scripts/dev/adapt-refresh.ts';
import {workspaceController} from '../../packages/server/src/modules/adapt/controller.ts';
import {Attachments} from '../../packages/server/src/modules/attachments/service.ts';
import {ImageStorage} from '../../packages/server/src/modules/attachments/storage.ts';
import {decisionRuntime} from '../../packages/server/src/modules/decisions/tools.ts';
import {composeToolRuntimes} from '../../packages/server/src/modules/tools/contract.ts';
import type {ModelAdapter} from '../../packages/server/src/platform/models/adapter.ts';
import {deterministicModel} from '../../packages/server/src/platform/models/deterministic.ts';
import {screenshotFixture} from '../../packages/server/test/fixtures/images.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Automatic coding handoff and parallel Workspace reconciliation',{timeout:150000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty'),cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl),decisions=new Decisions(db),sources=new AdaptSources(ws.checkout,join(instance.root,'sources')),binding=deterministicCoding(join(instance.root,'fixture'));
  const storage=new ImageStorage(instance.root),attachments=new Attachments(db,storage,deterministicModel,false);
  const model:ModelAdapter={...deterministicModel,async*stream(request,signal,image,replay){
    const text=modelContentText(request.messages.filter(m=>m.role==='user').at(-1)?.content??'');
    if(/clarify first/i.test(text)){
      if(!request.tools?.previousOutputIds.length){const ask={callId:'clarify',name:'decisions.ask',arguments:JSON.stringify({question:'Which exact greeting should I use?',reason:'The wording is needed.',options:null})};yield {kind:'output',calls:/mixed calls/i.test(text)?[ask,{callId:'handoff',name:'adapt.start',arguments:'{}'}]:[ask]};}
      else yield {kind:'output',calls:[{callId:'handoff',name:'adapt.start',arguments:'{}'}]};return;
    }
    yield*deterministicModel.stream(request,signal,image,replay);
  }};
  const runtime=()=>composeToolRuntimes(adaptRuntime(adapt),decisionRuntime(decisions));
  let installed='development:test';
  const applications=new AdaptApplications(db,decisions,{available:true,async status(){return {phase:'idle',message:'Idle',installedVersion:installed,canRestore:false};},async prepare(){throw Error('Not used');},async apply(){throw Error('Not used');},refresh:input=>refreshWorkspace(instance,input)});
  let adapt=new Adapt(db,sources,binding,decisions,storage,undefined,undefined,applications),threads=new Threads(db,model,true,storage,runtime(),undefined,decisions,undefined,undefined,adapt);
  const until=async<T>(get:()=>Promise<T>,ready:(v:T)=>boolean,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){await adapt.pump(id=>threads.dispatch(id));const v=await get();if(ready(v))return v;await sleep(40);}throw Error('Handoff/refresh test timed out.');};
  const finished=async(id:string)=>until(()=>db.run.findUniqueOrThrow({where:{id}}),r=>{if(r.status==='failed')throw Error(JSON.stringify(r.error));return r.status==='completed';});
  const settle=async(threadId:string)=>until(()=>db.adaptExecution.count({where:{workspace:{threadId},NOT:{controller:{path:['closed'],equals:true}}}}),n=>n===0);
  const create=async(text:string)=>{const thread=randomUUID();await threads.createThread(thread,text);const run=await threads.submit(thread,randomUUID(),text,'normal');await finished(run.id);await settle(thread);return {thread,run,workspace:await db.adaptWorkspace.findUniqueOrThrow({where:{threadId:thread}})};};
  const publish=async(checkpoint:AdaptCheckpoint,workspaceId:string)=>{const id=randomUUID(),root=versionRoot(instance,id),build=join(root,'build','renderer');await mkdir(build,{recursive:true});await atomic(join(build,'fixture.json'),{fixture:true});await atomic(join(root,'version.json'),{id,owner:owner(instance),trustedCommit:checkpoint.baseRevision,trustedHash:'fixture',sourceTree:checkpoint.tree,buildDigest:await directoryDigest(build),workspaceId,checkpoint,checks:'Controlled installed source fixture.'});await atomic(join(releaseRoot(instance),'active.json'),{current:id,previous:null,confirmed:true,message:'Controlled installed source.'});installed=id;return id;};
  try{
    await scenarioStep(t,'adapt-auto-entry',async()=>{
      const thread=randomUUID();await threads.createThread(thread,'Automatic entry');
      const discussion=await threads.submit(thread,randomUUID(),'Could we change Ash’s heading? Let’s discuss options.','normal');await finished(discussion.id);assert.equal((await db.thread.findUniqueOrThrow({where:{id:thread}})).interactionMode,'chat');assert.equal(await db.adaptWorkspace.count({where:{threadId:thread}}),0);
      const image=await attachments.upload(randomUUID(),'handoff.png',await screenshotFixture());
      const key=randomUUID(),text='Change Ash using a renderer fixture change.';const [run,duplicate]=await Promise.all([threads.submit(thread,key,text,'normal',[image.id]),threads.submit(thread,key,text,'normal',[image.id])]);assert.equal(run.id,duplicate.id);await finished(run.id);await settle(thread);
      const saved=await db.run.findUniqueOrThrow({where:{id:run.id}}),state=RunState.parse(saved.state);assert.equal((await db.thread.findUniqueOrThrow({where:{id:thread}})).interactionMode,'adapt');assert.ok(state.adapt?.requestArtifactId);
      const original=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}})).payload),captured=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:state.adapt.requestArtifactId}})).payload);assert.deepEqual(captured.context.messages,original.messages);assert.deepEqual(captured.context.selection,original.selection);assert.equal(captured.context.selection.images?.[0]?.id,image.id);assert.equal(await db.artifactAttachment.count({where:{artifactId:state.adapt.requestArtifactId,attachmentId:image.id}}),1);
      assert.equal(state.tools?.calls.filter(c=>c.call.name==='adapt.start'&&c.status==='completed').length,1);assert.equal(await db.adaptExecution.count({where:{runId:run.id}}),1);assert.equal((await threads.submit(thread,key,text,'normal',[image.id])).id,run.id);
      const clarification=randomUUID();await threads.createThread(clarification,'Clarified change');const pending=await threads.submit(clarification,randomUUID(),'Change Ash’s greeting; clarify first.','normal');await until(()=>db.run.findUniqueOrThrow({where:{id:pending.id}}),r=>r.status==='waiting');
      const question=await db.decision.findFirstOrThrow({where:{threadId:clarification,status:'pending'}});await decisions.answer(question.id,{submissionId:randomUUID(),value:'Hey there!'});await finished(pending.id);await settle(clarification);
      const clarified=RunState.parse((await db.run.findUniqueOrThrow({where:{id:pending.id}})).state),handoff=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:clarified.adapt!.requestArtifactId}})).payload);assert.match(JSON.stringify(handoff.context.messages),/Which exact greeting should I use/);assert.match(JSON.stringify(handoff.context.messages),/Hey there!/);
      const mixed=randomUUID();await threads.createThread(mixed,'Mixed calls');const paused=await threads.submit(mixed,randomUUID(),'Change Ash’s greeting; clarify first using mixed calls.','normal');await until(()=>db.run.findUniqueOrThrow({where:{id:paused.id}}),r=>r.status==='waiting');assert.equal(await db.adaptWorkspace.count({where:{threadId:mixed}}),0);assert.equal((await db.thread.findUniqueOrThrow({where:{id:mixed}})).interactionMode,'chat');await threads.cancel(paused.id);
      let selectedModel='';
      const configuration=(selected:string)=>({provider:'openai' as const,model:selected,options:{api:'responses' as const,store:false as const,maxOutputTokens:1024,timeoutMs:5000,reasoningEffort:'low' as const}});
      const routedModel:ModelAdapter={...model,configuration:()=>configuration('gpt-6.1-sol'),routingConfiguration:role=>configuration(role==='fast'?'gpt-6-luna':'gpt-6.1-sol'),async*stream(request){selectedModel=request.model;yield {kind:'output',calls:[{callId:'routed_handoff',name:'adapt.start',arguments:'{}'}],continuation:[]};}};
      const routing=new ModelRouting(db,routedModel,{async assess(){return {evaluator:'controlled-router',choice:'fast_sufficient',probabilities:{fast_sufficient:1,strong_preferred:0,uncertain:0}};}});
      const routed=new Threads(db,routedModel,true,storage,adaptRuntime(adapt),undefined,decisions,undefined,routing,adapt);
      try{
        const id=randomUUID();await routed.createThread(id,'Routed Adapt handoff');const run=await routed.submit(id,randomUUID(),'Change Ash using a routed fixture.','normal');
        for(let n=0;n<600;n++){await adapt.pump(id=>routed.dispatch(id));const current=await db.run.findUniqueOrThrow({where:{id:run.id}});if(['failed','interrupted'].includes(current.status))throw Error(JSON.stringify(current.error));if(current.status==='completed')break;await sleep(40);}
        const saved=await db.run.findUniqueOrThrow({where:{id:run.id}}),state=RunState.parse(saved.state);assert.equal(saved.status,'completed');assert.equal(selectedModel,'gpt-6-luna');
        const request=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}})).payload),coding=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:state.adapt!.requestArtifactId}})).payload);
        assert.equal(request.routing?.source,'jev');assert.deepEqual(coding.context.messages,request.messages);assert.equal(await db.adaptExecution.count({where:{runId:run.id}}),1);assert.ok((await routed.inspect(state.adapt!.requestArtifactId!)).artifacts.some(a=>a.payload.type==='model_routing_request'));
      }finally{await routed.stop();}
    });
    await scenarioStep(t,'adapt-auto-recovery',async()=>{
      const thread=randomUUID();await threads.createThread(thread,'Restart handoff');const run=await threads.submit(thread,randomUUID(),'Change Ash using a renderer fixture slowly.','normal');
      await until(()=>db.run.findUniqueOrThrow({where:{id:run.id}}),r=>!!RunState.parse(r.state).adapt);await threads.stop();
      adapt=new Adapt(db,sources,binding,decisions,storage,undefined,undefined,applications);threads=new Threads(db,model,true,storage,runtime(),undefined,decisions,undefined,undefined,adapt);await threads.recover();await finished(run.id);await settle(thread);assert.equal(await db.adaptExecution.count({where:{runId:run.id}}),1);
      const cancelled=await threads.submit(thread,randomUUID(),'Make the next change slowly.','normal');await threads.cancel(cancelled.id);await settle(thread);assert.equal((await db.run.findUniqueOrThrow({where:{id:cancelled.id}})).status,'cancelled');
      const asking=randomUUID();await threads.createThread(asking,'Cancel an automatic coding question');
      const questioning=await threads.submit(asking,randomUUID(),'Change Ash and ask me for a label.','normal');await until(()=>db.run.findUniqueOrThrow({where:{id:questioning.id}}),r=>r.status==='waiting');
      const dependency=await db.decision.findFirstOrThrow({where:{threadId:asking,status:'pending'}}),questionState=RunState.parse((await db.run.findUniqueOrThrow({where:{id:questioning.id}})).state);
      assert.equal(dependency.sourceArtifactId,questionState.adapt!.requestArtifactId);
      await threads.cancel(questioning.id);await settle(asking);assert.equal((await db.decision.findUniqueOrThrow({where:{id:dependency.id}})).status,'cancelled');
      await assert.rejects(()=>decisions.answer(dependency.id,{submissionId:randomUUID(),value:'Too late'}),/cancelled/);
    });
    const a=await create('Change Ash using a renderer fixture.'),b=await create('Change Ash using a placeholder fixture.'),c=await create('Change Ash using a conflicting renderer fixture.');
    const aCheckpoint=a.workspace.checkpoint as unknown as AdaptCheckpoint,version=await publish(aCheckpoint,a.workspace.id);
    await scenarioStep(t,'adapt-refresh-parallel',async()=>{
      assert.equal((await applications.view(b.thread)).needsRefresh,true);await assert.rejects(()=>applications.prepare(b.thread,{submissionId:randomUUID(),checkpointId:(b.workspace.checkpoint as unknown as AdaptCheckpoint).id}),/Refresh Workspace/);
      const command={submissionId:randomUUID(),checkpointId:(b.workspace.checkpoint as unknown as AdaptCheckpoint).id,version};await Promise.all([adapt.refresh(b.thread,command),adapt.refresh(b.thread,command)]);
      const current=await db.adaptWorkspace.findUniqueOrThrow({where:{id:b.workspace.id}}),checkpoint=current.checkpoint as unknown as AdaptCheckpoint;assert.equal(checkpoint.id,command.submissionId);assert.deepEqual(workspaceController.parse(current.controller).integration?.conflicts,[]);assert.equal((await applications.view(b.thread)).needsRefresh,false);
      const root=join(instance.root,'assert-merged');await sources.materialize(await sources.snapshot(checkpoint.baseRevision),checkpoint,root);assert.match(await readFile(join(root,'packages/client/src/renderer/features/threads/Chat.svelte'),'utf8'),/Adapt renderer fixture\./);assert.match(await readFile(join(root,'packages/client/src/renderer/features/threads/Sidebar.svelte'),'utf8'),/<small>PARALLEL<\/small>/);await rm(root,{recursive:true});
      await assert.rejects(()=>adapt.refresh(b.thread,{...command,version:randomUUID()}),/different content/);
    });
    await scenarioStep(t,'adapt-refresh-conflicts',async()=>{
      await adapt.refresh(c.thread,{submissionId:randomUUID(),checkpointId:(c.workspace.checkpoint as unknown as AdaptCheckpoint).id,version});let current=await db.adaptWorkspace.findUniqueOrThrow({where:{id:c.workspace.id}});assert.ok(workspaceController.parse(current.controller).integration?.conflicts.includes('packages/client/src/renderer/features/threads/Chat.svelte'));
      await assert.rejects(()=>applications.prepare(c.thread,{submissionId:randomUUID(),checkpointId:(current.checkpoint as unknown as AdaptCheckpoint).id}),/Resolve merge conflicts/);
      const run=await threads.submit(c.thread,randomUUID(),'Resolve merge fixture conflicts, preserving both changes.','normal');await finished(run.id);await settle(c.thread);current=await db.adaptWorkspace.findUniqueOrThrow({where:{id:c.workspace.id}});assert.deepEqual(workspaceController.parse(current.controller).integration?.conflicts,[]);
      await assert.rejects(()=>adapt.refresh(c.thread,{submissionId:randomUUID(),checkpointId:(current.checkpoint as unknown as AdaptCheckpoint).id,version:randomUUID()}),/installed version changed/);
      const resolved=current.checkpoint as unknown as AdaptCheckpoint,base=await sources.snapshot(resolved.baseRevision),path='packages/client/src/renderer/features/threads/Chat.svelte';
      // Delete/modify and binary conflicts may retain ordinary contents without text markers.
      assert.deepEqual(await sources.unresolved(base,resolved,[path],resolved),[path]);
      const linked=join(instance.root,'linked-conflict'),canary=join(instance.root,'private-canary');await sources.materialize(base,resolved,linked);await writeFile(canary,'Private marker-free canary.');await rm(join(linked,path));await symlink(canary,join(linked,path));await git(linked,['add','--all']);
      const invalid={tree:await git(linked,['write-tree']),patch:await gitOutput(linked,['diff','--cached','--binary',base.tree])};assert.deepEqual(await sources.unresolved(base,invalid,[path],resolved),[path]);await rm(linked,{recursive:true});await rm(canary);

      const pending=await db.adaptWorkspace.findUniqueOrThrow({where:{id:b.workspace.id}}),request={submissionId:randomUUID(),workspaceId:b.workspace.id,version,checkpoint:pending.checkpoint as unknown as AdaptCheckpoint,baseline:workspaceController.parse(pending.controller).integration?.baseline};
      await refreshWorkspace(instance,request);await publish(aCheckpoint,a.workspace.id);await assert.rejects(()=>refreshWorkspace(instance,request),/installed version changed/);
    });
  }finally{await attachments.stop();await threads.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
