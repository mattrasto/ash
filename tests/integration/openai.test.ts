import { scenarioStep } from '../support/node-scenarios.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile, rm, readdir, readFile, writeFile, mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron, type ElectronApplication } from 'playwright';
import { ServerConfig, type ThreadDetail, type RunView, type RequestPayload, type InspectionView } from '../../packages/shared/src/index.ts';
import { devRoot, json, id, atomic, childEnvironment, sleep, exec } from '../../scripts/dev/io.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, disposeInstance, resetInstance, runtime } from '../../scripts/dev/lifecycle.ts';
import { buildMain } from '../../scripts/dev/build.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { openAIModel } from '../../packages/server/src/platform/models/openai.ts';
import { createSession, readSession, sessionDirectory, openSession, type Session } from '../../packages/server/src/platform/models/session.ts';
import { sse, successEvents, providerResponse } from '../helpers/openai.ts';
import { makeWorktree } from '../helpers/worktree.ts';
import { configureLiveModel, DEFAULT_OPENAI_MODEL } from '../../scripts/dev/live-model.ts';

async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean):Promise<T> {
  for (let index=0;index<250;index++) {const value=await read();if(accept(value))return value;await sleep(40);}
  throw new Error('Timed out waiting for OpenAI test state');
}
test('OpenAI protocol through persisted Runs and desktop inspection (no external calls)',{timeout:180000},async t=>{
  const source=process.cwd();
  const base=await mkdtemp(join(tmpdir(),'ash-openai-'));
  const checkout=join(base,'checkout');
  t.after(async()=>{
    await exec('git',['worktree','remove','--force',checkout],{cwd:source});
    await rm(base,{recursive:true,force:true});
  });
  await makeWorktree(source,checkout);
  const envPath=join(checkout,'.env.local');
  const envContent='OPENAI_API_KEY=synthetic-private-key\n';
  // Only this disposable checkout receives the fake key. Never read or overwrite the developer's file.
  await writeFile(envPath,envContent,{mode:0o644});
  const ws=await workspace(checkout,await devRoot());
  const instance=await createInstance(ws,'test','empty');
  const evidence=process.env.ASH_TEST_EVIDENCE ?? join(ws.devRoot,'evidence',id());await mkdir(evidence,{recursive:true});
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json')));
  const db=connectProduct(cfg.databaseUrl);
  const session:Session={version:1,id:id(),workspaceId:ws.id,instanceId:instance.id,model:'test-openai-model',
    options:{api:'responses',store:false,maxOutputTokens:1024,timeoutMs:60000},maxCalls:4,callsUsed:0,expiresAt:new Date(Date.now()-1000).toISOString()};
  // The real backend uses an expired session: it must reject before any network dispatch.
  await createSession(instance,session);
  let app:ElectronApplication|undefined;
  let behavior:'success'|'fail'|'slow'='success';let calls=0;let transportAborted=false;
  const bodies:unknown[]=[];
  const model=openAIModel({apiKey:'synthetic-private-key',model:session.model,options:session.options,
    reserve:async()=>60000,info:async()=>({provider:'openai',model:session.model})},async(_input,init)=>{
    calls++;bodies.push(JSON.parse(init!.body as string));
    if (behavior==='fail') return sse([{type:'response.output_text.delta',delta:'Partial answer'},
      {type:'response.incomplete',response:providerResponse('Partial answer','incomplete')}]);
    if (behavior==='slow') return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type:'response.output_text.delta',delta:'Before stop'})}\n\n`));
        init!.signal!.addEventListener('abort',()=>{transportAborted=true;controller.error(new DOMException('aborted','AbortError'));},{once:true});
      },cancel(){transportAborted=true;},
    }),{headers:{'content-type':'text/event-stream'}});
    return sse(successEvents());
  });
  const service=new Threads(db,model);
  let target='';let lastRun:RunView;
  const settle=async(thread:string,run:string)=>until(()=>service.readThread(thread),v=>v.runs.some(r=>r.id===run && !['queued','running'].includes(r.status)));
  async function api<T>(path:string,body?:object):Promise<T> {
    const running=(await runtime(instance))!;
    const response=await fetch(`${running.serverUrl}/api/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.status,200,await response.clone().text());return response.json();
  }
  try {
    await scenarioStep(t, 'openai-credentials',async()=>{
      await startInstance(ws,instance.id,{headless:true});
      const info=await api<{model:{provider:string}}>('info');
      assert.equal(info.model.provider,'deterministic');
      const running=(await runtime(instance))!;
      const denied=await fetch(`${running.webUrl}/@fs${envPath}`);
      assert.equal(denied.status,403);
      assert.ok(!(await denied.text()).includes('synthetic-private-key'));
      await stopInstance(ws,instance.id);
      await chmod(envPath,0o600);
    });
    await startInstance(ws,instance.id,{headless:true,modelSessionId:session.id});
    assert.deepEqual(await readdir(sessionDirectory(instance,session.id)),['session.json']);
    await scenarioStep(t, 'openai-capture',async()=>{
      target=randomUUID();await service.createThread(target,'OpenAI protocol inspection');
      const key=randomUUID();
      const run=await service.submit(target,key,'A synthetic apartment checklist','normal');await settle(target,run.id);
      const duplicate=await service.submit(target,key,'A synthetic apartment checklist','normal');assert.equal(duplicate.id,run.id);assert.equal(calls,1);
      lastRun=await service.submit(target,randomUUID(),'Put the kitchen first','normal');const view=await settle(target,lastRun.id);
      const saved=view.runs.find(r=>r.id===lastRun.id)!;
      assert.equal(saved.status,'completed');assert.equal(saved.state.model!.requestId,'req_test');assert.equal(saved.state.model!.usage!.totalTokens,32);
      const inspection=await api<InspectionView>(`artifacts/${saved.state.response_artifact_id}`);
      const request=inspection.artifacts.find(a=>a.id===saved.state.request_artifact_id)!.payload as RequestPayload;
      assert.equal(request.provider,'openai');assert.deepEqual(request.messages.map(m=>m.role),['system','user','assistant','user']);
      assert.deepEqual((bodies.at(-1) as {input:unknown}).input,request.messages);
      assert.ok(!JSON.stringify(inspection).includes('synthetic-private-key'));
    });
    await scenarioStep(t, 'openai-outcomes',async()=>{
      behavior='fail';const failed=await service.submit(target,randomUUID(),'Stop at the output limit','normal');
      const first=await settle(target,failed.id);assert.equal(first.runs.find(r=>r.id===failed.id)!.status,'failed');
      assert.equal(first.runs.find(r=>r.id===failed.id)!.error!.code,'provider_incomplete');
      behavior='success';const retry=await service.retry(failed.id,randomUUID(),'normal');await settle(target,retry.id);
      const original=(await db.artifact.findUniqueOrThrow({where:{id:failed.state.request_artifact_id}})).payload;
      const retried=(await db.artifact.findUniqueOrThrow({where:{id:retry.state.request_artifact_id}})).payload;
      assert.deepEqual(original,retried);assert.equal(retry.retryOfId,failed.id);
      behavior='slow';const slow=await service.submit(target,randomUUID(),'Cancel in flight','normal');
      await until(()=>service.readThread(target),view=>view.artifacts.some(a=>a.runId===slow.id));
      await service.cancel(slow.id);const before=await service.readThread(target);await sleep(100);
      assert.deepEqual(await service.readThread(target),before);assert.equal(transportAborted,true);
      behavior='success';lastRun=await service.submit(target,randomUUID(),'Continue after cancellation','normal');await settle(target,lastRun.id);
      assert.ok(!(bodies.at(-1) as {input:Array<{content:string}>}).input.some(m=>m.content==='Before stop'));
    });
    await scenarioStep(t, 'openai-desktop',async()=>{
      const require=createRequire(join(instance.checkout,'package.json'));
      const running=(await runtime(instance))!;
      const entry=await buildMain(instance.checkout,join(instance.root,'build'));
      const path=join(instance.root,'openai-test-client.json');
      await atomic(path,{root:instance.root,label:instance.label,instanceId:instance.id,url:running.webUrl,windowed:true,background:true});
      app=await _electron.launch({executablePath:require('electron'),args:[entry],cwd:instance.checkout,env:{...childEnvironment(join(instance.root,'tmp')),ASH_CLIENT_CONFIG:path} as Record<string,string>,timeout:30000});
      const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
      await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
      assert.ok((await page.locator('.model-banner').innerText()).includes('test-openai-model'));
      assert.equal(await page.getByText('Test response settings',{exact:true}).count(),0);
      await page.getByRole('button',{name:'Inspect Ash response',exact:true}).last().click();
      await page.getByRole('heading',{name:'Provider result',exact:true}).waitFor();
      assert.ok((await page.getByLabel('Artifact inspector').innerText()).includes('24 input tokens'));
      await page.getByRole('heading',{name:'Provider result',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(evidence,'openai-inspection.png')});
      await page.getByRole('button',{name:'Close inspector'}).click();
      await page.getByLabel('Message',{exact:true}).fill('This expired session must not call OpenAI');
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByText('The live model session has expired. Start a new bounded session to continue.',{exact:true}).waitFor();
      assert.equal((await readSession(instance,session.id)).callsUsed,0);
      assert.deepEqual(errors,[]);assert.ok(!(await page.locator('body').innerText()).includes('synthetic-private-key'));
      await app.close();app=undefined;
    });
    await scenarioStep(t, 'openai-budget',async()=>{
      const before=await api<ThreadDetail>(`threads/${target}`);
      await stopInstance(ws,instance.id);await startInstance(ws,instance.id,{headless:true,modelSessionId:session.id});
      assert.deepEqual(await api<ThreadDetail>(`threads/${target}`),before);
      const info=await api<object>('info');assert.ok(!JSON.stringify(info).includes('synthetic-private-key'));
      const spent={...session,id:id(),expiresAt:new Date(Date.now()+60000).toISOString(),maxCalls:1};
      await createSession(instance,spent);
      try {
        await (await openSession(instance,spent.id)).reserve();
        await db.$disconnect();
        const fresh=await resetInstance(ws,instance.id,'empty');
        await assert.rejects((await openSession(fresh,spent.id)).reserve(),/call allowance/);
        assert.equal((await readSession(fresh,spent.id)).callsUsed,1);
        assert.equal(await readFile(envPath,'utf8'),envContent);
      } finally {await rm(sessionDirectory(instance,spent.id),{recursive:true,force:true});}
    });
    await scenarioStep(t, 'openai-interactive',async()=>{
      const preview=await createInstance(ws,'preview','empty');
      let interactive:string|undefined;
      const launch = async (...args:string[]) => JSON.parse((await exec(process.execPath,
        ['--import','tsx','scripts/dev/cli.ts','start','--headless','--detach','--json',...args],{cwd:checkout,timeout:60000})).stdout) as {modelSessionId?:string;supervisor:{pid:number}};
      try {
        await chmod(envPath,0o644);
        await assert.rejects(launch(),/chmod 600/);
        assert.equal(await runtime(preview),null,'Missing credentials never launch a fake preview');
        await chmod(envPath,0o600);
        const first=await launch();interactive=first.modelSessionId;assert.ok(interactive);
        assert.equal((await readSession(preview,interactive)).model,DEFAULT_OPENAI_MODEL);
        assert.deepEqual(await launch(),first,'Run Preview reuses the running session');
        await assert.rejects(launch('--deterministic'),/Stop the running instance/);
        const allowance=await openSession(preview,interactive);
        await allowance.reserve();
        await stopInstance(ws,preview.id);
        assert.equal((await launch()).modelSessionId,interactive);
        assert.equal((await readSession(preview,interactive)).callsUsed,1,'Stop/Run retains usage');
        await assert.rejects(configureLiveModel(preview,{deterministic:true,'live-calls':'1'}),/cannot be combined/);
        const disposable=await createInstance(ws,'verify','empty');
        let bounded:string|undefined;
        try {
          await assert.rejects(configureLiveModel(disposable,{}),/require --live-calls and --live-minutes/);
          bounded=await configureLiveModel(disposable,{'live-calls':'1','live-minutes':'1'});
          await (await openSession(disposable,bounded!)).reserve();
          assert.equal(await configureLiveModel(disposable,{},bounded),bounded);
          await assert.rejects((await openSession(disposable,bounded!)).reserve(),/call allowance/);
        } finally {
          await disposeInstance(ws,disposable.id);
          if(bounded)await rm(sessionDirectory(disposable,bounded),{recursive:true,force:true});
        }
        const running=(await runtime(preview))!;
        const config=ServerConfig.parse(await json(join(preview.root,'server.json')));
        const response=await fetch(`${running.serverUrl}/api/info`,{headers:{authorization:`Bearer ${config.token}`}});
        assert.equal(response.status,200);
        const info=await response.json() as {model:{session:{callsUsed:number;maxCalls:null;expiresAt:null}}};
        assert.equal(info.model.session.maxCalls,null);assert.equal(info.model.session.expiresAt,null);
        const require=createRequire(join(preview.checkout,'package.json'));
        const entry=await buildMain(preview.checkout,join(preview.root,'build'));
        const path=join(preview.root,'interactive-test-client.json');
        await atomic(path,{root:preview.root,label:preview.label,instanceId:preview.id,url:running.webUrl,windowed:true,background:true});
        app=await _electron.launch({executablePath:require('electron'),args:[entry],cwd:preview.checkout,env:{...childEnvironment(join(preview.root,'tmp')),ASH_CLIENT_CONFIG:path} as Record<string,string>,timeout:30000});
        const page=await app.firstWindow();
        await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
        const banner=await page.locator('.model-banner').innerText();
        assert.ok(banner.includes(`OpenAI · ${DEFAULT_OPENAI_MODEL}`));assert.match(banner,/1 calls/);assert.doesNotMatch(banner,/expires|\//);
        await page.screenshot({path:join(evidence,'openai-interactive.png')});
        assert.equal((await readSession(preview,interactive!)).callsUsed,1);
        await app.close();app=undefined;
        await stopInstance(ws,preview.id);
        await chmod(envPath,0o644);
        const demo=await launch('--deterministic');assert.equal(demo.modelSessionId,undefined);
        assert.equal((await launch('--deterministic')).supervisor.pid,demo.supervisor.pid);
        await assert.rejects(launch(),/Stop the running instance/);
        await stopInstance(ws,preview.id);
        await assert.rejects(launch(),/chmod 600/);
        await chmod(envPath,0o600);
      } finally {
        await app?.close();app=undefined;
        await disposeInstance(ws,preview.id);
        if(interactive)await rm(sessionDirectory(preview,interactive),{recursive:true,force:true});
      }
    });
  } finally {
    await app?.close();await service.stop().catch(()=>{});await db.$disconnect();
    await copyFile(join(instance.root,'logs/server.log'),join(evidence,'openai-server.log')).catch(()=>{});
    await disposeInstance(ws,instance.id);
    assert.equal(await readFile(envPath,'utf8'),envContent);
    assert.deepEqual(await readdir(sessionDirectory(instance,session.id)),['session.json']);
    await rm(sessionDirectory(instance,session.id),{recursive:true,force:true});
  }
});
