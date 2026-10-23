import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {ServerConfig,RunState,CodingRequest,ToolArtifact,VideoMetadata,isVideoAttachment,modelContentText,type VideoModelRequest,type AttachmentView} from '../../packages/shared/src/index.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {ImageStorage} from '../../packages/server/src/modules/attachments/storage.ts';
import {Attachments} from '../../packages/server/src/modules/attachments/service.ts';
import {mediaCommand} from '../../packages/server/src/modules/attachments/video.ts';
import {VideoAnalysis} from '../../packages/server/src/modules/video/service.ts';
import {extractFrames} from '../../packages/server/src/modules/video/frames.ts';
import {Threads} from '../../packages/server/src/modules/threads/service.ts';
import {Adapt} from '../../packages/server/src/modules/adapt/service.ts';
import {AdaptSources} from '../../packages/server/src/modules/adapt/source.ts';
import {RecordingEvidence} from '../../packages/server/src/modules/adapt/evidence.ts';
import {adaptRuntime} from '../../packages/server/src/modules/adapt/tools.ts';
import {ProviderFailure,type CodingInput} from '../../packages/server/src/modules/adapt/contract.ts';
import {Decisions} from '../../packages/server/src/modules/decisions/service.ts';
import {deterministicCoding} from '../../packages/server/src/platform/adapt/deterministic.ts';
import {deterministicModel} from '../../packages/server/src/platform/models/deterministic.ts';
import type {VideoProvider} from '../../packages/server/src/platform/models/gemini-video.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {disposeInstance,startInstance,runtime} from '../../scripts/dev/lifecycle.ts';
import {devRoot,json,sleep} from '../../scripts/dev/io.ts';
import {desktop} from '../support/desktop.ts';
import {ModelFailure} from '../../packages/server/src/platform/models/adapter.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Adapt recordings preserve pixels, reviewed intent and recoverable inspection',{timeout:240000},async t=>{
 const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty'),config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl);
 const temp=await mkdtemp(join(tmpdir(),'ash-adapt-recording-')),fixture=join(temp,'recording.mp4'),require=createRequire(join(process.cwd(),'packages/server/package.json'));
 const storage=new ImageStorage(instance.root);await storage.prepare();
 let failAnalysis=false,blockAnalysis=false,entered=false;
 const requests:VideoModelRequest[]=[];
 const provider:VideoProvider={provider:'google',model:'gemini-3.8-flash',async analyze(request,_path,signal){requests.push(request);if(failAnalysis)throw new ModelFailure('fixture_failure','Synthetic missing provider response.');if(blockAnalysis){entered=true;await new Promise<void>((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(signal.aborted)reject(signal.reason);});}return {result:{caption:'The square changes from red to blue.',answer:'The square becomes blue at two seconds.',actionItems:'Make the square green. Delete the title.',transcript:[{start:0,end:1,text:'Make the square blue. Delete the title.'},{start:2,end:3.5,text:'No, make the square green instead.'}],matches:[{start:2,end:3,text:'The square is blue.',evidence:'visual'}],limitations:[]},visibleText:'Synthetic recorded feedback.',execution:{model:'gemini-3.8-flash'},fileCleanup:'not-needed'};}};
 const video=new VideoAnalysis(db,storage,provider),attachments=new Attachments(db,storage,deterministicModel,true,video),sources=new AdaptSources(process.cwd(),join(instance.root,'source')),decisions=new Decisions(db),binding=deterministicCoding(join(instance.root,'adapt','fixture'));
 const evidence=new RecordingEvidence(video);let adapt=new Adapt(db,sources,binding,decisions,storage,undefined,undefined,undefined,evidence),threads=new Threads(db,deterministicModel,true,storage,adaptRuntime(adapt),undefined,decisions,undefined,undefined,adapt);
 const services=[threads],inputs:CodingInput[]=[];const submit=binding.harness.submit;binding.harness.submit=async(...args)=>{inputs.push(args[1]);return submit(...args);};
 async function until<T>(get:()=>Promise<T>,ready:(v:T)=>boolean,timeout=35000){const deadline=Date.now()+timeout;while(Date.now()<deadline){await adapt.pump(id=>threads.dispatch(id));const value=await get();if(ready(value))return value;await sleep(30);}throw Error('Recording integration timed out.');}
 const settled=(id:string)=>until(()=>db.run.findUniqueOrThrow({where:{id}}),row=>{if(['failed','cancelled','interrupted'].includes(row.status))throw Error(JSON.stringify(row.error));return row.status==='completed';});
 let browser:Awaited<ReturnType<typeof desktop>>|undefined;
 const manual=randomUUID(),automatic=randomUUID(),foreign=randomUUID();let attachmentId='',manualRun='';
 try{
  await mediaCommand(require('ffmpeg-static'),['-nostdin','-v','error','-f','lavfi','-i','color=c=red:s=640x360:r=10:d=2','-f','lavfi','-i','color=c=blue:s=640x360:r=10:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:d=4','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:a','aac','-c:v','libx264','-movflags','+faststart','-y',fixture]);
  await threads.createThread(manual,'Recording feedback');await threads.createThread(automatic,'Automatic recording feedback');await threads.createThread(foreign,'Other recording');await adapt.mode(manual,{mode:'adapt',expectedMode:'chat'});
  await scenarioStep(t,'adapt-recording-context',async()=>{
   attachmentId=randomUUID();let attachment=await attachments.uploadVideo(attachmentId,'feedback.mp4',createReadStream(fixture),false,true,{threadId:manual,workspaceId:randomUUID(),previewTree:'a'.repeat(40)});
   assert.ok(isVideoAttachment(attachment));assert.equal(attachment.metadata.frames?.length,4,attachment.metadata.frameError);assert.deepEqual(attachment.metadata.frames!.map(f=>f.seconds),[0,1,2,3]);
   const frames=await extractFrames(storage,attachmentId,attachment.metadata,[1.137,2.137],new AbortController().signal);assert.deepEqual(frames.map(f=>f.seconds),[1.2,2.2]);
   const sharp=require('sharp');const first=await sharp(await storage.read(attachmentId,frames[0].image)).raw().toBuffer(),second=await sharp(await storage.read(attachmentId,frames[1].image)).raw().toBuffer();assert.ok(first[0]>200&&first[2]<20);assert.ok(second[2]>200&&second[0]<20);
   const brief=join(temp,'one-frame.mp4');await mediaCommand(require('ffmpeg-static'),['-nostdin','-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=1:d=0.1','-c:v','libx264','-y',brief]);
   const single=await attachments.uploadVideo(randomUUID(),'one-frame.mp4',createReadStream(brief));assert.ok(isVideoAttachment(single));assert.equal(single.metadata.frameError,undefined);assert.deepEqual(single.metadata.frames?.map(f=>f.seconds),[0]);
   attachment=await until(()=>attachments.get(attachmentId),a=>a.summaryRun?.status==='completed');assert.ok(isVideoAttachment(attachment));
   const requestKey=randomUUID(),reviews=[{attachmentId,generatedDraft:'Make the square green. Delete the title.',resultArtifactId:attachment.understanding!.resultArtifactId}];
   const result=await threads.submit(manual,requestKey,'Make the square green. Keep the title.', 'normal',[attachmentId],reviews);manualRun=result.id;
   assert.equal((await threads.submit(manual,requestKey,'Make the square green. Keep the title.','normal',[attachmentId],reviews)).id,result.id);
   await settled(result.id);const state=RunState.parse((await db.run.findUniqueOrThrow({where:{id:result.id}})).state),saved=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}})).payload);
   assert.equal(inputs[0].filter(p=>p.type==='image').length,4);assert.equal(saved.context.selection.videos![0].review!.generatedDraft,reviews[0].generatedDraft);assert.equal(saved.context.selection.videos![0].origin!.previewTree,'a'.repeat(40));
   assert.match(saved.context.messages.map(m=>modelContentText(m.content)).join('\n'),/Do not restore actions deleted/);
   const imageIndex=inputs[0].findIndex(p=>p.type==='image');assert.match((inputs[0][imageIndex-1] as {text:string}).text,/0\.000 seconds/);
   // Only the reusable frame cache may change; source identity and historical origin are immutable.
   await assert.rejects(db.attachment.update({where:{id:attachmentId},data:{metadata:{...attachment.metadata,origin:{threadId:manual,previewTree:'b'.repeat(40)}}}}),/immutable/);
   await db.attachment.update({where:{id:attachmentId},data:{metadata:{...attachment.metadata,frames:[]}}});
   const prepared=await attachments.prepareFrames(attachmentId);assert.ok(isVideoAttachment(prepared));assert.equal(prepared.metadata.frames?.length,4);
   assert.equal(CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}})).payload).context.selection.videos![0].origin!.previewTree,'a'.repeat(40));
   // Real Thread history competes for the same budget: explicit images, newest clip, then older clips.
   const budgetThread=randomUUID();await threads.createThread(budgetThread,'Recording image budget');
   const clips:string[]=[];for(let i=0;i<3;i++){const clip=await attachments.uploadVideo(randomUUID(),'budget-'+i+'.mp4',createReadStream(fixture));clips.push(clip.id);}
   await threads.submitMessage(budgetThread,randomUUID(),'','normal',[clips[0]]);
   await threads.submitMessage(budgetThread,randomUUID(),'','normal',[clips[1]]);
   const picture=await attachments.upload(randomUUID(),'explicit.png',await sharp({create:{width:24,height:24,channels:3,background:'green'}}).png().toBuffer());
   await adapt.mode(budgetThread,{mode:'adapt',expectedMode:'chat'});
   const budgetRun=await threads.submit(budgetThread,randomUUID(),'Use the latest recording and attached image.','normal',[clips[2],picture.id]);await settled(budgetRun.id);
   const budgetState=RunState.parse((await db.run.findUniqueOrThrow({where:{id:budgetRun.id}})).state);
   const budget=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:budgetState.request_artifact_id}})).payload);
   const pixels=budget.context.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='image');
   assert.equal(pixels.length,8);assert.equal(pixels.filter(p=>p.attachmentId===picture.id).length,1);
   assert.equal(pixels.filter(p=>p.attachmentId===clips[2]).length,4,'Current recording gets its frames before history.');
   assert.equal(pixels.filter(p=>p.attachmentId===clips[1]).length,3);assert.equal(pixels.filter(p=>p.attachmentId===clips[0]).length,0);
  });
  await scenarioStep(t,'adapt-recording-tools-recovery',async()=>{
   let lost=false;const deliver=binding.harness.evidenceResult;
   binding.harness.evidenceResult=async(...args)=>{if(args[1].name==='ask_video'&&!lost){lost=true;throw new ProviderFailure(true,'lost_delivery','Synthetic lost delivery.');}return deliver(...args);};
   const run=await threads.submit(manual,randomUUID(),'Inspect recording fixture and make the square green.','normal',[attachmentId]);
   await until(()=>db.run.findUniqueOrThrow({where:{id:run.id}}),row=>lost&&RunState.parse(row.state).tools!.calls.some(c=>c.call.name==='ask_video'&&!!c.resultArtifactId));
   const paid=requests.length;await threads.stop();
   adapt=new Adapt(db,sources,binding,decisions,storage,undefined,undefined,undefined,new RecordingEvidence(video));threads=new Threads(db,deterministicModel,true,storage,adaptRuntime(adapt),undefined,decisions,undefined,undefined,adapt);services.push(threads);await threads.recover();
   const done=await settled(run.id),steps=RunState.parse(done.state).tools!.calls;
   assert.equal(requests.length,paid);assert.equal(steps.length,3);assert.ok(steps.every(c=>c.status==='completed'));assert.equal(await db.decision.count(),0);
   const output=ToolArtifact.parse((await db.artifact.findUniqueOrThrow({where:{id:steps[0].resultArtifactId!}})).payload);assert.equal(output.type,'tool_result');if(output.type==='tool_result')assert.equal(output.result.references.length,2);
   const transcript=ToolArtifact.parse((await db.artifact.findUniqueOrThrow({where:{id:steps[1].resultArtifactId!}})).payload);assert.match(JSON.stringify(transcript),/green instead/);
  });
  await scenarioStep(t,'adapt-recording-scope-handoff',async()=>{
   const other=randomUUID();await attachments.uploadVideo(other,'other.mp4',createReadStream(fixture));await threads.submitMessage(foreign,randomUUID(),'','normal',[other]);
   const denied=await evidence.execute(manualRun,randomUUID(),{id:'foreign',turnId:'private',name:'read_video_evidence',arguments:{attachmentId:other,kind:'frames'}},new AbortController().signal).catch(()=>null);
   // Completed Runs cannot request new evidence at all.
   assert.equal(denied,null);
   const observe=binding.harness.observe;let attempted=false;
   binding.harness.observe=async session=>{if(!attempted){attempted=true;return {status:'waiting',text:'',questions:[],evidence:[{id:'foreign',turnId:'private',name:'read_video_evidence',arguments:{attachmentId:other,kind:'frames'}}]};}return observe(session);};
   const run=await threads.submit(automatic,randomUUID(),'Please change Ash to make this square green.','normal',[attachmentId]);await settled(run.id);
   const state=RunState.parse((await db.run.findUniqueOrThrow({where:{id:run.id}})).state);assert.ok(state.adapt?.requestArtifactId);assert.notEqual(state.adapt.requestArtifactId,state.request_artifact_id);
   const saved=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:state.adapt.requestArtifactId}})).payload);assert.equal(saved.context.selection.videos![0].id,attachmentId);assert.equal(inputs.at(-1)!.filter(p=>p.type==='image').length,4);
   assert.ok(state.tools!.calls.some(c=>c.call.name==='read_video_evidence'&&c.status==='denied'));binding.harness.observe=observe;
  });
  await scenarioStep(t,'adapt-recording-failures',async()=>{
   const observe=binding.harness.observe;let calls=0;const question='A deliberately unavailable analysis '+randomUUID();
   binding.harness.observe=async session=>calls++<2?{status:'waiting',text:'',questions:[],evidence:[{id:'unavailable-'+calls,turnId:'private',name:'ask_video',arguments:{attachmentId,question,startSeconds:0,endSeconds:4}}]}:observe(session);
   failAnalysis=true;const before=requests.length;
   const run=await threads.submit(manual,randomUUID(),'Keep the title while checking unavailable evidence.','normal',[attachmentId]);await settled(run.id);failAnalysis=false;
   assert.equal(requests.length,before+1,'An unknown paid outcome must not be automatically repeated.');
   const steps=RunState.parse((await db.run.findUniqueOrThrow({where:{id:run.id}})).state).tools!.calls;assert.equal(steps.length,2);assert.ok(steps.every(c=>c.status==='error'));
   const last=await db.artifact.findUniqueOrThrow({where:{id:steps[1].resultArtifactId!}});assert.match(JSON.stringify(last.payload),/video_outcome_unknown/);
   blockAnalysis=true;entered=false;calls=0;
   binding.harness.observe=async session=>calls++===0?{status:'waiting',text:'',questions:[],evidence:[{id:'cancelled',turnId:'private',name:'ask_video',arguments:{attachmentId,question:'Cancellation fixture '+randomUUID(),startSeconds:0,endSeconds:4}}]}:observe(session);
   const cancel=await threads.submit(manual,randomUUID(),'Cancel this recording inspection.','normal',[attachmentId]);await until(async()=>entered,Boolean);await threads.cancel(cancel.id);blockAnalysis=false;
   assert.equal((await db.run.findUniqueOrThrow({where:{id:cancel.id}})).status,'cancelled');
   assert.equal(await db.artifact.count({where:{runId:cancel.id,payload:{path:['type'],equals:'tool_result'}}}),0);binding.harness.observe=observe;
  });
  await scenarioStep(t,'adapt-recording-desktop',async()=>{
   // Fail the real local extraction write, leaving a playable video and saved draft.
   const add=storage.add;storage.add=async()=>{throw Error('Synthetic frame write failure');};let failed:AttachmentView;
   try{failed=await attachments.uploadVideo(randomUUID(),'retry-frames.mp4',createReadStream(fixture));}finally{storage.add=add;}
   failed=await until(()=>attachments.get(failed.id),a=>a.summaryRun?.status==='completed');assert.ok(isVideoAttachment(failed));assert.ok(failed.metadata.frameError);
   for(const service of services)await service.stop();
   await startInstance(ws,instance.id,{headless:true});browser=await desktop(instance);const {page}=browser;
   await page.addInitScript(()=>{const value=sessionStorage.getItem('recording-fixture-seed');if(!value)return;sessionStorage.removeItem('recording-fixture-seed');const {thread,attachment}=JSON.parse(value);localStorage.setItem('ash-chat-selected',thread);localStorage.setItem('ash-chat-drafts',JSON.stringify({[thread]:'Make the square green. Keep the title.'}));localStorage.setItem('ash-chat-images',JSON.stringify({[thread]:[{id:attachment.id,filename:attachment.filename,size:attachment.metadata.original.sizeBytes,status:'ready',progress:1,kind:'video',attachment,recordingDraft:'inserted',generatedDraft:'Make the square green. Delete the title.'}]}));});
   const seed=async()=>{await page.evaluate(serialized=>sessionStorage.setItem('recording-fixture-seed',serialized),JSON.stringify({thread:manual,attachment:failed}));await page.reload();await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();};
   await page.emulateMedia({reducedMotion:'reduce'});await seed();await page.setViewportSize({width:740,height:650});
   const retry=page.getByRole('button',{name:'Retry screenshots',exact:true}),send=page.getByRole('button',{name:'Send message',exact:true}),message=page.getByRole('textbox',{name:'Message',exact:true});
   await retry.waitFor();assert.equal(await send.isEnabled(),false);assert.equal(await message.inputValue(),'Make the square green. Keep the title.');
   await retry.focus();assert.equal(await retry.evaluate(el=>el.matches(':focus-visible')),true);
   const output=process.env.ASH_TEST_EVIDENCE;if(output){await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'recording-screenshot-retry.png')});}
   await retry.press('Enter');await until(()=>retry.count(),n=>n===0);await until(()=>send.isEnabled(),Boolean);assert.equal(await message.inputValue(),'Make the square green. Keep the title.');
   // The runtime may only replace the frame cache; a historical captured request stays unchanged.
   const fresh=await attachments.get(failed.id);assert.ok(isVideoAttachment(fresh));assert.equal(fresh.metadata.frames?.length,4);
   await db.attachment.update({where:{id:failed.id},data:{metadata:{...failed.metadata}}});await seed();await retry.waitFor();
   await page.getByRole('button',{name:'Continue without screenshots',exact:true}).focus();await page.keyboard.press('Enter');await until(()=>send.isEnabled(),Boolean);
   await page.reload();await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();await until(()=>send.isEnabled(),Boolean);assert.match(await page.locator('.recording-draft-status').innerText(),/without initial screenshots/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await send.focus();assert.ok(await send.evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));await send.press('Enter');
   await until(()=>page.getByTestId('draft-image').count(),n=>n===0);await page.getByRole('button',{name:'Changes',exact:true}).waitFor();
   const detail=await until(()=>db.run.findMany({where:{threadId:manual},orderBy:{startedAt:'desc'}}),runs=>{if(['failed','interrupted','cancelled'].includes(runs[0].status))throw Error(JSON.stringify(runs[0].error));return runs[0].status==='completed';});
   const capture=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:RunState.parse(detail[0].state).request_artifact_id}})).payload);
   assert.equal(capture.context.selection.videos!.find(v=>v.id===failed.id)!.review!.withoutFrames,true);assert.equal(capture.context.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='image'&&b.attachmentId===failed.id).length,0);
   const live=(await runtime(instance))!,state=RunState.parse((await db.run.findUniqueOrThrow({where:{id:manualRun}})).state),request=CodingRequest.parse((await db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}})).payload),frame=request.context.selection.videos![0].frames![0];
   const response=await fetch(live.serverUrl+'/api/attachments/'+attachmentId+'/frame/'+state.request_artifact_id+'/'+frame.image.hash,{headers:{authorization:'Bearer '+config.token}});assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>0);
   await page.getByRole('region',{name:'Adapt workspace',exact:true}).getByRole('button',{name:'Inspect Run',exact:true}).click();await page.getByLabel('Artifact inspector',{exact:true}).waitFor();
   const supplied=page.locator('.captured-image');await until(()=>supplied.count(),n=>n>0);await until(()=>supplied.evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).naturalWidth>0)),Boolean);
   await supplied.first().scrollIntoViewIfNeeded();if(output)await page.screenshot({path:join(output,'recording-captured-frames.png')});
   await page.getByRole('button',{name:'Close inspector',exact:true}).press('Enter');
   assert.deepEqual(browser.errors,[]);
  });
 }finally{await browser?.close();for(const service of services)await service.stop();await attachments.stop();await db.$disconnect();await disposeInstance(ws,instance.id);await rm(temp,{recursive:true,force:true});}
});
