import { scenarioStep } from '../support/node-scenarios.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,rm,readFile,writeFile,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron,type ElectronApplication } from 'playwright';
import { ServerConfig,RequestPayload,modelContentText,type AttachmentView,type ThreadDetail,type RunView,type InspectionView } from '../../packages/shared/src/index.ts';
import { devRoot,json,id,atomic,childEnvironment,sleep,exec } from '../../scripts/dev/io.ts';
import { workspace,createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance,stopInstance,disposeInstance,runtime } from '../../scripts/dev/lifecycle.ts';
import { buildMain } from '../../scripts/dev/build.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { Attachments } from '../../packages/server/src/modules/attachments/service.ts';
import { ImageStorage } from '../../packages/server/src/modules/attachments/storage.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import { ModelFailure } from '../../packages/server/src/platform/models/adapter.ts';
import { screenshotFixture,orientedFixture } from '../../packages/server/test/fixtures/images.ts';
import { makeWorktree } from '../helpers/worktree.ts';

async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,timeout=15000):Promise<T>{
  const deadline=Date.now()+timeout;do{const value=await read();if(accept(value))return value;await sleep(50);}while(Date.now()<deadline);throw new Error('Timed out waiting for image test state');
}
test('persisted images, description Runs and desktop workflow (no external calls)',{timeout:240000},async t=>{
  const source=process.cwd(),base=await mkdtemp(join(tmpdir(),'ash-images-')),checkout=join(base,'checkout');
  t.after(async()=>{await exec('git',['worktree','remove','--force',checkout],{cwd:source});await rm(base,{recursive:true,force:true});});
  await makeWorktree(source,checkout);
  const ws=await workspace(checkout,await devRoot()),instance=await createInstance(ws,'test','empty');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl),storage=new ImageStorage(instance.root);
  const images=new Attachments(db,storage,deterministicModel,false),threads=new Threads(db,deterministicModel,false,storage);
  const evidence=process.env.ASH_TEST_EVIDENCE??join(ws.devRoot,'evidence',id());await mkdir(evidence,{recursive:true});
  const bytes=await screenshotFixture();let app:ElectronApplication|undefined;
  const settle=(thread:string,run:string)=>until(()=>threads.readThread(thread),view=>view.runs.some(r=>r.id===run&&!['queued','running'].includes(r.status)));
  async function request(path:string,body?:object){const live=(await runtime(instance))!;return fetch(`${live.serverUrl}/api/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
  async function api<T>(path:string,body?:object):Promise<T>{const result=await request(path,body);assert.equal(result.status,200,await result.clone().text());return result.json();}
  async function upload(filename:string,data=bytes,uploadId=randomUUID()){
    const live=(await runtime(instance))!;return fetch(`${live.serverUrl}/api/attachments/${uploadId}`,{method:'PUT',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/octet-stream','x-image-filename':encodeURIComponent(filename)},body:new Uint8Array(data)});
  }
  // The attachment and its Run can be read on opposite sides of the completion commit.
  const captionDone=(asset:string)=>until(()=>images.get(asset),a=>!!a.summaryRun&&!['queued','running'].includes(a.summaryRun.status)&&(a.summaryRun.status!=='completed'||a.summary!==null));
  let attachment:AttachmentView,thread:string,first:RunView;
  try{
    await startInstance(ws,instance.id,{headless:true});
    await scenarioStep(t, 'images-snapshot',async()=>{
      const uploadId=randomUUID();const [a,b]=await Promise.all([images.upload(uploadId,'screenshot.png',bytes),images.upload(uploadId,'screenshot.png',bytes)]);
      attachment=a;assert.equal(a.id,b.id);assert.equal(a.summaryRun!.id,b.summaryRun!.id);assert.equal(a.summaryRun!.threadId,null);
      await assert.rejects(images.upload(uploadId,'different.png',bytes),/another image/);
      thread=randomUUID();await threads.createThread(thread,'Frozen image context');
      const key=randomUUID();first=await threads.submit(thread,key,'What shapes do you see?','normal',[a.id]);
      assert.equal((await threads.submit(thread,key,'What shapes do you see?','normal',[a.id])).id,first.id);
      assert.equal((await images.get(a.id)).expiresAt,null);
      const frozen=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:first.state.request_artifact_id}})).payload);
      assert.match(modelContentText(frozen.messages.at(-1)!.content),/Description unavailable/);
      images.dispatch(a.summaryRun!.id);const complete=await captionDone(a.id);assert.equal(complete.summaryRun!.status,'completed');assert.match(complete.summary!,/Deterministic test description/);
      threads.dispatch(first.id);await settle(thread,first.id);
      const retry=await threads.retry(first.id,randomUUID(),'normal');threads.dispatch(retry.id);await settle(thread,retry.id);
      const retried=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:retry.state.request_artifact_id}})).payload);assert.deepEqual(retried,frozen);
      const followup=await threads.submit(thread,randomUUID(),'Keep discussing the screenshot','empty');threads.dispatch(followup.id);await settle(thread,followup.id);
      const next=RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id:followup.state.request_artifact_id}})).payload);assert.ok(next.messages.some(m=>modelContentText(m.content).includes('Deterministic test description')));
      const inspection=await api<InspectionView>(`artifacts/${complete.summaryRun!.state.response_artifact_id}`);
      assert.deepEqual(inspection.artifacts.map(a=>a.payload.type),['image_upload','model_request','image_description']);
      assert.ok(!JSON.stringify(inspection).includes('base64,'));
    });
    await scenarioStep(t, 'visibility-media-locks',async()=>{
      const attached=await images.upload(randomUUID(),'visibility-lock.png',bytes),threadId=randomUUID();
      await threads.createThread(threadId,'Description lock ordering');const run=await threads.submit(threadId,randomUUID(),'Use this saved image','empty',[attached.id]);
      const before=(await threads.readThread(threadId)).thread.lifecycle.activity;
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM threads WHERE id=${threadId}::uuid FOR UPDATE`;
        images.dispatch(attached.summaryRun!.id);
        await until(()=>db.$queryRaw<{blocked:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%record_thread_activity%') AS blocked`,rows=>rows[0].blocked,3000);
        // A concurrent submission already holds Thread and next retains its Attachment.
        // Description completion must not hold the Attachment while waiting for that Thread.
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1s'");
        await tx.$queryRaw`SELECT id FROM attachments WHERE id=${attached.id}::uuid FOR UPDATE`;
      },{timeout:5000});
      await captionDone(attached.id);assert.ok((await threads.readThread(threadId)).thread.lifecycle.activity>before);await threads.cancel(run.id);
    });
    await scenarioStep(t, 'images-boundaries' ,async()=>{
      const count=await db.attachment.count();
      assert.equal((await upload('fake.png',Buffer.from('<svg>not a PNG</svg>'))).status,400);
      assert.equal((await upload('too-large.png',Buffer.alloc(10*1024*1024+1))).status,413);
      assert.equal(await db.attachment.count(),count);
      const denied=await request(`threads/${thread}/messages`,{requestKey:randomUUID(),text:'No foreign images',attachmentIds:[randomUUID()]});assert.equal(denied.status,409);
      const duplicate=await request(`threads/${thread}/messages`,{requestKey:randomUUID(),text:'No duplicates',attachmentIds:[attachment.id,attachment.id]});assert.equal(duplicate.status,400);
      const foreign=await createInstance(ws,'test','empty');
      const foreignConfig=ServerConfig.parse(await json(join(foreign.root,'server.json'))),foreignDb=connectProduct(foreignConfig.databaseUrl);
      try{const other=new Threads(foreignDb);const id=randomUUID();await other.createThread(id,'Other instance');await assert.rejects(other.submit(id,randomUUID(),'Foreign image','normal',[attachment.id]),/unavailable/);}finally{await foreignDb.$disconnect();await disposeInstance(ws,foreign.id);}
      const asset=await images.upload(randomUUID(),'corrupt.png',bytes);assert.ok('model' in asset.metadata);images.dispatch(asset.summaryRun!.id);await captionDone(asset.id);
      await writeFile(join(storage.root,asset.id,asset.metadata.model.hash),Buffer.alloc(asset.metadata.model.sizeBytes));
      const run=await threads.submit(thread,randomUUID(),'Broken bytes','normal',[asset.id]);threads.dispatch(run.id);
      const failed=await settle(thread,run.id);assert.equal(failed.runs.find(r=>r.id===run.id)!.status,'failed');
    });
    await scenarioStep(t, 'images-description-retry',async()=>{
      let fail=true,calls=0;
      const captioner=new Attachments(db,storage,{...deterministicModel,async *stream(request,signal){calls++;if(fail)throw new ModelFailure('fixture_failure','Synthetic description failure');yield* deterministicModel.stream(request,signal);}});
      try{
        const asset=await captioner.upload(randomUUID(),'retry-description.png',bytes);
        const failed=await until(()=>captioner.get(asset.id),a=>a.summaryRun?.status==='failed');assert.equal(calls,1);
        fail=false;const key=randomUUID();const retry=await captioner.retry(asset.id,key,failed.summaryRun!.id);
        assert.equal((await captioner.retry(asset.id,key,failed.summaryRun!.id)).summaryRun!.id,retry.summaryRun!.id);
        await until(()=>captioner.get(asset.id),a=>a.summaryRun?.status==='completed');assert.equal(calls,2);
        assert.equal(await db.artifact.count({where:{sourceId:asset.inputArtifactId,layer:'surface'}}),0);
      }finally{await captioner.stop();}
      const queued=await images.upload(randomUUID(),'restart.png',bytes);assert.equal(queued.summaryRun!.status,'queued');
      await stopInstance(ws,instance.id);await startInstance(ws,instance.id,{headless:true});
      const recovered=await images.get(queued.id);assert.equal(recovered.summaryRun!.status,'interrupted');assert.equal(recovered.summary,null);
      await sleep(150);assert.equal((await images.get(queued.id)).summaryRun!.status,'interrupted');
    });
    await scenarioStep(t, 'images-cleanup',async()=>{
      const orphan=await images.upload(randomUUID(),'orphan.png',bytes);images.dispatch(orphan.summaryRun!.id);await captionDone(orphan.id);
      await db.attachment.update({where:{id:orphan.id},data:{expiresAt:new Date(Date.now()-1)}});await images.cleanup();
      assert.equal(await db.attachment.findUnique({where:{id:orphan.id}}),null);await assert.rejects(access(join(storage.root,orphan.id)));
      assert.equal(await db.artifact.findUnique({where:{id:orphan.inputArtifactId}}),null);
      assert.ok(await storage.read(attachment.id,attachment.metadata.original));
      // Re-delivery of an expired upload ID cannot replace files during deletion.
      const retiring=await images.upload(randomUUID(),'retiring.png',bytes);images.dispatch(retiring.summaryRun!.id);await captionDone(retiring.id);
      await db.attachment.update({where:{id:retiring.id},data:{expiresAt:new Date(Date.now()-1)}});
      let release!:()=>void,removing!:()=>void,held=false;
      const removalGate=new Promise<void>(resolve=>release=resolve),startedRemoval=new Promise<void>(resolve=>removing=resolve);
      const remove=storage.remove.bind(storage);
      storage.remove=async id=>{if(id===retiring.id&&!held){held=true;removing();await removalGate;}await remove(id);};
      const cleanup=images.cleanup();
      try{await startedRemoval;await assert.rejects(images.upload(retiring.id,'retiring.png',bytes),/expired/);}
      finally{release();await cleanup;storage.remove=remove;}
      const replacement=await images.upload(retiring.id,'retiring.png',bytes);assert.ok(await storage.read(replacement.id,replacement.metadata.original));
      const race=await images.upload(randomUUID(),'race.png',bytes);images.dispatch(race.summaryRun!.id);await captionDone(race.id);
      const [submission]=await Promise.allSettled([threads.submit(thread,randomUUID(),'Retain despite cleanup','empty',[race.id]),images.cleanup(new Date(Date.now()+25*60*60*1000))]);
      if(submission.status==='fulfilled'){assert.equal((await images.get(race.id)).expiresAt,null);assert.ok(await storage.read(race.id,race.metadata.original));threads.dispatch(submission.value.id);await settle(thread,submission.value.id);}
      else assert.match(String(submission.reason),/expired or is unavailable/);
    });
    await scenarioStep(t, 'images-desktop',async()=>{
      const live=(await runtime(instance))!,entry=await buildMain(instance.checkout,join(instance.root,'build')),path=join(instance.root,'images-test-client.json');
      await atomic(path,{root:instance.root,label:instance.label,instanceId:instance.id,url:live.webUrl,windowed:true,background:true});
      const require=createRequire(join(instance.checkout,'package.json'));
      const launch=()=>_electron.launch({executablePath:require('electron'),args:[entry],cwd:instance.checkout,env:{...childEnvironment(join(instance.root,'tmp')),ASH_CLIENT_CONFIG:path} as Record<string,string>,timeout:30000});
      app=await launch();let page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
      await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
      await page.getByRole('button',{name:'New Thread',exact:true}).first().click();
      await page.getByRole('button',{name:'Actions for Untitled',exact:true}).first().click();assert.equal(await page.getByRole('menuitem').count(),6);for(const name of ['Topics','Instructions','Rename'])await page.getByRole('menuitem',{name,exact:true}).waitFor();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
      await page.getByLabel('Thread title').fill('Image workspace');await page.getByRole('button',{name:'Save title',exact:true}).click();
      await page.getByRole('heading',{name:'Image workspace',exact:true}).waitFor();
      const uploads=[{name:'screenshot.png',mimeType:'image/png',buffer:bytes},{name:'portrait.jpg',mimeType:'image/jpeg',buffer:await orientedFixture()},{name:'second.png',mimeType:'image/png',buffer:await screenshotFixture('SECOND IMAGE')}];
      await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles(uploads);
      await until(()=>page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),v=>v);
      await page.getByLabel('Message',{exact:true}).fill('Look at these screenshots.');
      await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
      assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),false);await page.getByRole('button',{name:'Remove invalid.svg',exact:true}).click();
      await page.getByRole('button',{name:'Preview portrait.jpg',exact:true}).click();
      await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('button',{name:'Use again',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Inspect image',exact:true}).count(),0);await page.getByRole('dialog').press('ArrowRight');assert.match(await page.getByRole('dialog').innerText(),/second.png/);await page.getByRole('dialog').press('ArrowLeft');
      const savePath=join(instance.root,'tmp','saved-image.jpg');
      // Exercise IPC, decode and filesystem behavior without changing the user's clipboard or opening a save prompt.
      await app.evaluate(({clipboard,dialog},savePath)=>{(globalThis as any).__imageCopy=null;clipboard.writeImage=(image)=>{(globalThis as any).__imageCopy=image.getSize();};clipboard.writeText=(text)=>{(globalThis as any).__textCopy=text;};dialog.showSaveDialog=(async()=>({canceled:false,filePath:savePath})) as typeof dialog.showSaveDialog;},savePath);
      await page.getByRole('button',{name:'Copy image',exact:true}).click();await page.getByText('Image copied',{exact:true}).waitFor();
      assert.deepEqual(await app.evaluate(()=>(globalThis as any).__imageCopy),{width:80,height:120});
      await page.getByRole('button',{name:'Save image',exact:true}).click();await page.getByText('Image saved',{exact:true}).waitFor();assert.deepEqual(await readFile(savePath),uploads[1].buffer);
      await page.screenshot({path:join(evidence,'images-viewer.png')});await page.getByRole('dialog').press('Escape');
      await page.getByRole('button',{name:'Send message',exact:true}).click();await until(()=>page.getByTestId('run-status').filter({hasText:'completed'}).count(),n=>n===1);
      assert.equal(await page.getByTestId('draft-image').count(),0);assert.equal(await page.locator('.gallery.accordion').count(),1);
      // Hover/focus descriptions must not contribute intrinsic width or shift the accordion.
      const bubble=page.getByRole('article',{name:'User message',exact:true});
      await page.getByLabel('Message',{exact:true}).hover();
      const geometry=()=>bubble.evaluate(el=>[el,el.querySelector('.gallery')!].map(node=>{const r=node.getBoundingClientRect();return {left:r.left,width:r.width};}));
      const beforeHover=await geometry();
      await page.getByRole('button',{name:'Open screenshot.png',exact:true}).hover();
      await until(()=>bubble.locator('.description').evaluate(el=>getComputedStyle(el).opacity),value=>value==='1');
      assert.deepEqual(await geometry(),beforeHover);
      await page.getByRole('button',{name:'Open portrait.jpg',exact:true}).focus();
      assert.deepEqual(await geometry(),beforeHover);
      const copyText=bubble.getByRole('button',{name:'Copy text',exact:true});await page.getByRole('button',{name:'Open second.png',exact:true}).press('Tab');
      assert.equal(await copyText.evaluate(el=>el===document.activeElement),true);
      assert.equal(await copyText.evaluate(el=>getComputedStyle(el,'::after').visibility),'visible');
      assert.equal(await copyText.evaluate(el=>getComputedStyle(el,'::after').content),'"Copy text"');
      await page.getByRole('button',{name:'Inspect Ash response',exact:true}).click();await page.getByRole('heading',{name:'Captured model request',exact:true}).waitFor();
      assert.equal(await page.locator('.captured-image').count(),3);
      await page.getByRole('button',{name:'Copy text-only context',exact:true}).click();
      assert.match(await app.evaluate(()=>(globalThis as any).__textCopy),/attachmentId:/);
      await page.screenshot({path:join(evidence,'images-inspection.png')});await page.getByRole('button',{name:'Close inspector',exact:true}).click();
      await page.getByRole('button',{name:'Open screenshot.png',exact:true}).click({button:'right'});
      await page.getByRole('menuitem',{name:'Copy description',exact:true}).click();await page.getByText('Description copied',{exact:true}).waitFor();
      assert.match(await app.evaluate(()=>(globalThis as any).__textCopy),/Deterministic test description/);
      await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles(uploads[0]);await until(()=>page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),v=>v);assert.equal(await page.getByTestId('draft-image').count(),1);
      assert.equal(await page.getByLabel('Message',{exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.getByLabel('Message',{exact:true}).fill('Saved image draft');
      await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
      assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Saved image draft');assert.equal(await page.getByTestId('draft-image').count(),1);
      await page.getByRole('button',{name:'Remove screenshot.png',exact:true}).click();
      // A recoverable upload error keeps both the file and text draft.
      let failUpload=true;
      await page.route('**/api/attachments/*',async route=>{if(route.request().method()==='PUT'&&failUpload){failUpload=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic upload interruption'})});}else await route.continue();});
      await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles({name:'retry.png',mimeType:'image/png',buffer:bytes});
      await page.getByRole('button',{name:'Retry upload',exact:true}).click();
      await until(()=>page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),v=>v);
      assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Saved image draft');
      await page.getByRole('button',{name:'Remove retry.png',exact:true}).click();await page.unroute('**/api/attachments/*');
      // Late upload callbacks belong to the originating draft and cannot resurrect removals.
      for(const remove of [false,true]) {
        let release!:()=>void,arrived!:()=>void;
        const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>arrived=resolve);
        await page.route('**/api/attachments/*',async route=>{if(route.request().method()==='PUT'){arrived();await gate;}await route.continue().catch(()=>{});});
        const filename=remove?'removed.png':'other-thread.png';
        await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles({name:filename,mimeType:'image/png',buffer:bytes});await started;
        if(remove)await page.getByRole('button',{name:`Remove ${filename}`,exact:true}).click();
        await page.getByRole('button',{name:'Frozen image context',exact:true}).click();release();
        await page.getByRole('heading',{name:'Frozen image context',exact:true}).waitFor();assert.equal(await page.getByTestId('draft-image').count(),0);
        await page.getByRole('button',{name:'Image workspace',exact:true}).click();await page.getByRole('heading',{name:'Image workspace',exact:true}).waitFor();
        if(!remove){await until(()=>page.getByRole('button',{name:`Preview ${filename}`,exact:true}).isEnabled(),v=>v);await page.getByRole('button',{name:`Remove ${filename}`,exact:true}).click();}
        assert.equal(await page.getByTestId('draft-image').count(),0);await page.unroute('**/api/attachments/*');
      }
      await page.evaluate(encoded=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'pasted.png',{type:'image/png'}));document.querySelector('textarea')!.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},bytes.toString('base64'));
      await page.getByRole('button',{name:'Preview pasted.png',exact:true}).waitFor();await until(()=>page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),v=>v);
      await page.evaluate(encoded=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'dropped.png',{type:'image/png'}));for(const type of ['dragenter','dragover','drop'])document.querySelector('.main-column')!.dispatchEvent(new DragEvent(type,{dataTransfer:data,bubbles:true,cancelable:true}));},bytes.toString('base64'));
      await page.getByRole('button',{name:'Preview dropped.png',exact:true}).waitFor();await until(()=>page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),v=>v);assert.equal(await page.locator('.drop-overlay').count(),0);
      await page.getByLabel('Message',{exact:true}).fill('');await page.getByRole('button',{name:'Send message',exact:true}).click();
      await until(()=>page.getByTestId('run-status').filter({hasText:'completed'}).count(),n=>n===2);
      assert.equal(await page.getByTestId('draft-image').count(),0);
      const current=(await api<Array<{id:string;title:string}>>('threads')).find(t=>t.title==='Image workspace')!;
      const markdown=new Threads(db,{...deterministicModel,async *stream(){yield '## Image notes\n\n- A yellow rectangle\n- A blue circle\n\n```ts\nconst ready = true;\n```\n\n<script>window.imageUnsafe = true</script>\n\n![Remote](https://example.com/tracker.png)';}},true,storage);
      try{const run=await markdown.submit(current.id,randomUUID(),'Format the notes','normal');await settle(current.id,run.id);}finally{await markdown.stop();}
      await page.getByRole('heading',{name:'Image notes',exact:true}).waitFor();assert.equal(await page.locator('img[src^="https:"]').count(),0);assert.equal(await page.evaluate(()=>(window as any).imageUnsafe),undefined);
      await app.evaluate(({clipboard})=>{clipboard.writeText=(text)=>{(globalThis as any).__textCopy=text;};});
      await page.getByRole('button',{name:'Copy code',exact:true}).click();await page.getByText('Code copied',{exact:true}).waitFor();
      assert.equal(await app.evaluate(()=>(globalThis as any).__textCopy),'const ready = true;');
      await page.screenshot({path:join(evidence,'images-chat.png')});assert.deepEqual(errors,[]);
      let continueStream!:()=>void;const streamGate=new Promise<void>(resolve=>continueStream=resolve);
      const streaming=new Threads(db,{...deterministicModel,async *stream(){yield '## Reading position\n\n'+('A long paragraph for the scroll fixture.\n\n'.repeat(45));await streamGate;yield '\nMore text arrived while you were reading.';}},true,storage);
      try {
        const run=await streaming.submit(current.id,randomUUID(),'Continue while I read above','normal');
        await page.getByRole('heading',{name:'Reading position',exact:true}).waitFor();
        // Express user intent before positioning; a queued automatic layout may still own this frame.
        await page.locator('.transcript').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true}));el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
        await page.getByRole('button',{name:'↓ Latest messages',exact:true}).waitFor();continueStream();await settle(current.id,run.id);
        await page.getByText('More text arrived while you were reading.',{exact:true}).waitFor({state:'attached'});
        assert.ok(await page.locator('.transcript').evaluate(el=>el.scrollTop<3));
        await page.getByRole('button',{name:'↓ Latest messages',exact:true}).click();
        assert.ok(await page.locator('.transcript').evaluate(el=>{const last=el.querySelector('.messages')!.lastElementChild!;const gap=el.getBoundingClientRect().bottom-last.getBoundingClientRect().bottom;return Math.abs(gap-el.clientHeight*.2)<3;}));
      }finally{continueStream();await streaming.stop();}
      // More than both former count caps survives composition, request capture and reload.
      await page.getByRole('button',{name:'New Thread',exact:true}).click();
      await page.getByRole('heading',{name:'Untitled',exact:true}).waitFor();
      await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles(Array.from({length:9},(_,i)=>({name:`batch-${i+1}.png`,mimeType:'image/png',buffer:bytes})));
      await until(()=>page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),v=>v);
      assert.equal(await page.getByTestId('draft-image').count(),9);
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await until(()=>page.getByTestId('run-status').filter({hasText:'completed'}).count(),n=>n===1);
      assert.equal(await page.locator('.gallery .tile').count(),9);
      assert.ok(await page.locator('.gallery').evaluate(el=>el.scrollWidth>el.clientWidth));
      await page.setViewportSize({width:740,height:650});
      assert.ok(await page.locator('.messages').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.getByRole('button',{name:'Inspect Ash response',exact:true}).click();
      await page.getByRole('heading',{name:'Captured model request',exact:true}).waitFor();assert.equal(await page.locator('.captured-image').count(),9);
      await page.getByRole('button',{name:'Close inspector',exact:true}).click();
      await page.reload();await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
      await until(()=>page.locator('.gallery .tile').count(),n=>n===9);
      await page.screenshot({path:join(evidence,'images-many.png')});
      await app.close();app=undefined;
      const before=await api<ThreadDetail>(`threads/${current.id}`);await stopInstance(ws,instance.id);await startInstance(ws,instance.id,{headless:true});assert.deepEqual(await api<ThreadDetail>(`threads/${current.id}`),{...before,thread:{...before.thread,lifecycle:{...before.thread.lifecycle!,namedCount:before.thread.lifecycle!.messages,pendingAt:null,kind:before.thread.lifecycle!.kind==='pending'?'failed':before.thread.lifecycle!.kind}}});
    });
  }finally{
    await app?.close();await threads.stop().catch(()=>{});await images.stop().catch(()=>{});await db.$disconnect();await disposeInstance(ws,instance.id);
  }
});
