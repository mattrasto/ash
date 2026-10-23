import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,type Browser,type Page} from 'playwright';
import {ServerConfig,type AdaptApplicationView} from '../../packages/shared/src/index.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {startInstance,stopInstance,disposeInstance,runtime} from '../../scripts/dev/lifecycle.ts';
import {devRoot,json,atomic,exec,sleep} from '../../scripts/dev/io.ts';
import {readActive,readJob,versionRoot,releaseRoot} from '../../scripts/dev/release-store.ts';
import {RendererReleaseHost} from '../../scripts/dev/renderer-release-host.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {Decisions} from '../../packages/server/src/modules/decisions/service.ts';
import {AdaptApplications} from '../../packages/server/src/modules/adapt/applications.ts';
import {localApplication} from '../../packages/server/src/platform/adapt/local-application.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Verified local UI application, restart and recovery',{timeout:360000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','scratchpad');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl),decisions=new Decisions(db),applications=new AdaptApplications(db,decisions,localApplication(instance));
  let browser:Browser|undefined,page:Page,originalThread='',newThread='',candidate='',baseline='',updated='';
  const until=async<T>(get:()=>Promise<T>,ready:(v:T)=>boolean,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await get();if(ready(value))return value;await sleep(200);}throw Error('Local application timed out.');};
  const attach=async()=>{const running=(await runtime(instance))!;assert.ok(running.debuggingPort);browser=await chromium.connectOverCDP('http://127.0.0.1:'+running.debuggingPort);page=browser.contexts()[0].pages()[0];await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor({timeout:15000});await page.emulateMedia({reducedMotion:'reduce'});};
  const view=()=>applications.view(originalThread);
  const ready=async()=>until(async()=>{await applications.pump();const v=await view();if(['failed','stale'].includes(v.phase))throw Error(v.message);return v;},v=>v.phase==='awaiting_approval');
  const prepareRestore=async()=>{await applications.pump();const workspace=await db.adaptWorkspace.findUniqueOrThrow({where:{threadId:originalThread}});await applications.prepare(originalThread,{submissionId:randomUUID(),checkpointId:(workspace.checkpoint as {id:string}).id,action:'restore'});return ready();};
  const approve=async(v:AdaptApplicationView)=>decisions.answer(v.decisionId!,{submissionId:randomUUID(),value:'approve'});
  try{
    await scenarioStep(t,'adapt-local-apply',async()=>{
      await startInstance(ws,instance.id,{background:true,windowed:true,debugging:true});await attach();
      await page.getByRole('button',{name:'Adapt',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Make a renderer fixture change.');await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');
      await page.getByRole('button',{name:'Changes',exact:true}).waitFor();await until(()=>db.adaptWorkspace.findFirst(),v=>!!v?.checkpoint);
      originalThread=(await db.adaptWorkspace.findFirstOrThrow()).threadId;
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this feedback draft across Apply.');
      await page.getByRole('button',{name:'Apply…',exact:true}).click();await page.getByRole('button',{name:'Prepare update',exact:true}).click();
      const pending=await ready();candidate=pending.candidateId!;assert.equal(await readActive(instance),null,'Verification must not install before approval.');
      const inspection=page.getByRole('region',{name:'Apply changes',exact:true});await inspection.getByRole('button',{name:'Apply and restart',exact:true}).waitFor({timeout:10000});
      await mkdir(join(ws.checkout,'out','adapt-apply'),{recursive:true});await page.screenshot({path:join(ws.checkout,'out','adapt-apply','approval.png')});
      await page.setViewportSize({width:740,height:650});await inspection.getByRole('button',{name:'Apply and restart',exact:true}).scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(ws.checkout,'out','adapt-apply','approval-narrow.png')});await page.setViewportSize({width:1040,height:830});
      const closed=page.waitForEvent('close');await inspection.getByRole('button',{name:'Apply and restart',exact:true}).click();await closed;
      await until(()=>readJob(instance,candidate),job=>{if(['failed','rolled_back','stale'].includes(job.phase))throw Error(job.message);return job.phase==='applied';});
      await attach();await until(()=>page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),v=>v==='Keep this feedback draft across Apply.');
      const active=(await readActive(instance))!;updated=active.current;baseline=active.previous!;assert.equal(active.confirmed,true);
      await page.getByRole('button',{name:'New Thread',exact:true}).click();await page.getByRole('heading',{name:'Adapt renderer fixture.',exact:true}).waitFor();
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('A chat created after the update.');await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await page.getByRole('article',{name:'Ash response',exact:true}).waitFor();
      newThread=await page.evaluate(()=>localStorage.getItem('ash-chat-selected')!);await page.getByRole('textbox',{name:'Message',exact:true}).fill('A later unsent draft.');
    });
    if(!updated)return;
    await scenarioStep(t,'adapt-local-restore',async()=>{
      const title=(await db.thread.findUniqueOrThrow({where:{id:originalThread}})).title;await page.getByRole('button',{name:title,exact:true}).click();
      await page.getByRole('button',{name:'Apply…',exact:true}).click();await page.getByRole('button',{name:'Restore previous version…',exact:true}).click();const pending=await ready();
      const panel=page.getByRole('region',{name:'Apply changes',exact:true});await panel.getByRole('button',{name:'Restore and restart',exact:true}).waitFor();const closed=page.waitForEvent('close');await panel.getByRole('button',{name:'Restore and restart',exact:true}).click();await closed;
      await until(()=>readJob(instance,pending.candidateId!),job=>{if(['failed','rolled_back','stale'].includes(job.phase))throw Error(job.message);return job.phase==='restored';});await attach();
      assert.equal((await readActive(instance))!.current,baseline);
      const title2=(await db.thread.findUniqueOrThrow({where:{id:newThread}})).title;await page.getByRole('button',{name:title2,exact:true}).click();await until(()=>page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),v=>v==='A later unsent draft.');
      await page.getByRole('article',{name:'User message',exact:true}).filter({hasText:'A chat created after the update.'}).waitFor();
      await page.getByRole('button',{name:'New Thread',exact:true}).click();await page.getByRole('heading',{name:'What’s on your mind?',exact:true}).waitFor();
      await stopInstance(ws,instance.id);browser=undefined;
    });
    await scenarioStep(t,'adapt-local-startup-recovery',async()=>{
      const pending=await prepareRestore();await approve(pending);let starts=0;
      const host=new RendererReleaseHost(instance,async()=>{if(++starts===1)throw Error('Injected startup failure.');});await host.initialize();await host.install(pending.candidateId!,pending.decisionId!);
      assert.equal((await readJob(instance,pending.candidateId!)).phase,'rolled_back');assert.equal((await readActive(instance))!.current,baseline);assert.equal(starts,2);
      assert.ok(await db.thread.findUnique({where:{id:newThread}}));await applications.pump();
    });
    await scenarioStep(t,'adapt-local-approval-drift',async()=>{
      const pending=await prepareRestore();await approve(pending);
      await atomic(join(releaseRoot(instance),'active.json'),{current:updated,previous:baseline,confirmed:true,message:'Another installed version.'});
      let effects=0;const host=new RendererReleaseHost(instance,async()=>{effects++;});await host.initialize();await host.install(pending.candidateId!,pending.decisionId!);
      assert.equal(effects,0);assert.equal((await readJob(instance,pending.candidateId!)).phase,'stale');assert.equal((await readActive(instance))!.current,updated);await applications.pump();
      const changed=await prepareRestore();await approve(changed);const version=(await readJob(instance,changed.candidateId!)).evidence!.versionId,file=join(versionRoot(instance,version),'build','renderer','index.html'),bytes=await readFile(file);
      try{await writeFile(file,Buffer.concat([bytes,Buffer.from('\n<!-- changed after verification -->')]));await host.install(changed.candidateId!,changed.decisionId!);assert.equal(effects,0);assert.equal((await readJob(instance,changed.candidateId!)).phase,'stale');}finally{await writeFile(file,bytes);}await applications.pump();
    });
    await scenarioStep(t,'adapt-local-interrupted-apply',async()=>{
      const pending=await prepareRestore();await approve(pending);
      await assert.rejects(()=>exec(process.execPath,['--import','tsx',join(ws.checkout,'tests/helpers/apply-crash.ts'),join(instance.root,'instance.json'),pending.candidateId!,pending.decisionId!],{cwd:ws.checkout,timeout:20000}),error=>(error as {code:number}).code===78);
      assert.equal((await readActive(instance))!.confirmed,false);
      const recovered=new RendererReleaseHost(instance,async()=>{});await recovered.initialize();assert.equal((await readActive(instance))!.current,updated);assert.equal((await readActive(instance))!.confirmed,false);await recovered.confirmRecovery();assert.equal((await readJob(instance,pending.candidateId!)).phase,'rolled_back');
      assert.ok(await db.thread.findUnique({where:{id:newThread}}));
    });
  }finally{await browser?.close().catch(()=>{});await db.$disconnect();await disposeInstance(ws,instance.id);}
});
