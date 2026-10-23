import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ModelRoutingRequest, RequestPayload, RunState, ServerConfig, ThreadLifecycle, type RequestPayload as Request } from '../../packages/shared/src/index.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { ModelRouting } from '../../packages/server/src/modules/threads/model-routing.ts';
import { jevRouter, type RoutingJudge } from '../../packages/server/src/platform/models/jev-router.ts';
import { openAIModel } from '../../packages/server/src/platform/models/openai.ts';
import { Organization } from '../../packages/server/src/modules/organization/service.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { devRoot, json, sleep } from '../../scripts/dev/io.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { providerResponse, sse, successEvents } from '../helpers/openai.ts';
import { retrievalTool } from '../support/retrieval-tool.ts';
import type { ToolRuntime } from '../../packages/server/src/modules/tools/contract.ts';

const fast={model:'jev-1.13.0',answers:{route:{type:'choice',choice:'fast_sufficient',probabilities:{fast_sufficient:0.97,strong_preferred:0.02,uncertain:0.01}}},usage:{input_tokens:87,output_tokens:0}};
const strong={...fast,answers:{route:{type:'choice',choice:'strong_preferred',probabilities:{fast_sufficient:0.02,strong_preferred:0.97,uncertain:0.01}}}};
async function until<T>(get:()=>Promise<T>,ready:(value:T)=>boolean){for(let n=0;n<400;n++){const value=await get();if(ready(value))return value;await sleep(15);}throw Error('Routing test timed out');}

test('Model routing: durable selection through real persistence and controlled provider protocols',{timeout:180000},async t=>{
 const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty');
 const config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl),org=new Organization(db);
 const workers:Threads[]=[];let routerCalls=0,wire:Array<Record<string,unknown>>=[],failInference=false,toolMode=false;
 const packets:Array<Record<string,unknown>>=[];
 let routerReply=fast;
 const judge=jevRouter('synthetic-jev',async(url,init)=>{
   assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-jev');
   routerCalls++;packets.push(JSON.parse(init!.body as string));return Response.json(routerReply);
 });
 let reservations=0;
 const model=openAIModel({apiKey:'synthetic-openai',model:'gpt-6.1-sol',routingEnabled:true,options:{api:'responses',store:false,maxOutputTokens:1024,timeoutMs:1000,reasoningEffort:'low'},reserve:async()=>{reservations++;return 60000;},info:async()=>({provider:'openai',model:'gpt-6.1-sol'})},async(_url,init)=>{
   const body=JSON.parse(init!.body as string);wire.push(body);
   if(failInference)return new Response('{}',{status:500,headers:{'content-type':'application/json'}});
   const final=providerResponse('Saved routed reply.');final.model=body.model;
   if(toolMode&&!(body.input as Array<{type?:string}>).some(item=>item.type==='function_call_output')){
     const response={...final,output:[{type:'function_call',id:'call-item',name:'ash_0',call_id:'query-call',arguments:'{"query":"evidence"}',status:'completed'}]};
     return sse([{type:'response.completed',response}]);
   }
   return sse(successEvents('Saved routed reply.').map(event=>'response' in event?{...event,response:{...event.response,model:body.model}}:event));
 });
 const runtime:ToolRuntime={tools:[retrievalTool(async()=>({status:'success',content:[{type:'text',text:'Evidence'}],references:[],omissions:[]}))],resources:async()=>[{kind:'fixture',id:'scope',label:'Fixture context'}],authorize:async()=>({outcome:'allowed',code:'fixture',message:'Allowed fixture',configurationRevision:'1',evaluator:'not-performed'})};
 function service(selectedJudge:RoutingJudge=judge,timeout=1000,tools?:ToolRuntime){const router=new ModelRouting(db,model,selectedJudge,timeout);const value=new Threads(db,model,false,undefined,tools,undefined,undefined,undefined,router);workers.push(value);return value;}
 const chat=service();
 const thread=async()=>{const id=randomUUID();await chat.createThread(id,'Routing fixture');return id;};
 const capture=async(id:string)=>{const run=await db.run.findUniqueOrThrow({where:{id}});return {run,payload:(await db.artifact.findUniqueOrThrow({where:{id:RunState.parse(run.state).request_artifact_id}})).payload};};
 const finish=async(value:Threads,id:string)=>{value.dispatch(id);return until(()=>db.run.findUniqueOrThrow({where:{id}}),run=>!['queued','running'].includes(run.status));};
 const send=async(value:Threads,id:string,text='Format this short list.')=>{const run=await value.submit(id,randomUUID(),text,'normal');const done=await finish(value,run.id);assert.equal(done.status,'completed',JSON.stringify(done.error));return run.id;};
 try{
 await scenarioStep(t,'model-routing-execution',async()=>{
   const id=await thread(),key=randomUUID();routerReply=fast;
   const queued=await chat.submit(id,key,'Format this list: apple, pear.','normal');
   const pending=ModelRoutingRequest.parse((await capture(queued.id)).payload);
   assert.equal(routerCalls,0);assert.equal(wire.length,0);assert.match(pending.attempt.instruction.text,/Prefer the strong model/);
   assert.equal((await chat.submit(id,key,'Format this list: apple, pear.','normal')).id,queued.id);
   {const result=await finish(chat,queued.id);assert.equal(result.status,'completed',JSON.stringify(result.error));}
   const selected=RequestPayload.parse((await capture(queued.id)).payload);assert.equal(selected.model,'gpt-6-luna');assert.equal(selected.routing?.source,'jev');
   assert.equal(wire.at(-1)?.model,'gpt-6-luna');assert.deepEqual(wire.at(-1)?.reasoning,{effort:'low'});assert.equal(wire.at(-1)?.store,false);
   assert.equal(routerCalls,1);assert.equal(reservations,1);
   assert.deepEqual(ModelRoutingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:selected.routing!.attemptId!}})).payload),pending);
   assert.equal((packets[0].questions as {route:{instructions:string}}).route.instructions.includes(pending.attempt.instruction.text),true);
   assert.deepEqual((packets[0].questions as {route:{criteria:unknown}}).route.criteria,pending.attempt.criteria);
   const beforeEdit=await org.readInstruction({scope:'global',key:'model-routing'});
   const next=await chat.submit(id,randomUUID(),'Make the list shorter.','normal');
   await org.saveInstruction({owner:beforeEdit.owner,text:'Prefer strong for everything.',expected:{id:beforeEdit.document!.id,updatedAt:beforeEdit.document!.updatedAt}});
   assert.equal((await finish(chat,next.id)).status,'completed');
   assert.equal(RequestPayload.parse((await capture(next.id)).payload).routing!.instruction.text,pending.attempt.instruction.text);
   routerReply=strong;const upgraded=await send(chat,id,'Compare architecture options.');
   assert.equal(RequestPayload.parse((await capture(upgraded)).payload).routing!.instruction.text,'Prefer strong for everything.');
   assert.equal(ThreadLifecycle.parse((await db.thread.findUniqueOrThrow({where:{id}})).lifecycle).modelRouting!.upgraded,true);
   const count=routerCalls;routerReply=fast;const later=await send(chat,id,'Hi');
   assert.equal(routerCalls,count);assert.equal(RequestPayload.parse((await capture(later)).payload).routing!.source,'sticky');
   assert.equal(wire.at(-1)?.model,'gpt-6.1-sol');
   // Explicit fast pin leaves the automatic upgrade in place; clearing restores sticky strong.
   await chat.changeRouting(id,{expectedVersion:0,override:'fast'});await send(chat,id);assert.equal(wire.at(-1)?.model,'gpt-6-luna');assert.equal(routerCalls,count);
   await chat.changeRouting(id,{expectedVersion:1,override:'auto'});await send(chat,id);assert.equal(wire.at(-1)?.model,'gpt-6.1-sol');
   await assert.rejects(chat.changeRouting(id,{expectedVersion:0,override:'fast'}),/changed/);
   // Failure/retry after a later override preserves the original inference settings and never routes.
   const retryThread=await thread();routerReply=fast;failInference=true;
   const failed=await chat.submit(retryThread,randomUUID(),'Say hello.','normal');assert.equal((await finish(chat,failed.id)).status,'failed');failInference=false;
   const frozen=RequestPayload.parse((await capture(failed.id)).payload),beforeRetry=routerCalls;
   await chat.changeRouting(retryThread,{expectedVersion:0,override:'strong'});
   const retry=await chat.retry(failed.id,randomUUID(),'normal');assert.equal((await finish(chat,retry.id)).status,'completed');
   assert.equal(routerCalls,beforeRetry);assert.equal(wire.at(-1)?.model,frozen.model);
   const rollback=openAIModel({apiKey:'synthetic',model:'gpt-6.1-sol',routingEnabled:false,options:{api:'responses',store:false,maxOutputTokens:1024,timeoutMs:1000,reasoningEffort:'low'},reserve:async()=>60000,info:async()=>({provider:'openai',model:'gpt-6.1-sol'})});
   assert.equal(rollback.configuration('normal',frozen).model,'gpt-6-luna');assert.deepEqual(RequestPayload.parse((await capture(retry.id)).payload),frozen);
   // One routing decision for a multi-round real provider/tool loop.
   const toolsChat=service(judge,1000,runtime),toolsThread=await thread(),beforeTools=routerCalls,beforeWire=wire.length;toolMode=true;routerReply=fast;
   const toolRun=await send(toolsChat,toolsThread,'Look up this evidence.');toolMode=false;
   assert.equal(routerCalls,beforeTools+1);assert.equal(wire.length,beforeWire+2);assert.ok(wire.slice(beforeWire).every(body=>body.model==='gpt-6-luna'));
   assert.equal(RunState.parse((await capture(toolRun)).run.state).tools!.rounds.length,2);
   assert.equal((await chat.inspect(selected.routing!.attemptId!)).artifacts.some(a=>a.payload.type==='model_routing_request'),true);
   await assert.rejects(db.artifact.update({where:{id:selected.routing!.attemptId!},data:{payload:{type:'text_input',text:'Cannot mutate routing'}}}),/immutable/);
 });
 await scenarioStep(t,'model-routing-recovery',async()=>{
   const unknown:RoutingJudge={async assess(){return {choice:'uncertain',probabilities:{fast_sufficient:0.1,strong_preferred:0.1,uncertain:0.8}};}};
   const bad=jevRouter('synthetic',async()=>Response.json({...fast,answers:{route:{...fast.answers.route,probabilities:{fast_sufficient:1,strong_preferred:1,uncertain:1}}}}));
   const low:RoutingJudge={async assess(){return {choice:'fast_sufficient',probabilities:{fast_sufficient:0.89,strong_preferred:0.1,uncertain:0.01}};}};
   for(const routingJudge of [unknown,bad,low,jevRouter(undefined),{assess:()=>new Promise<never>(()=>{})}]){
     const value=service(routingJudge,30),id=await thread();const run=await send(value,id);
     const payload=RequestPayload.parse((await capture(run)).payload);assert.equal(payload.model,'gpt-6.1-sol');
   }
   let calls=0;const blocked:RoutingJudge={async assess(){calls++;throw Error('Must not assess oversized context');}};
   const big=service(blocked),bigThread=await thread();
   const doc=await org.readInstruction({scope:'global',key:'model-routing'});
   await org.saveInstruction({owner:doc.owner,text:'Long routing guidance '.repeat(450),expected:{id:doc.document!.id,updatedAt:doc.document!.updatedAt}});
   const bigRun=await send(big,bigThread);assert.equal(calls,0);assert.equal(RequestPayload.parse((await capture(bigRun)).payload).routing!.error,'context_limit');
   const edited=await org.readInstruction(doc.owner);await org.saveInstruction({owner:edited.owner,text:'Prefer fast for simple work.',expected:{id:edited.document!.id,updatedAt:edited.document!.updatedAt}});
   // Cancellation and override races happen after acceptance, before inference dispatch.
   let entered!:()=>void,release!:()=>void;const gate=new Promise<void>(resolve=>entered=resolve),wait=new Promise<void>(resolve=>release=resolve);
   const delayed:RoutingJudge={async assess(){entered();await wait;return {choice:'fast_sufficient',probabilities:fast.answers.route.probabilities};}};
   const waiting=service(delayed),cancelThread=await thread(),before=wire.length;
   const cancel=await waiting.submit(cancelThread,randomUUID(),'Hello','normal');waiting.dispatch(cancel.id);await gate;await waiting.cancel(cancel.id);release();await sleep(50);
   assert.equal(wire.length,before);assert.equal((await capture(cancel.id)).run.status,'cancelled');
   // Settlement owns Run before its activity trigger needs Thread. Selection must yield, not deadlock.
   const lockThread=await thread(),lockRun=await chat.submit(lockThread,randomUUID(),'Hello','normal');
   await db.run.update({where:{id:lockRun.id},data:{status:'running',startedAt:new Date()}});
   const lockRow=await db.artifact.findUniqueOrThrow({where:{id:lockRun.state.request_artifact_id}});
   let locked!:()=>void,releaseLock!:()=>void;const lockedGate=new Promise<void>(resolve=>locked=resolve),settleGate=new Promise<void>(resolve=>releaseLock=resolve);
   const settlement=db.$transaction(async tx=>{
     await tx.$queryRaw`SELECT id FROM runs WHERE id=${lockRun.id}::uuid FOR UPDATE`;locked();await settleGate;
     await tx.run.update({where:{id:lockRun.id},data:{status:'cancelled',endedAt:new Date()}});
   },{timeout:10000});
   await lockedGate;
   const selection=new ModelRouting(db,model,judge).resolve(lockRun.id,lockRow.id,ModelRoutingRequest.parse(lockRow.payload),new AbortController().signal);
   await sleep(100);releaseLock();
   await settlement;assert.equal(await selection,null);assert.equal((await capture(lockRun.id)).run.status,'cancelled');
   let enterRace!:()=>void,releaseRace!:()=>void;const raceGate=new Promise<void>(resolve=>enterRace=resolve),raceWait=new Promise<void>(resolve=>releaseRace=resolve);
   const racing=service({async assess(){enterRace();await raceWait;return {choice:'fast_sufficient',probabilities:fast.answers.route.probabilities};}});
   const raceThread=await thread(),race=await racing.submit(raceThread,randomUUID(),'Hello','normal');racing.dispatch(race.id);await raceGate;
   await racing.changeRouting(raceThread,{expectedVersion:0,override:'strong'});releaseRace();
   const raceDone=await until(()=>capture(race.id),v=>v.run.status==='completed');assert.equal(RequestPayload.parse(raceDone.payload).model,'gpt-6.1-sol');
   assert.equal(RequestPayload.parse(raceDone.payload).routing!.source,'override');
   // Recover an accepted but undispatched assessment; explicit retry uses frozen strong, no new Jev call.
   const recoveryThread=await thread(),pending=await chat.submit(recoveryThread,randomUUID(),'Hello','normal'),beforeRecover=routerCalls;
   await chat.recover();assert.equal((await capture(pending.id)).run.status,'interrupted');
   const retry=await chat.retry(pending.id,randomUUID(),'normal');assert.equal((await finish(chat,retry.id)).status,'completed');assert.equal(routerCalls,beforeRecover);
   assert.equal(RequestPayload.parse((await capture(retry.id)).payload).routing!.source,'retry');
   // Private selection fails without disclosing to either controlled provider.
   const privateThread=await thread();await assert.rejects(chat.changeRouting(privateThread,{expectedVersion:0,override:'private'}),/Private inference is not configured/);
   const life=ThreadLifecycle.parse((await db.thread.findUniqueOrThrow({where:{id:privateThread}})).lifecycle);life.modelRouting={version:0,upgraded:false,override:'private'};
   await db.thread.update({where:{id:privateThread},data:{lifecycle:life}});
   const counts=[routerCalls,wire.length];await assert.rejects(chat.submit(privateThread,randomUUID(),'Private text','normal'),/Private inference is not configured/);assert.deepEqual([routerCalls,wire.length],counts);
   assert.equal(await db.run.count({where:{threadId:privateThread}}),0);
 });
 }finally{for(const value of workers)await value.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
