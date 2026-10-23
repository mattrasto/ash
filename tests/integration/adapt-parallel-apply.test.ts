import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,type Browser,type Page} from 'playwright';
import {ServerConfig,type AdaptApplicationView} from '../../packages/shared/src/index.ts';
import {workspace,createInstance} from '../../scripts/dev/workspace.ts';
import {startInstance,disposeInstance,runtime} from '../../scripts/dev/lifecycle.ts';
import {devRoot,json,sleep} from '../../scripts/dev/io.ts';
import {readJob,readActive} from '../../scripts/dev/release-store.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Parallel changes combine through the native application workflow',{timeout:300000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','scratchpad'),cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl);
  let browser:Browser|undefined,page:Page,combined=false;
  const until=async<T>(read:()=>Promise<T>,ready:(v:T)=>boolean,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await read();if(ready(v))return v;await sleep(200);}throw Error('Parallel native workflow timed out.');};
  const attach=async()=>{browser=await chromium.connectOverCDP('http://127.0.0.1:'+(await runtime(instance))!.debuggingPort);page=browser.contexts()[0].pages()[0];await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor({timeout:15000});await page.emulateMedia({reducedMotion:'reduce'});};
  const api=async<T>(path:string):Promise<T>=>{const state=(await runtime(instance))!,response=await fetch(state.serverUrl+'/api/'+path,{headers:{authorization:'Bearer '+cfg.token}});assert.equal(response.status,200);return response.json();};
  const state=async(id:string)=>(await api<{workspace:{application:AdaptApplicationView}}>('threads/'+id)).workspace.application;
  const create=async(text:string)=>{await page.getByRole('button',{name:'New Thread',exact:true}).click();const editor=page.getByRole('textbox',{name:'Message',exact:true});await editor.fill(text);await editor.press('Enter');await until(()=>page.getByRole('button',{name:'Adapt',exact:true}).getAttribute('aria-pressed'),v=>v==='true');const id=await page.evaluate(()=>localStorage.getItem('ash-chat-selected')!);await until(()=>db.adaptWorkspace.findUnique({where:{threadId:id}}),w=>!!w?.checkpoint);await until(()=>page.getByRole('button',{name:'Apply…',exact:true}).isEnabled(),v=>v);return id;};
  const select=async(id:string)=>{const row=await db.thread.findUniqueOrThrow({where:{id}});await page.getByRole('button',{name:row.title,exact:true}).click();await page.getByRole('button',{name:'Apply…',exact:true}).click();};
  const panel=()=>page.getByRole('region',{name:'Apply changes',exact:true});
  const apply=async(id:string)=>{await panel().getByRole('button',{name:/^Prepare (another )?update$/}).click();const pending=await until(()=>state(id),v=>{if(['failed','stale'].includes(v.phase))throw Error(v.message);return v.phase==='awaiting_approval';});const closed=page.waitForEvent('close');await panel().getByRole('button',{name:'Apply and restart',exact:true}).click();await closed;await until(()=>readJob(instance,pending.candidateId!),job=>{if(['failed','stale','rolled_back'].includes(job.phase))throw Error(job.message);return job.phase==='applied';});await attach();};
  const restore=async(id:string)=>{await panel().getByRole('button',{name:'Restore previous version…',exact:true}).click();const pending=await until(()=>state(id),v=>{if(['failed','stale'].includes(v.phase))throw Error(v.message);return v.phase==='awaiting_approval';});const closed=page.waitForEvent('close');await panel().getByRole('button',{name:'Restore and restart',exact:true}).click();await closed;await until(()=>readJob(instance,pending.candidateId!),job=>{if(['failed','stale','rolled_back'].includes(job.phase))throw Error(job.message);return job.phase==='restored';});await attach();};
  try{
    await startInstance(ws,instance.id,{background:true,windowed:true,debugging:true});await attach();
    const a=await create('Change Ash using a renderer fixture.'),b=await create('Change Ash using a placeholder fixture.'),c=await create('Change Ash using a conflicting renderer fixture.');
    await scenarioStep(t,'adapt-parallel-apply',async()=>{
      await select(a);await apply(a);const aVersion=(await readActive(instance))!.current;
      await select(b);await until(()=>state(b),v=>!!v.needsRefresh);await panel().getByRole('button',{name:'Prepare update',exact:true}).isDisabled().then(value=>assert.equal(value,true));
      await panel().getByRole('button',{name:'Refresh Workspace',exact:true}).click();await until(()=>state(b),v=>!v.needsRefresh&&!v.conflicts?.length);await apply(b);
      assert.notEqual((await readActive(instance))!.current,aVersion);await page.getByRole('button',{name:'New Thread',exact:true}).click();await page.getByRole('heading',{name:'Adapt renderer fixture.',exact:true}).waitFor();assert.match(await page.locator('.brand').innerText(),/PARALLEL/);combined=true;
    });
    if(!combined)return;
    await scenarioStep(t,'adapt-parallel-conflict-apply',async()=>{
      await select(c);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Retain this feedback draft.');await panel().getByRole('button',{name:'Refresh Workspace',exact:true}).click();await until(()=>state(c),v=>!!v.conflicts?.length);
      await panel().getByText('Merge conflicts',{exact:true}).waitFor();await until(()=>panel().getByRole('button',{name:'Resolve conflicts…',exact:true}).isEnabled(),v=>v);assert.equal(await panel().getByRole('button',{name:'Prepare update',exact:true}).isDisabled(),true);await page.setViewportSize({width:740,height:650});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir(join(ws.checkout,'out','adapt-parallel'),{recursive:true});await page.screenshot({path:join(ws.checkout,'out','adapt-parallel','conflicts.png')});
      await restore(c);assert.doesNotMatch(await page.locator('.brand').innerText(),/PARALLEL/);assert.ok((await state(c)).conflicts?.length);await select(c);await restore(c);assert.match(await page.locator('.brand').innerText(),/PARALLEL/);assert.ok((await state(c)).conflicts?.length);await select(c);
      await panel().getByRole('button',{name:'Resolve conflicts…',exact:true}).click();const editor=page.getByRole('textbox',{name:'Message',exact:true});const draft=await editor.inputValue();assert.match(draft,/Retain this feedback draft/);assert.match(draft,/Resolve the merge conflicts/);
      await editor.fill(draft+'\nResolve merge fixture.');await editor.press('Enter');await until(()=>state(c),v=>!v.conflicts?.length);await until(()=>page.getByRole('button',{name:'Apply…',exact:true}).isEnabled(),v=>v);await page.setViewportSize({width:1040,height:830});await page.getByRole('button',{name:'Apply…',exact:true}).click();await apply(c);
      await page.getByRole('button',{name:'New Thread',exact:true}).click();await page.getByRole('heading',{name:'Resolved renderer fixture.',exact:true}).waitFor();assert.match(await page.locator('.brand').innerText(),/PARALLEL/);
    });
  }finally{await browser?.close().catch(()=>{});await db.$disconnect();await disposeInstance(ws,instance.id);}
});
