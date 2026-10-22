import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ServerConfig,ThreadLifecycle,RunState,RequestPayload} from '../../packages/shared/src/index.ts';
import {Threads} from '../../packages/server/src/modules/threads/service.ts';
import {Decisions} from '../../packages/server/src/modules/decisions/service.ts';
import {decisionRuntime} from '../../packages/server/src/modules/decisions/tools.ts';
import {ThreadVisibility} from '../../packages/server/src/modules/visibility/service.ts';
import {ensureVisibilityInstructions} from '../../packages/server/src/modules/visibility/instructions.ts';
import {deterministicModel} from '../../packages/server/src/platform/models/deterministic.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {disposeInstance} from '../../scripts/dev/lifecycle.ts';
import {checkedCluster,connect} from '../../scripts/dev/database.ts';
import {devRoot,json} from '../../scripts/dev/io.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test('Visibility with waiting Decisions and upgrades',{timeout:120000},async t=>{
 const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty');
 const config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl);
 const admin=connect(await checkedCluster(instance),instance.database),decisions=new Decisions(db);
 const services:Threads[]=[];
 const service=()=>{const threads=new Threads(db,deterministicModel,true,undefined,decisionRuntime(decisions),undefined,decisions);services.push(threads);return threads;};
 let owner=service(),now=new Date(Date.now()+2*86400000),calls=0;
 const visibility=new ThreadVisibility(db,{...deterministicModel,async *stream(request,signal){calls++;yield* deterministicModel.stream(request,signal);}},()=>now);
 await ensureVisibilityInstructions(db);
 const read=async(id:string)=>(await owner.readThread(id)).thread;
 const until=async(id:string,status:string)=>{for(let i=0;i<300;i++){const run=await db.run.findUniqueOrThrow({where:{id}});if(run.status===status)return run;await sleep(10);}throw new Error('Run did not reach '+status);};
 const edit=async(id:string,change:object)=>owner.updateThread(id,{...change,requestId:randomUUID(),expectedVersion:(await read(id)).lifecycle.version});
 const due=async(id:string)=>{const row=await read(id);await db.thread.update({where:{id},data:{lifecycle:{...row.lifecycle,kind:'immediate',deadline:new Date(0).toISOString(),pendingAt:null,seen:row.lifecycle.unread}}});};
 try{
  await scenarioStep(t,'visibility-waiting-decisions',async()=>{
   const id=randomUUID();await owner.createThread(id,'Waiting fixture');
   const started=await owner.submit(id,randomUUID(),'Ask me which target to use?','normal');await until(started.id,'waiting');
   const question=(await decisions.list(id))[0],held=await read(id);
   assert.equal(held.lifecycle.messages,1);assert.equal(held.unread,false);assert.equal(held.activeWork,false);assert.equal(held.waitingWork,true);
   assert.equal((await owner.listThreads()).find(t=>t.id===id)!.waitingWork,true);
   await due(id);await visibility.sweep();assert.equal((await read(id)).isArchived,false);
   await decisions.snooze(question.id,new Date(now.getTime()+86400000).toISOString());await visibility.sweep();assert.equal((await read(id)).isArchived,false);
   // Waiting is not an occupied execution slot, and an unrelated answer does not consume it.
   const other=await owner.submit(id,randomUUID(),'Hello','normal');await until(other.id,'completed');
   assert.equal((await read(id)).lifecycle.messages,3);assert.equal((await db.run.findUniqueOrThrow({where:{id:started.id}})).status,'waiting');
   await due(id);const before=await read(id);await owner.stop();owner=service();await owner.recover();await visibility.recover();
   assert.equal(calls,0);assert.equal((await read(id)).lifecycle.messages,3);assert.equal((await read(id)).lifecycle.unread,before.lifecycle.unread);assert.equal((await read(id)).isArchived,false);
   await edit(id,{isArchived:true});await owner.resumeWaiting();assert.equal((await read(id)).isArchived,true,'Progress cannot reverse manual Archive');
   // Save an answer with the scheduler offline, then recover through the existing owner.
   await owner.stop();decisions.onChanged=()=>{};await decisions.answer(question.id,{submissionId:randomUUID(),value:'Garden'});
   assert.equal((await read(id)).isArchived,true);assert.equal((await read(id)).waitingWork,true);
   owner=service();await owner.recover();await until(started.id,'completed');await visibility.recover();
   const finished=await read(id);assert.equal(finished.lifecycle.messages,4);assert.equal(finished.waitingWork,false);assert.equal(finished.isArchived,false);assert.equal(finished.unread,true);assert.equal(calls,0);
   const activity=finished.lifecycle.activity;await owner.recover();await visibility.recover();assert.equal((await read(id)).lifecycle.activity,activity);assert.equal((await read(id)).lifecycle.messages,4);
   await due(id);await visibility.sweep();assert.equal((await read(id)).isArchived,true);
   // A Thread-linked Decision holds visibility even without a dependent Run.
   const standalone=randomUUID();await owner.createThread(standalone,'Question fixture');
   const pending=await decisions.create({id:randomUUID(),threadId:standalone,request:{kind:'question',form:'text',question:'Choose a date',reason:'Needed for planning',options:[]}});
   await due(standalone);await visibility.sweep();assert.equal((await read(standalone)).isArchived,false);
   await decisions.snooze(pending.id,new Date(now.getTime()+86400000).toISOString());await visibility.sweep();assert.equal((await read(standalone)).waitingWork,true);
   await decisions.cancel(pending.id);await visibility.sweep();assert.equal((await read(standalone)).isArchived,true);
   // A scheduler holding the Thread must skip a Run being settled, not deadlock with its activity hook.
   const cancelled=randomUUID();await owner.createThread(cancelled,'Cancellation fixture');
   const run=await owner.submit(cancelled,randomUUID(),'Ask me which date?','normal');await until(run.id,'waiting');
   let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),hold=new Promise<void>(r=>release=r);
   const locking=admin.begin(async tx=>{await tx.unsafe("SELECT id FROM runs WHERE id=$1::uuid FOR UPDATE",[run.id]);locked();await hold;});await ready;
   try{await Promise.race([owner.resumeWaiting(),sleep(1500).then(()=>{throw new Error('Scheduler waited on a locked Run');})]);}finally{release();await locking;}
   await owner.cancel(run.id);assert.equal((await read(cancelled)).waitingWork,false);assert.equal((await read(cancelled)).lifecycle.messages,1);
   await due(cancelled);await visibility.sweep();assert.equal((await read(cancelled)).isArchived,true);
   // A partially emitted Surface belongs to one settlement, even across multiple waits.
   const counted=randomUUID();await owner.createThread(counted,'Count fixture');
   const paused=new Threads(db,deterministicModel,false),queued=await paused.submit(counted,randomUUID(),'Partial response fixture','normal');
   const state=RunState.parse((await db.run.findUniqueOrThrow({where:{id:queued.id}})).state);
   await db.run.update({where:{id:queued.id},data:{status:'running',startedAt:new Date()}});
   await db.artifact.create({data:{id:randomUUID(),threadId:counted,runId:queued.id,sourceId:state.request_artifact_id,layer:'surface',actor:'ash',payload:{type:'message',speaker:'ash',initial_thread_id:counted,content:[{type:'text',text:'Partial'}]},createdAt:new Date(),updatedAt:new Date()}});
   const initial=await read(counted);
   for(const status of ['waiting','queued','running','waiting'])await db.run.update({where:{id:queued.id},data:{status}});
   assert.equal((await read(counted)).lifecycle.messages,initial.lifecycle.messages);assert.equal((await read(counted)).lifecycle.unread,initial.lifecycle.unread);
   await paused.cancel(queued.id);assert.equal((await read(counted)).lifecycle.messages,2);assert.equal((await read(counted)).unread,true);
   await paused.cancel(queued.id);assert.equal((await read(counted)).lifecycle.messages,2);
  });
  await scenarioStep(t,'visibility-combined-upgrades',async()=>{
   const root='packages/server/prisma/migrations',all=(await readdir(root)).filter(n=>/^\d/.test(n)).sort();
   const permission='202610140001_permissions_decisions',followup='202610210004_waiting_visibility';
   for(const direction of ['master','visibility'])await admin.begin(async tx=>{
    const schema='upgrade_'+direction;await tx.unsafe('CREATE SCHEMA '+schema);await tx.unsafe('SET LOCAL search_path='+schema);
    const apply=async(name:string)=>tx.unsafe((await readFile(join(root,name,'migration.sql'),'utf8')).replace(/^BEGIN;\n/,'').replace(/COMMIT;\s*$/,''));
    const initial=all.filter(n=>n!==followup&&(direction==='master'?!n.includes('thread_visibility')&&!n.includes('thread_events')&&!n.includes('application_history'):n!==permission));
    for(const name of initial)await apply(name);
    const id=randomUUID(),input=randomUUID(),run=randomUUID(),capture=randomUUID(),surface=randomUUID();
    await tx.unsafe("INSERT INTO threads(id,title,is_pinned,is_archived,created_at,updated_at) VALUES($1,'Preserved manual title',true,true,now(),now())",[id]);
    await tx.unsafe("INSERT INTO artifacts(id,thread_id,layer,actor,payload,created_at,updated_at) VALUES($1,$2,'input','user','{\"type\":\"text_input\",\"text\":\"Saved question\"}',now(),now())",[input,id]);
    await tx.unsafe("INSERT INTO runs(id,thread_id,input_artifact_id,status,state,request_key,request_hash,started_at,created_at) VALUES($1,$2,$3,$4,'{}',$5,'fixture',now(),now())",[run,id,input,direction==='master'?'waiting':'running',randomUUID()]);
    await tx.unsafe("INSERT INTO artifacts(id,thread_id,run_id,source_id,layer,actor,payload,created_at,updated_at) VALUES($1,$2,$3,$4,'act','ash','{\"type\":\"model_request\",\"messages\":[]}',now(),now())",[capture,id,run,input]);
    await tx.unsafe("INSERT INTO artifacts(id,thread_id,run_id,source_id,layer,actor,payload,created_at,updated_at) VALUES($1,$2,$3,$4,'surface','ash','{\"type\":\"message\",\"speaker\":\"ash\",\"content\":[]}',now(),now())",[surface,id,run,capture]);
    let savedLifecycle:unknown;
    if(direction==='visibility'){
     await tx.unsafe("UPDATE runs SET status='completed',ended_at=now() WHERE id=$1",[run]);
     await tx.unsafe("UPDATE threads SET is_archived=true,lifecycle=lifecycle||'{\"titleMode\":\"manual\",\"kind\":\"indefinite\",\"deadline\":null,\"pendingAt\":null}'::jsonb WHERE id=$1",[id]);
     const [before]=await tx.unsafe("SELECT lifecycle FROM threads WHERE id=$1",[id]);savedLifecycle=before.lifecycle;
     const request=RequestPayload.parse({type:'model_request',purpose:'thread_visibility',...deterministicModel.configuration('normal'),messages:[],selection:{instructions:[],artifacts:[],omitted:[]}});
     await tx.unsafe("INSERT INTO thread_assessments(id,thread_id,kind,status,capture,request,result,created_at,finished_at) VALUES($1,$2,'visibility','failed','{}',$3,'{\"kind\":\"visibility\",\"status\":\"failed\"}',now(),now())",[randomUUID(),id,JSON.stringify(request)]);
    }
    const decision=randomUUID();
    if(direction==='master')await tx.unsafe("INSERT INTO decisions(id,thread_id,request,created_at,updated_at) VALUES($1,$2,'{\"question\":\"Saved immutable request\"}',now(),now())",[decision,id]);
    for(const name of all.filter(n=>!initial.includes(n)))await apply(name);
    const [row]=await tx.unsafe("SELECT * FROM threads WHERE id=$1",[id]);assert.equal(row.title,'Preserved manual title');assert.equal(row.is_archived,true);assert.equal(row.is_pinned,true);
    assert.equal(ThreadLifecycle.parse(row.lifecycle).messages,direction==='master'?0:1);assert.equal(ThreadLifecycle.parse(row.lifecycle).titleMode,'manual');
    if(direction==='visibility')assert.deepEqual(row.lifecycle,savedLifecycle);
    else assert.equal((await tx.unsafe("SELECT status FROM decisions WHERE id=$1",[decision]))[0].status,'pending');
    await assert.rejects(tx.savepoint(sp=>sp.unsafe("UPDATE artifacts SET payload='{}' WHERE id=$1",[capture])),/immutable/);
    if(direction==='visibility')await assert.rejects(tx.savepoint(sp=>sp.unsafe("UPDATE thread_assessments SET request='{}' WHERE thread_id=$1",[id])),/immutable/);
    else await assert.rejects(tx.savepoint(sp=>sp.unsafe("UPDATE decisions SET request='{}' WHERE id=$1",[decision])),/immutable/);
    await tx.unsafe('DROP SCHEMA '+schema+' CASCADE');
   });
   assert.equal(calls,0,'Migrations and recovery never dispatch visibility inference');
  });
 }finally{await visibility.stop();for(const owner of services)await owner.stop();await admin.end();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
