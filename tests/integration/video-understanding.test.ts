import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {ServerConfig,RequestPayload,RunState,VideoPlan,VideoModelRequest,isVideoAttachment,modelContentText,type ToolCall,type RunView} from '../../packages/shared/src/index.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {ImageStorage} from '../../packages/server/src/modules/attachments/storage.ts';
import {Attachments} from '../../packages/server/src/modules/attachments/service.ts';
import {VideoAnalysis} from '../../packages/server/src/modules/video/service.ts';
import {videoRuntime} from '../../packages/server/src/modules/video/tools.ts';
import {Threads} from '../../packages/server/src/modules/threads/service.ts';
import {Decisions} from '../../packages/server/src/modules/decisions/service.ts';
import {Permissions} from '../../packages/server/src/modules/permissions/service.ts';
import {offlineEvaluator} from '../../packages/server/src/modules/permissions/evaluator.ts';
import {deterministicModel} from '../../packages/server/src/platform/models/deterministic.ts';
import {ModelFailure,type ModelAdapter} from '../../packages/server/src/platform/models/adapter.ts';
import {type VideoProvider} from '../../packages/server/src/platform/models/gemini-video.ts';
import {mediaCommand} from '../../packages/server/src/modules/attachments/video.ts';
import {devRoot,json,exec,sleep} from '../../scripts/dev/io.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {startInstance,disposeInstance,runtime} from '../../scripts/dev/lifecycle.ts';
import {desktop} from '../support/desktop.ts';
import {scenarioStep} from '../support/node-scenarios.ts';
async function until<T>(read:()=>Promise<T>,accept:(v:T)=>boolean,timeout=30000){const end=Date.now()+timeout;do{const v=await read();if(accept(v))return v;await sleep(25);}while(Date.now()<end);throw Error('Video understanding fixture timed out.');}
const call=(name:string,args:unknown):ToolCall=>({name,callId:randomUUID(),arguments:JSON.stringify(args)});
test('video understanding persists background context, shared tools and inspectable evidence without external calls',{timeout:240000},async t=>{
  const source=process.cwd(),base=await mkdtemp(join(tmpdir(),'ash-video-understanding-')),checkout=source;
  t.after(async()=>{await rm(base,{recursive:true,force:true});});
  const ws=await workspace(checkout,await devRoot()),instance=await createInstance(ws,'test','empty');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl),storage=new ImageStorage(instance.root);
  await storage.prepare();
  const binary=createRequire(join(source,'packages/server/package.json'))('ffmpeg-static'),fixture=join(base,'fixture.mp4');
  await mediaCommand(binary,['-nostdin','-v','error','-f','lavfi','-i','color=c=0xe7ecdf:s=320x180:r=12','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','2','-c:v','libx264','-c:a','aac','-movflags','+faststart','-y',fixture]);
  const requests:VideoModelRequest[]=[];let hold=true,release!:()=>void,fail=false,block=false,failAtOffset:number|undefined;
  const gate=new Promise<void>(resolve=>release=resolve);
  const provider:VideoProvider={provider:'google',model:'gemini-3.8-flash',async analyze(request,_path,signal){
    requests.push(structuredClone(request));
    if(hold&&request.operation==='caption')await gate;
    if(block)await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    signal.throwIfAborted();
    if(fail||request.media?.sourceOffset===failAtOffset&&failAtOffset!==undefined)throw new ModelFailure('fixture_provider_failure','Synthetic provider failure.');
    const duration=request.media?request.media.end-request.media.start:2;
    const result={caption:['caption','combine-caption'].includes(request.operation)?'Mock caption: visible controls; narration corrects green to cream.':'',
      actionItems:['caption','combine-caption'].includes(request.operation)?'- Keep the Stop button cream like Discard.':'',
      answer:['question','describe'].includes(request.operation)?'Mock answer: keep cream; the request is distinct from the visible state.':'',
      transcript:request.operation==='caption'?[{start:.1,end:Math.min(duration,.6),text:'Mock narration: actually keep cream.'}]:[],
      matches:['question','describe'].includes(request.operation)?[{start:Math.min(.2,duration/4),end:Math.min(.6,duration*.75),text:'Mock observed interval.',evidence:'both' as const}]:[],
      limitations:['Controlled provider fixture, not a measured model result.']};
    return {result,visibleText:JSON.stringify(result),execution:{model:this.model,inputTokens:100,outputTokens:50},fileCleanup:'not-needed'};
  }};
  const video=new VideoAnalysis(db,storage,provider),attachments=new Attachments(db,storage,deterministicModel,true,video);
  const services:Threads[]=[];
  const decisions=new Decisions(db),permissions=new Permissions(db,decisions,offlineEvaluator);
  const threads=(model:ModelAdapter=deterministicModel,auto=false,managed=false)=>{const value=new Threads(db,model,auto,storage,videoRuntime(video),undefined,managed?decisions:undefined,managed?permissions:undefined);services.push(value);return value;};
  const plain=threads();let asset!:Awaited<ReturnType<Attachments['get']>>,thread='',answerRun!:RunView;
  const done=(id:string)=>until(()=>db.run.findUniqueOrThrow({where:{id}}),r=>!['queued','running'].includes(r.status));
  let browser:Awaited<ReturnType<typeof desktop>>|undefined;
  try{
    await scenarioStep(t,'video-background-context',async()=>{
      const id=randomUUID(),rows=await Promise.all([attachments.uploadVideo(id,'mock.mp4',createReadStream(fixture),false,true),attachments.uploadVideo(id,'mock.mp4',createReadStream(fixture),false,true)]);
      asset=rows[0];assert.equal(rows[0].summaryRun!.id,rows[1].summaryRun!.id);await until(async()=>requests.length,n=>n===1);
      thread=randomUUID();await plain.createThread(thread,'Video understanding fixture');
      const queued=await plain.submit(thread,randomUUID(),'Use the recorded narration.','normal',[asset.id]);
      const frozen=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:queued.state.request_artifact_id}})).payload);
      assert.match(frozen.messages.map(m=>modelContentText(m.content)).join('\n'),/caption\/transcript (queued|running)/);
      assert.ok(frozen.selection.composition);
      assert.equal(frozen.messages[frozen.selection.composition.messageIndex].role,'system');
      assert.match(modelContentText(frozen.messages[frozen.selection.composition.messageIndex].content),/Summarizing narrated action items does not authorize or execute them/);
      hold=false;release();await done(asset.summaryRun!.id);
      asset=await attachments.get(asset.id);assert.ok(isVideoAttachment(asset)&&asset.understanding);assert.equal(requests.length,1);
      assert.equal(asset.understanding.actionItems,'- Keep the Stop button cream like Discard.');
      assert.equal(asset.understanding.complete,true);assert.match(requests[0].prompt,/actual action items from deliberate user narration/);
      assert.equal(await db.artifact.count({where:{sourceId:asset.inputArtifactId,layer:'surface'}}),0);
      assert.deepEqual(RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:queued.state.request_artifact_id}})).payload),frozen);
      plain.dispatch(queued.id);await done(queued.id);
      const next=await plain.submit(thread,randomUUID(),'Follow up on the clip.','empty');
      const captured=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:next.state.request_artifact_id}})).payload);
      assert.ok(captured.messages.some(m=>modelContentText(m.content).includes('Mock narration')));assert.equal(captured.selection.videos?.[0].representation,'caption-transcript');
      plain.dispatch(next.id);await done(next.id);
    });
    await scenarioStep(t,'video-tools-scope-evidence',async()=>{
      const ask=()=>call('ask_video',{attachmentId:asset.id,question:'What is the final requested color?'});
      const model:ModelAdapter={...deterministicModel,async *stream(request){
        if(!request.tools?.previousOutputIds.length)yield {kind:'output' as const,calls:[ask(),ask(),call('describe_video',{attachmentId:asset.id,startSeconds:.4,endSeconds:1.2,fps:5})]};
        else yield 'Mock video answer [recorded evidence](ash-source:'+request.tools.results[0].result.references[0].citationId+').';
      }};
      await permissions.seed();const engine=threads(model,true,true);
      answerRun=await engine.submit(thread,randomUUID(),'Describe this video and find its final color.','normal',[asset.id]);
      const finished=await done(answerRun.id);assert.equal(finished.status,'completed',JSON.stringify(finished.error));
      const calls=RunState.parse(finished.state).tools!.calls;assert.equal(calls.length,3);
      assert.equal(await db.artifact.count({where:{runId:finished.id,payload:{path:['type'],equals:'permission_evaluation'}}}),3);
      assert.ok(calls.every(c=>!c.decisionId));
      const results=await Promise.all(calls.map(c=>db.artifact.findUniqueOrThrow({where:{id:c.resultArtifactId!}})));
      const data=results.map(r=>(r.payload as any).result);assert.ok(data.every(r=>r.status==='success'));
      assert.equal(data[0].content[1].value.analysisArtifactId,data[1].content[1].value.analysisArtifactId);
      assert.equal(requests.filter(r=>r.operation==='question').length,1);assert.equal(requests.filter(r=>r.operation==='caption').length,1);
      const detail=requests.find(r=>r.operation==='describe')!;assert.equal(detail.media!.sourceOffset,.4);assert.equal(detail.media!.fps,5);assert.equal(detail.media!.transform,'clip-v1');
      const reference=data[2].references[0];assert.ok(reference.location.startSeconds>=.4);assert.equal(reference.contentHash,detail.media!.file.hash);
      assert.match(data[2].content[0].text,/Answer timestamps are relative to this supplied clip: add 0\.40s/);
      assert.ok((await storage.checkedFile(asset.id,detail.media!.file)).endsWith(detail.media!.file.hash));
      const foreign=randomUUID();await plain.createThread(foreign,'Foreign scope');const noAsset=await plain.submit(foreign,randomUUID(),'No captured video.','empty');
      const runtime=videoRuntime(video),context={runId:noAsset.id,threadId:foreign,callId:randomUUID(),signal:new AbortController().signal,authorize:async()=>({outcome:'allowed' as const,code:'fixture',message:'fixture',configurationRevision:'1',evaluator:'not-performed' as const})};
      await assert.rejects(runtime.tools[0].prepare({attachmentId:asset.id},context),/captured Thread context/);
      plain.dispatch(noAsset.id);await done(noAsset.id);
      const before=requests.length;
      const invalid=await plain.submit(thread,randomUUID(),'Reject an invalid interval.','empty',[asset.id]);
      // The service boundary independently rejects an invalid range before any provider call.
      await assert.rejects(video.forTool(asset.id,{operation:'describe',start:1,end:.5},new AbortController().signal),/interval/);
      assert.equal(requests.length,before);await plain.cancel(invalid.id);await done(invalid.id);
    });
    await scenarioStep(t,'video-processing-bounds',async()=>{
      const long=join(base,'long.mp4');await mediaCommand(binary,['-nostdin','-v','error','-f','lavfi','-i','color=c=0xe7ecdf:s=320x180:r=6',
        '-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','130','-c:v','libx264','-preset','ultrafast','-c:a','aac','-movflags','+faststart','-y',long]);
      failAtOffset=120;
      const original=await attachments.uploadVideo(randomUUID(),'segmented.mp4',createReadStream(long),false,true);await done(original.summaryRun!.id);
      const partial=await attachments.get(original.id);assert.ok(isVideoAttachment(partial)&&partial.understanding);
      assert.equal(partial.summaryRun!.status,'failed');assert.deepEqual(partial.understanding.coverage,[{start:0,end:120}]);
      assert.equal(partial.understanding.actionItems,'');assert.equal(partial.understanding.complete,false);
      const frozen=await db.artifact.findUniqueOrThrow({where:{id:partial.understanding.resultArtifactId}});
      failAtOffset=undefined;
      const retry=await attachments.retry(original.id,randomUUID(),partial.summaryRun!.id);await done(retry.summaryRun!.id);
      const completed=await attachments.get(original.id);assert.ok(isVideoAttachment(completed)&&completed.understanding);
      assert.deepEqual(completed.understanding.coverage,[{start:0,end:120},{start:120,end:130}]);
      assert.equal(completed.understanding.actionItems,'- Keep the Stop button cream like Discard.');
      const combined=requests.filter(r=>r.operation==='combine-caption').at(-1)!;assert.match(combined.prompt,/corrections across segments/);assert.match(combined.prompt,/120\.1/);
      assert.ok(completed.understanding.transcript.some(s=>s.start>=120));assert.deepEqual((await db.artifact.findUniqueOrThrow({where:{id:frozen.id}})).payload,frozen.payload);
      const count=requests.length;await assert.rejects(video.forTool(original.id,{operation:'describe',start:0,end:60,fps:5},new AbortController().signal),/30 seconds/);
      assert.equal(requests.length,count);
    });
    await scenarioStep(t,'video-recovery-failure',async()=>{
      fail=true;const failed=await attachments.uploadVideo(randomUUID(),'failed.mp4',createReadStream(fixture));await done(failed.summaryRun!.id);
      assert.equal((await attachments.get(failed.id)).summaryRun!.status,'failed');const before=requests.length;
      assert.equal(await readFile(await storage.checkedFile(failed.id,failed.metadata.original)).then(b=>b.length),failed.metadata.original.sizeBytes);
      fail=false;const key=randomUUID(),retried=await attachments.retry(failed.id,key,failed.summaryRun!.id);
      assert.equal((await attachments.retry(failed.id,key,failed.summaryRun!.id)).summaryRun!.id,retried.summaryRun!.id);
      await done(retried.summaryRun!.id);assert.equal(requests.length,before+1);
      const old=VideoPlan.parse((await db.artifact.findUniqueOrThrow({where:{id:failed.summaryRun!.state.request_artifact_id}})).payload);
      const fresh=VideoPlan.parse((await db.artifact.findUniqueOrThrow({where:{id:retried.summaryRun!.state.request_artifact_id}})).payload);assert.deepEqual(fresh,old);
      const offline=new Attachments(db,storage,deterministicModel,false,video),pending=await offline.uploadVideo(randomUUID(),'interrupted.mp4',createReadStream(fixture));
      const count=requests.length;await offline.recover();assert.equal((await offline.get(pending.id)).summaryRun!.status,'interrupted');
      await offline.uploadVideo(pending.id,'interrupted.mp4',createReadStream(fixture));assert.equal(requests.length,count);
      block=true;
      const cancelling=threads({...deterministicModel,async *stream(){yield {kind:'output' as const,calls:[call('ask_video',{attachmentId:asset.id,question:'Cancel this distinct request.'})]};}},true);
      const cancelled=await cancelling.submit(thread,randomUUID(),'Cancel this video tool.','normal',[asset.id]);
      await until(async()=>requests.length,n=>n>count);await cancelling.cancel(cancelled.id);assert.equal((await done(cancelled.id)).status,'cancelled');block=false;
      const orphan=await attachments.uploadVideo(randomUUID(),'orphan.mp4',createReadStream(fixture));await done(orphan.summaryRun!.id);
      await db.attachment.update({where:{id:orphan.id},data:{expiresAt:new Date(Date.now()-1)}});await attachments.cleanup();
      assert.equal(await db.attachment.findUnique({where:{id:orphan.id}}),null);
    });
    await scenarioStep(t,'video-understanding-desktop',async()=>{
      await startInstance(ws,instance.id,{headless:true});browser=await desktop(instance);const {page}=browser;
      await page.getByRole('button',{name:'Video understanding fixture',exact:true}).first().click();
      await page.getByText('Mock video answer',{exact:false}).waitFor();
      assert.ok(!(await page.locator('.messages').innerText()).includes('Mock narration: actually keep cream.'));
      await page.getByRole('link',{name:'recorded evidence',exact:true}).click();
      await page.getByRole('dialog',{name:'Video viewer: mock.mp4'}).waitFor();
      await until(()=>page.locator('.stage video').evaluate((v:HTMLVideoElement)=>v.readyState),n=>n>=2);
      assert.ok(await page.locator('.stage video').evaluate((v:HTMLVideoElement)=>v.currentTime>=.19));
      const transcript=page.locator('.transcript-details');assert.equal(await transcript.evaluate((d:HTMLDetailsElement)=>d.open),false);
      await transcript.locator('summary').click();assert.ok(await transcript.innerText().then(s=>s.includes('Mock narration: actually keep cream.')));
      await page.locator('.stage video').evaluate((v:HTMLVideoElement)=>v.pause());await transcript.getByRole('button',{name:'Seek to 0:00',exact:true}).click();
      await until(()=>page.locator('.stage video').evaluate((v:HTMLVideoElement)=>v.currentTime),n=>n>=.09&&n<.4);
      await page.getByRole('dialog').press('Escape');
      await page.getByRole('link',{name:'recorded evidence',exact:true}).click();assert.equal(await page.locator('.transcript-details').evaluate((d:HTMLDetailsElement)=>d.open),false);await page.getByRole('dialog').press('Escape');
      const result=await plain.inspect(answerRun.state.request_artifact_id);assert.ok(!JSON.stringify(result).includes('base64,'));
      const live=(await runtime(instance))!,request=(await db.artifact.findMany({where:{runId:answerRun.id}})).find(a=>(a.payload as any).type==='video_model_request'&&(a.payload as any).operation==='describe')!;
      const evidence=await fetch(live.serverUrl+'/api/attachments/'+asset.id+'/evidence/'+request.id,{headers:{authorization:'Bearer '+cfg.token}});
      assert.equal(evidence.status,200);assert.ok((await evidence.arrayBuffer()).byteLength>0);
      const descriptor=VideoModelRequest.parse(request.payload).media!.file;
      const capturedPath=await storage.checkedFile(asset.id,descriptor),bytes=await readFile(capturedPath),damaged=Buffer.from(bytes);damaged[damaged.length-1]^=1;
      try{
        await writeFile(capturedPath,damaged);
        const corrupt=await fetch(live.serverUrl+'/api/attachments/'+asset.id+'/evidence/'+request.id,{headers:{authorization:'Bearer '+cfg.token}});
        assert.equal(corrupt.status,409);await corrupt.arrayBuffer();
      }finally{await writeFile(capturedPath,bytes);}
      const restored=await fetch(live.serverUrl+'/api/attachments/'+asset.id+'/evidence/'+request.id,{headers:{authorization:'Bearer '+cfg.token}});
      assert.equal(restored.status,200);assert.deepEqual(Buffer.from(await restored.arrayBuffer()),bytes);
      assert.deepEqual(browser.errors,[]);
      const evidenceRoot=process.env.ASH_TEST_EVIDENCE;if(evidenceRoot){await mkdir(evidenceRoot,{recursive:true});await page.screenshot({path:join(evidenceRoot,'video-understanding-chat.png')});}
    });
  }finally{
    release();await browser?.app.close();for(const service of services)await service.stop();await attachments.stop();await db.$disconnect();await disposeInstance(ws,instance.id);
  }
});
