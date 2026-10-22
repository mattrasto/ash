import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureCluster,connect } from '../../scripts/dev/database.ts';
import { join } from 'node:path';
import { ServerConfig,ThreadLifecycle,RequestPayload,type RequestPayload as Request } from '../../packages/shared/src/index.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { Incoming } from '../../packages/server/src/modules/artifacts/service.ts';
import { ensureEngineInstructions } from '../../packages/server/src/modules/artifacts/instructions.ts';
import { ThreadVisibility } from '../../packages/server/src/modules/visibility/service.ts';
import { ensureVisibilityInstructions } from '../../packages/server/src/modules/visibility/instructions.ts';
import { Organization } from '../../packages/server/src/modules/organization/service.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import type { ModelAdapter } from '../../packages/server/src/platform/models/adapter.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { workspace,createInstance } from '../../scripts/dev/workspace.ts';
import { disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { devRoot,json } from '../../scripts/dev/io.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n));
test('Thread visibility and naming persistence boundaries',{timeout:180000},async t=>{
 const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty'),cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl);
 await ensureEngineInstructions(db);await ensureVisibilityInstructions(db);
 let now=new Date(),choice:unknown={kind:'immediate',reason:'Synthetic completed matter.'},hold:Promise<void>|null=null,holdKind='thread_visibility',responseFirst:Promise<void>|null=null,responseSecond:Promise<void>|null=null;
 const calls:Request[]=[];
 let migratedLifecycle:ThreadLifecycle;
 const model:ModelAdapter={...deterministicModel,async *stream(request,signal){
  if(request.purpose?.startsWith('thread_')){calls.push(request);if(request.purpose===holdKind&&hold)await hold;yield JSON.stringify(request.purpose==='thread_visibility'?choice:{title:'Recognizable automatic name',reason:'Synthetic name.'});return;}
  if(request.purpose?.startsWith('engine_')){yield* deterministicModel.stream(request,signal);return;}
  yield 'A settled synthetic response.';if(responseFirst)await responseFirst;yield ' More progress.';if(responseSecond)await responseSecond;
 }};
 const threads=new Threads(db,model,true),intake=new Incoming(db,threads,model,false),visibility=new ThreadVisibility(db,model,()=>now);
 const read=async(id:string)=>(await threads.readThread(id)).thread;
 const edit=async(id:string,change:object)=>threads.updateThread(id,{...change,requestId:randomUUID(),expectedVersion:(await read(id)).lifecycle.version});
 const create=async(title='Synthetic matter')=>{const id=randomUUID();await threads.createThread(id,title);return id;};
 const receive=async(id:string,text='Useful synthetic update')=>{const value={id:randomUUID(),targetThreadId:id,text,source:{name:'synthetic',eventId:randomUUID(),label:'Synthetic inbox'}};const r=await intake.receive(value);intake.dispatch(r.id);await intake.idle();return value;};
 const send=async(id:string)=>{const r=await threads.submit(id,randomUUID(),'A meaningful synthetic message','normal');for(let i=0;i<200;i++){if(!['queued','running'].includes((await db.run.findUniqueOrThrow({where:{id:r.id}})).status))return r;await sleep(10);}throw new Error('Response did not settle');};
 const assess=async()=>{now=new Date(Math.max(Date.now()+11000,now.getTime()+61000));for(let n=0;n<10;n++){const before=calls.length;await visibility.pump();await visibility.idle();if(calls.length===before)break;}};
 try{
  await scenarioStep(t,'visibility-migration',async()=>{
   const admin=connect(await ensureCluster(ws.devRoot,ws.checkout),instance.database);
   try{await admin.begin(async tx=>{
    await tx.unsafe('CREATE SCHEMA visibility_upgrade');await tx.unsafe('SET LOCAL search_path=visibility_upgrade,public');
    for(const table of ['threads','artifacts','runs','instructions'])await tx.unsafe(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    await tx.unsafe('ALTER TABLE threads DROP COLUMN lifecycle,DROP COLUMN initial_title');
    await tx.unsafe('ALTER TABLE artifacts DROP CONSTRAINT artifacts_exclude_thread_management');
    const thread=randomUUID(),input=randomUUID(),surface=randomUUID();
    await tx.unsafe("INSERT INTO threads(id,title,created_at,updated_at,is_archived,is_pinned) VALUES($1,'Legacy manual title',now(),now(),true,true)",[thread]);
    await tx.unsafe(`INSERT INTO artifacts(id,thread_id,layer,actor,payload,created_at,updated_at) VALUES($1,$2,'input','user','{"type":"text_input","text":"Historical message"}',now(),now())`,[input,thread]);
    await tx.unsafe(`INSERT INTO artifacts(id,thread_id,source_id,layer,actor,payload,created_at,updated_at) VALUES($1,$2,$3,'surface','user','{"type":"message","speaker":"user","content":[]}',now(),now())`,[surface,thread,input]);
    await tx.unsafe(await readFile('packages/server/prisma/migrations/202610210001_thread_visibility/migration.sql','utf8'));
    const [row]=await tx.unsafe('SELECT * FROM threads WHERE id=$1',[thread]);const state=ThreadLifecycle.parse(row.lifecycle);
    migratedLifecycle=state;
    assert.equal(row.title,'Legacy manual title');assert.equal(row.is_archived,true);assert.equal(row.is_pinned,true);assert.equal(state.messages,1);assert.equal(state.titleMode,'manual');assert.equal(state.kind,'indefinite');assert.equal(state.pendingAt,null);
    const [attempts]=await tx.unsafe('SELECT count(*)::int AS count FROM thread_assessments');assert.equal(attempts.count,0);assert.equal(calls.length,0);
    await tx.unsafe(`UPDATE threads SET lifecycle=lifecycle||'{"visibleUntil":"2035-01-01T00:00:00Z"}'::jsonb`);
    const protectedThread=randomUUID();await tx.unsafe(`INSERT INTO threads(id,title,created_at,updated_at,is_archived,is_pinned,lifecycle) VALUES($1,'Previously unarchived',now(),now(),false,false,'{"kind":"immediate","deadline":"2020-01-01T00:00:00Z","visibleUntil":"2035-01-01T00:00:00Z"}')`,[protectedThread]);
    await tx.unsafe("INSERT INTO instructions(id,key,name,text,created_at,updated_at) VALUES($1,'thread-visibility','Visibility','My customized visibility guidance',now(),now())",[randomUUID()]);
    await tx.unsafe(await readFile('packages/server/prisma/migrations/202610210002_thread_events/migration.sql','utf8'));
    const [upgraded]=await tx.unsafe('SELECT lifecycle,is_archived FROM threads WHERE id=$1',[thread]);assert.equal(upgraded.lifecycle.visibleUntil,undefined);assert.equal(upgraded.is_archived,true);
    const [events]=await tx.unsafe("SELECT count(*)::int AS count FROM artifacts WHERE payload->>'type'='thread_event'");assert.equal(events.count,0,'Migration does not invent historical transitions');assert.equal(calls.length,0);
    const [protectedRow]=await tx.unsafe('SELECT lifecycle,is_archived FROM threads WHERE id=$1',[protectedThread]);assert.equal(protectedRow.lifecycle.kind,'indefinite');assert.equal(protectedRow.lifecycle.deadline,null);assert.equal(protectedRow.is_archived,false);
    const [guidance]=await tx.unsafe("SELECT text FROM instructions WHERE key='thread-visibility'");assert.equal(guidance.text,'My customized visibility guidance');
    const commandId=randomUUID(),eventId=randomUUID(),assessmentId=randomUUID(),resultId=randomUUID(),autoEventId=randomUUID();
    const legacyRequest={type:'model_request',purpose:'thread_visibility',...deterministicModel.configuration('normal'),messages:[{role:'user',content:'Historical captured evidence'}],selection:{instructions:[],artifacts:[{id:commandId,messageIndex:0}],omitted:[]}};
    const legacyResult={type:'thread_assessment_result',kind:'visibility',status:'applied',output:JSON.stringify({kind:'immediate',reason:'Completed'}),reason:'Completed'};
    for(const [id,source,layer,payload] of [
     [commandId,null,'input',{type:'thread_control',command:{requestId:commandId,expectedVersion:0,isArchived:false}}],
     [eventId,commandId,'surface',{type:'thread_event',event:'unarchived',origin:'manual'}],
     [assessmentId,commandId,'act',legacyRequest],
     [resultId,assessmentId,'act',legacyResult],
     [autoEventId,resultId,'surface',{type:'thread_event',event:'archived',origin:'automatic'}],
    ] as const)await tx.unsafe("INSERT INTO artifacts(id,thread_id,source_id,layer,actor,payload,created_at,updated_at) VALUES($1,$2,$3,$4,'system',$5::text::jsonb,now(),now())",[id,thread,source,layer,JSON.stringify(payload)]);
    await tx.unsafe("INSERT INTO thread_assessments(id,thread_id,kind,status,capture,created_at,finished_at) VALUES($1,$2,'visibility','applied',$3::text::jsonb,now(),now())",[assessmentId,thread,JSON.stringify({sourceId:commandId,activity:1})]);
    await tx.unsafe("UPDATE threads SET lifecycle=lifecycle||jsonb_build_object('sourceId',$1::text) WHERE id=$2",[commandId,thread]);
    await tx.unsafe('CREATE TRIGGER captured_artifacts_immutable BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION public.protect_captured_artifact()');
    await tx.unsafe((await readFile('packages/server/prisma/migrations/202610210003_application_history/migration.sql','utf8')).replace(/^BEGIN;\n/,'').replace(/COMMIT;\s*$/,''));
    const [migrated]=await tx.unsafe('SELECT * FROM thread_assessments WHERE id=$1',[assessmentId]);assert.deepEqual(migrated.request,legacyRequest);assert.deepEqual(migrated.result,legacyResult);assert.equal(migrated.capture.changeId,commandId);assert.equal(migrated.capture.sourceId,null);
    const changes=await tx.unsafe('SELECT * FROM application_changes ORDER BY id');assert.equal(changes.length,3);assert.equal(changes.find(c=>c.id===autoEventId)!.assessment_id,assessmentId);assert.equal(changes.find(c=>c.id===eventId)!.events[0].event,'unarchived');
    const [migratedState]=await tx.unsafe('SELECT lifecycle FROM threads WHERE id=$1',[thread]);assert.equal(migratedState.lifecycle.changeId,commandId);assert.equal(migratedState.lifecycle.sourceId,null);
    const [remaining]=await tx.unsafe('SELECT count(*)::int AS count FROM artifacts');assert.equal(remaining.count,2,'Only original conversation Artifacts remain');assert.equal(calls.length,0);
    await tx.unsafe('DROP SCHEMA visibility_upgrade CASCADE');
   });}finally{await admin.end();}
  });
  await scenarioStep(t,'visibility-lifecycle' ,async()=>{
   const id=await create();await edit(id,{recalculate:true});await edit(id,{automaticName:true});await visibility.pump();assert.equal(calls.length,0,'Empty composer does not assess');await edit(id,{title:'Synthetic matter'});
   const delivered=await receive(id);now=new Date(Date.parse((await read(id)).lifecycle.changedAt!)+9000);await visibility.pump();assert.equal(calls.length,0,'Trailing debounce');
   await assess();assert.equal((await read(id)).lifecycle.kind,'immediate');await visibility.sweep();assert.equal((await read(id)).isArchived,false,'Unread grace');
   const first=(await read(id)).lifecycle.unread;await threads.markSeen(id,first);await visibility.sweep();assert.equal((await read(id)).isArchived,true);
   const count=calls.length;await visibility.pump();await visibility.idle();assert.equal(calls.length,count,'Expiry and polling never infer');
   await intake.receive(delivered);assert.equal((await read(id)).isArchived,true,'Duplicate does not revive');
   await receive(id);assert.equal((await read(id)).isArchived,false);assert.equal((await read(id)).lifecycle.deadline,null);
   await threads.markSeen(id,first);assert.equal((await read(id)).unread,true,'Old acknowledgment cannot clear new activity');
   await edit(id,{isArchived:true});assert.equal((await read(id)).isArchived,true);await receive(id);assert.equal((await read(id)).isArchived,false,'Manual archives revive too');
   await assess();await edit(id,{isPinned:true});now=new Date(now.getTime()+25*3600000);await visibility.sweep();assert.equal((await read(id)).isArchived,false);
   await edit(id,{isArchived:true});assert.equal((await read(id)).isArchived,true,'Pin does not block explicit archive');await edit(id,{isPinned:false});assert.equal((await read(id)).isArchived,true,'Unpin does not revive');
   const unarchived=await edit(id,{isArchived:false});assert.equal(unarchived.lifecycle.deadline,null);assert.equal(unarchived.lifecycle.kind,'pending');await threads.markSeen(id,(await read(id)).lifecycle.unread);await visibility.sweep();assert.equal((await read(id)).isArchived,false,'Old deadline cannot undo Unarchive');
   await assess();await visibility.sweep();assert.equal((await read(id)).isArchived,true,'Current immediate assessment has no fixed manual grace');
   assert.ok((await threads.readThread(id)).artifacts.length>0);assert.ok((await threads.listThreads()).some(t=>t.id===id));
   const internal=await create();await receive(internal,'Perform internal work on this useful matter');for(let i=0;i<100&&(await read(internal)).activeWork;i++)await sleep(10);
   assert.equal((await read(internal)).unread,false);await assess();await visibility.sweep();assert.equal((await read(internal)).isArchived,true,'Internal-only immediate assessment archives without unread hold');
   await send(internal);assert.equal((await read(internal)).isArchived,false);
   const running=await create();let releaseFirst!:()=>void,second!:()=>void;responseFirst=new Promise<void>(r=>releaseFirst=r);responseSecond=new Promise<void>(r=>second=r);
   const work=await threads.submit(running,randomUUID(),'Active work','normal');for(let n=0;n<100&&await db.artifact.count({where:{runId:work.id,layer:'surface'}})===0;n++)await sleep(10);
   await edit(running,{isArchived:true});releaseFirst();responseFirst=null;await sleep(30);assert.equal((await read(running)).isArchived,true,'Streaming does not undo manual archive');assert.equal((await read(running)).activeWork,true);
   second();responseSecond=null;for(let n=0;n<100&&(await read(running)).activeWork;n++)await sleep(10);assert.equal((await read(running)).isArchived,false,'New terminal work revives');
   const drafted=await create(),a=randomUUID(),b=randomUUID();await send(drafted);await threads.saveDraftPresence(drafted,{clientId:a,revision:2,present:true});await assess();await threads.markSeen(drafted,(await read(drafted)).lifecycle.unread);
   const beforeDraft=await read(drafted),artifactCount=await db.artifact.count(),assessmentCount=calls.length;
   await threads.saveDraftPresence(drafted,{clientId:b,revision:1,present:true});
   await threads.saveDraftPresence(drafted,{clientId:a,revision:1,present:false});
   assert.equal((await read(drafted)).lifecycle.drafts[a].present,true,'Late clear cannot remove a newer draft');
   const restarted=new ThreadVisibility(db,model,()=>now);await restarted.recover();await restarted.sweep();assert.equal((await read(drafted)).isArchived,false,'Draft survives scheduler restart and holds a due deadline');
   await threads.saveDraftPresence(drafted,{clientId:a,revision:3,present:false});await restarted.sweep();assert.equal((await read(drafted)).isArchived,false,'Another client still has a draft');
   const afterDraft=await read(drafted);assert.equal(afterDraft.lifecycle.activity,beforeDraft.lifecycle.activity);assert.equal(afterDraft.lifecycle.version,beforeDraft.lifecycle.version);assert.equal(afterDraft.updatedAt.getTime(),beforeDraft.updatedAt.getTime());assert.equal(await db.artifact.count(),artifactCount);assert.equal(calls.length,assessmentCount);
   await threads.saveDraftPresence(drafted,{clientId:b,revision:2,present:false});await restarted.sweep();assert.equal((await read(drafted)).isArchived,true,'Clearing all drafts releases the existing deadline without inference');
   await threads.saveDraftPresence(drafted,{clientId:a,revision:4,present:true});assert.equal((await read(drafted)).isArchived,true,'Typing alone does not revive an archived Thread');
   await edit(drafted,{isArchived:false});await assess();await restarted.sweep();assert.equal((await read(drafted)).isArchived,false);await edit(drafted,{isArchived:true});assert.equal((await read(drafted)).isArchived,true,'Manual Archive works with a draft');await restarted.stop();
  });
  await scenarioStep(t,'visibility-naming-conflicts',async()=>{
   await assess();const id=await create('New Thread');const counts:number[]=[];
   for(let n=0;n<7;n++){await send(id);await assess();const rows=await db.threadAssessment.findMany({where:{threadId:id,kind:'naming',status:'applied'},orderBy:{createdAt:'asc'}});counts.splice(0,counts.length,...rows.map(a=>(a.capture as {messages:number}).messages));}
   assert.deepEqual(counts,[2,4,6,8,14]);assert.equal((await read(id)).title,'Recognizable automatic name');
   await threads.createThread(id,'New Thread'); // Creation transport retry survives automatic naming.
   const racingName=await create('New Thread');await receive(racingName);let releaseName!:()=>void;holdKind='thread_naming';hold=new Promise<void>(r=>releaseName=r);await visibility.pump();
   await edit(racingName,{title:'My deliberate name'});releaseName();hold=null;holdKind='thread_visibility';await visibility.idle();assert.equal((await read(racingName)).title,'My deliberate name');assert.equal((await db.threadAssessment.findFirstOrThrow({where:{threadId:racingName,kind:'naming'}})).status,'discarded');
   await edit(id,{title:'My explicit title'});await send(id);await assess();assert.equal((await read(id)).title,'My explicit title');
   await edit(id,{automaticName:true});await visibility.pump();await visibility.idle();assert.equal((await read(id)).title,'Recognizable automatic name');
   const command={isPinned:true,requestId:randomUUID(),expectedVersion:(await read(id)).lifecycle.version};const namedBeforePin=(await read(id)).lifecycle.namedCount;const pinned=await threads.updateThread(id,command);await threads.updateThread(id,command);
   await threads.updateThread(id,{undo:true,requestId:randomUUID(),expectedVersion:pinned.lifecycle.version});assert.equal((await read(id)).isPinned,false);assert.equal((await read(id)).lifecycle.namedCount,namedBeforePin,'Undo pin does not request naming');
   await assert.rejects(threads.updateThread(id,command),/changed/);
   const delayed=await create();await receive(delayed);let release!:()=>void;hold=new Promise<void>(r=>release=r);await visibility.pump(); // may be inside debounce
   now=new Date(now.getTime()+61000);await visibility.pump();
   const running=await db.threadAssessment.findFirstOrThrow({where:{threadId:delayed,status:'running'}});
   await edit(delayed,{isArchived:true});release();hold=null;await visibility.idle();assert.equal((await db.threadAssessment.findUniqueOrThrow({where:{id:running.id}})).status,'discarded');assert.equal((await read(delayed)).isArchived,true);
   await receive(delayed);await assess();const instruction=await new Organization(db).readInstruction({scope:'global',key:'thread-visibility'});
   await edit(delayed,{recalculate:true});hold=new Promise<void>(r=>release=r);now=new Date(now.getTime()+61000);await visibility.pump();
   await new Organization(db).saveInstruction({owner:instruction.owner,expected:{id:instruction.document!.id,updatedAt:instruction.document!.updatedAt},text:instruction.document!.text+' Keep ongoing projects visible.'});release();hold=null;await visibility.idle();
   const latest=await db.threadAssessment.findFirstOrThrow({where:{threadId:delayed},orderBy:{createdAt:'desc'}});assert.equal(latest.status,'discarded');
   const inspected=await threads.inspectAssessment(latest.id);assert.equal(inspected.result?.status,'discarded');
   await assert.rejects(db.threadAssessment.update({where:{id:latest.id},data:{result:{}}}),/immutable/);
  });
  await scenarioStep(t,'visibility-history',async()=>{
   now=new Date();choice={kind:'indefinite',reason:'Synthetic ongoing matter'};
   const id=await create('New Thread');await send(id);await assess();
   const events=async()=>(await threads.readThread(id)).changes.flatMap(change=>change.events.filter(event=>['archived','unarchived','renamed'].includes(event.event)).map(payload=>({id:change.id,payload})));
   const artifactsBefore=await db.artifact.count();
   await assert.rejects(db.artifact.create({data:{id:randomUUID(),threadId:id,layer:'input',actor:'user',payload:{type:'thread_control'},createdAt:new Date(),updatedAt:new Date()}}),/artifacts_exclude_thread_management|constraint/);
   await assert.rejects(threads.inspect((await threads.assessments(id))[0].id),/Artifact not found/);
   assert.equal((await events()).filter(a=>a.payload.type==='thread_event'&&a.payload.event==='renamed').length,1,'Automatic rename is recorded');
   const before=await read(id),command={isArchived:true,requestId:randomUUID(),expectedVersion:before.lifecycle.version};
   await threads.updateThread(id,command);await threads.updateThread(id,command);
   const archived=(await events()).filter(a=>a.payload.type==='thread_event'&&a.payload.event==='archived');assert.equal(archived.length,1,'Transport retry does not duplicate events');
   const inspection=await threads.inspectChange(archived[0].id);assert.equal(inspection.command?.isArchived,true);
   await assert.rejects(db.applicationChange.update({where:{id:archived[0].id},data:{events:[]}}),/immutable|permission denied/);
   await assert.rejects(db.applicationChange.delete({where:{id:command.requestId}}),/immutable|permission denied/);
   const unarchived=await edit(id,{isArchived:false});assert.equal(unarchived.lifecycle.deadline,null);assert.equal(unarchived.lifecycle.messages,before.lifecycle.messages);assert.equal(unarchived.lifecycle.unread,before.lifecycle.unread);assert.equal(unarchived.updatedAt.getTime(),before.updatedAt.getTime());
   choice={kind:'until',deadline:new Date(now.getTime()+15*60000).toISOString(),reason:'Recent manual unarchive merits another look soon.'};await assess();
   const assessment=await db.threadAssessment.findFirstOrThrow({where:{threadId:id,kind:'visibility'},orderBy:{createdAt:'desc'}});
   const packet=JSON.parse(String(RequestPayload.parse(assessment.request).messages.at(-1)!.content));
   assert.ok(packet.items.some((a:any)=>a.kind==='change'&&a.payload.command?.isArchived===false),'Manual action reaches model evidence');
   await edit(id,{title:'Deliberate name'});await edit(id,{undo:true});assert.equal((await events()).filter(a=>a.payload.type==='thread_event'&&a.payload.origin==='undo').length,1);
   const messageCount=(await read(id)).lifecycle.messages,eventCount=(await events()).length;
   await edit(id,{title:(await read(id)).title});assert.equal((await events()).length,eventCount,'Same title creates no transition');assert.equal((await read(id)).lifecycle.messages,messageCount);
   assert.equal(await db.artifact.count(),artifactsBefore,'Controls, assessments and notices create zero Artifacts');
   assert.ok((await threads.readThread(id)).changes.some(c=>c.events.some(e=>e.event==='name_mode')));
   await edit(id,{isPinned:true});await edit(id,{isPinned:false});assert.ok((await threads.readThread(id)).changes.some(c=>c.events.some(e=>e.event==='pinned')));
   const run=await send(id),request=await db.artifact.findFirstOrThrow({where:{runId:run.id,payload:{path:['type'],equals:'model_request'}}});
   const eventIds=new Set((await events()).map(a=>a.id)),context=RequestPayload.parse(request.payload);assert.ok(context.selection.artifacts.every(a=>!eventIds.has(a.id)),'System history is not conversational input');
   const reopened=new Threads(db,model,false);assert.equal((await reopened.readThread(id)).changes.flatMap(c=>c.events.filter(e=>['archived','unarchived','renamed'].includes(e.event))).length,eventCount);
  });
  await scenarioStep(t,'visibility-recovery-context',async()=>{
   const id=await create();for(let n=0;n<24;n++)await receive(id,'Useful event update '+n);
   choice={kind:'until',deadline:'2035-01-01T10:00:00-08:00',reason:'Synthetic future event.'};await assess();const row=await db.threadAssessment.findFirstOrThrow({where:{threadId:id},orderBy:{createdAt:'desc'}}),request=RequestPayload.parse(row.request);
   assert.equal(request.selection.itemWindow,20);assert.ok(request.selection.omittedItems!>0);assert.equal(request.selection.maxCharacters,undefined);assert.ok(request.messages.every(m=>typeof m.content==='string'));
   assert.equal((await read(id)).lifecycle.deadline,'2035-01-01T18:00:00.000Z');
   await edit(id,{recalculate:true});choice={kind:'until',deadline:'tomorrow',reason:'Malformed'};await assess();assert.equal((await read(id)).lifecycle.kind,'failed');assert.equal((await read(id)).lifecycle.deadline,null);
   const used=calls.length;await assess();assert.equal(calls.length,used,'Failure is not retried automatically');
   choice={kind:'until',deadline:'0000-01-01T00:00:00Z',reason:'Invalid calendar year'};await edit(id,{recalculate:true});await assess();assert.equal((await read(id)).lifecycle.kind,'failed');await visibility.sweep();
   choice={kind:'indefinite',reason:'Ongoing matter'};await receive(id);await assess();assert.equal((await read(id)).lifecycle.kind,'indefinite');
   let release!:()=>void;await edit(id,{recalculate:true});hold=new Promise<void>(r=>release=r);now=new Date(now.getTime()+61000);await visibility.pump();
   const pending=await db.threadAssessment.findFirstOrThrow({where:{threadId:id,status:'running'}});const restarted=new ThreadVisibility(db,model,()=>now);await restarted.recover();const before=calls.length;release();hold=null;await visibility.idle();await restarted.pump();await restarted.idle();assert.equal(calls.length,before);assert.equal((await db.threadAssessment.findUniqueOrThrow({where:{id:pending.id}})).status,'interrupted');await restarted.stop();
   const state=ThreadLifecycle.parse((await db.thread.findUniqueOrThrow({where:{id}})).lifecycle);assert.equal(state.kind,'failed');
   const expired=await create();await receive(expired);choice={kind:'until',deadline:'2035-01-01T00:00:00Z',reason:'Synthetic event ended'};await assess();const count=calls.length;now=new Date('2036-01-01T00:00:00Z');const expiryRestart=new ThreadVisibility(db,model,()=>now);await expiryRestart.recover();assert.equal((await read(expired)).isArchived,true);assert.equal(calls.length,count,'Restart enforces saved deadlines without inference');await expiryRestart.stop();
  });
  await scenarioStep(t,'visibility-migrated-controls',async()=>{
   choice={kind:'indefinite',reason:'Historical ongoing matter'};
   for(const visible of [true,false])for(const first of ['visibility','naming']){
    const id=await create('Legacy title'),input=randomUUID(),stamp=new Date();
    await db.artifact.create({data:{id:input,threadId:id,layer:'input',actor:'user',payload:{type:'text_input',text:'Historical ongoing matter'},createdAt:stamp,updatedAt:stamp}});
    if(visible)await db.artifact.create({data:{id:randomUUID(),threadId:id,sourceId:input,layer:'surface',actor:'user',payload:{type:'message',initial_thread_id:id,speaker:'user',content:[{type:'text',text:'Historical ongoing matter'}]},createdAt:stamp,updatedAt:stamp}});
    else await db.artifact.create({data:{id:randomUUID(),threadId:id,sourceId:input,layer:'route',actor:'system',payload:{type:'route_result',threadId:id,explicit:true,choice:{destination:'existing',threadId:id,title:'Legacy title',reason:'Explicit destination',assumption:'',ambiguous:false}},createdAt:stamp,updatedAt:stamp}});
    // Restore the checkpoint produced by the real migration above; no post-upgrade activity yet.
    await db.thread.update({where:{id},data:{lifecycle:{...migratedLifecycle!,messages:visible?1:0}}});
    const before=calls.length;await visibility.pump();await visibility.idle();assert.equal(calls.length,before);
    for(const kind of [first,first==='visibility'?'naming':'visibility']){
     const requested=await edit(id,kind==='visibility'?{recalculate:true}:{automaticName:true});assert.ok(requested.lifecycle.changeId);
     if(kind==='visibility')assert.equal(requested.lifecycle.kind,'pending');
     await assess();const saved=await db.threadAssessment.findFirstOrThrow({where:{threadId:id,kind}});
     assert.equal(saved.status,'applied');assert.ok(RequestPayload.parse(saved.request).selection.changes?.some(c=>c.id===requested.lifecycle.changeId));
     assert.match(JSON.stringify(saved.request),/Historical ongoing matter/);
    }
    assert.equal(calls.length,before+2);assert.equal((await read(id)).title,'Recognizable automatic name');assert.equal((await read(id)).lifecycle.kind,'indefinite');
   }
  });
   assert.equal(await db.artifact.count({where:{OR:[{payload:{path:['purpose'],equals:'thread_visibility'}},{payload:{path:['purpose'],equals:'thread_naming'}},{payload:{path:['type'],equals:'thread_event'}},{payload:{path:['type'],equals:'thread_control'}},{payload:{path:['type'],equals:'thread_assessment_result'}}]}}),0,'Visibility, naming, revival and recovery never write Artifacts');
 }finally{await visibility.stop();await intake.stop();await threads.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
