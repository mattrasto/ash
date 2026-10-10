import test from 'node:test';
import { checkDiagram } from '../helpers/schema.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron, type ElectronApplication } from 'playwright';
import { ServerConfig, type Instance, type ConversationView, type RunView, type InspectionView, type RequestPayload } from '../../packages/shared/src/index.ts';
import { devRoot, json, id, atomic, childEnvironment, sleep, exec } from '../../scripts/dev/io.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, disposeInstance, runtime } from '../../scripts/dev/lifecycle.ts';
import { buildMain } from '../../scripts/dev/build.ts';
import { ensureCluster, connect } from '../../scripts/dev/database.ts';
import { migrateProduct } from '../../scripts/dev/product-database.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Conversations } from '../../packages/server/src/modules/conversations/service.ts';

const require = createRequire(join(process.cwd(),'package.json'));
async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,timeout=12000):Promise<T> {
  const deadline=Date.now()+timeout;
  do { const value=await read(); if (accept(value)) return value; await sleep(40); } while(Date.now()<deadline);
  throw new Error('Timed out waiting for conversation state');
}
test('persisted deterministic conversation and Artifact inspection', {timeout:180_000}, async t=>{
  const ws=await workspace(process.cwd(),await devRoot());
  const evidence=process.env.ASH_TEST_EVIDENCE ?? join(ws.devRoot,'evidence',id());
  await mkdir(evidence,{recursive:true});
  const instance=await createInstance(ws,'test','empty');
  let app:ElectronApplication|undefined;
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json')));
  const db=connectProduct(cfg.databaseUrl);
  const direct=new Conversations(db,undefined,false);
  async function request(path:string,body?:object) {
    const state=(await runtime(instance))!;
    return fetch(`${state.serverUrl}/api/${path}`,{method:body ? 'POST':'GET',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},...(body ? {body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  }
  async function api<T>(path:string,body?:object):Promise<T> {const response=await request(path,body); assert.equal(response.status,200,await response.clone().text());return response.json();}
  const newThread=async(title:string)=>{const threadId=randomUUID(); await api('threads',{id:threadId,title});return threadId;};
  const view=(threadId:string)=>api<ConversationView>(`threads/${threadId}`);
  const settled=(threadId:string,runId:string)=>until(()=>view(threadId),value=>value.runs.some(run=>run.id===runId && !['queued','running'].includes(run.status)));
  const send=(threadId:string,text:string,mode='normal',requestKey=randomUUID())=>api<RunView>(`threads/${threadId}/messages`,{text,mode,requestKey});
  let threadId='';
  try {
    await startInstance(ws,instance.id,{headless:true});
    await t.test('migration is additive and repeatable, and the runtime has no schema privileges',async()=>{
      const cluster=await ensureCluster(ws.devRoot,ws.checkout);
      const existingThread=await newThread('Migration survivor');
      await migrateProduct(instance,cluster);
      assert.equal((await view(existingThread)).thread.title,'Migration survivor');
      const admin=connect(cluster,instance.database);
      try {
        const tables=await admin`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
        for (const table of ['topics','threads','thread_topics','artifacts','instructions','runs']) assert.ok(tables.some(row=>row.table_name===table));
        const indexes=await admin`SELECT indexname FROM pg_indexes WHERE tablename='runs'`;
        for (const index of ['one_active_run_per_thread','one_initial_run_per_input']) assert.ok(indexes.some(row=>row.indexname===index));
        const checks=await admin`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid IN ('runs'::regclass,'artifacts'::regclass)`;
        assert.equal(checks.length,11);
        const columns=await admin`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('topics','threads','thread_topics','artifacts','instructions','runs')`;
        assert.equal(columns.length,43);
        await checkDiagram(admin,evidence);
      } finally {await admin.end();}
      await assert.rejects(db.$executeRawUnsafe('CREATE TABLE forbidden (id integer)'),/permission denied/);
      assert.equal(await db.instruction.count(),1);
      const serverRequire=createRequire(join(instance.checkout,'packages/server/package.json'));
      const difference=await exec(process.execPath,[serverRequire.resolve('prisma/build/index.js'),'migrate','diff','--from-url',cfg.databaseUrl,'--to-schema-datamodel','prisma/schema.prisma','--exit-code'],{cwd:join(instance.checkout,'packages/server')});
      assert.match(difference.stdout,/No difference detected/);
    });
    await t.test('C01/C05 acceptance and concurrent duplicate delivery preserve one input and one execution',async()=>{
      threadId=await newThread('Persisted repair checklist');
      const key=randomUUID();
      const [a,b]=await Promise.all([send(threadId,'Make a repair checklist','slow',key),send(threadId,'Make a repair checklist','slow',key)]);
      assert.equal(a.id,b.id);
      const busy=await request(`threads/${threadId}/messages`,{text:'Second request',mode:'normal',requestKey:randomUUID()});assert.equal(busy.status,409);
      const conflict=await request(`threads/${threadId}/messages`,{text:'Different content',mode:'normal',requestKey:key});assert.equal(conflict.status,409);
      const state=await settled(threadId,a.id);
      assert.equal(state.runs.length,1);assert.equal(state.artifacts.length,2);
      assert.equal((await send(threadId,'Make a repair checklist','slow',key)).id,a.id);
      const inspection=await api<InspectionView>(`artifacts/${state.artifacts[1].id}`);
      assert.equal(inspection.artifacts.length,4);
      assert.equal(inspection.artifacts.filter(a=>a.layer==='input').length,1);
      assert.equal(inspection.artifacts.find(a=>a.layer==='act')!.sourceId,inspection.input.id);
      assert.equal(state.artifacts[1].sourceId,state.runs[0].state.request_artifact_id);
    });
    await t.test('C03/C04 follow-up context and inspection use the captured request',async()=>{
      const other=await newThread('Unrelated'); const unrelated=await send(other,'Never include this');await settled(other,unrelated.id);
      const followup=await send(threadId,'Put kitchen items first');const state=await settled(threadId,followup.id);
      const inspection=await api<InspectionView>(`artifacts/${state.runs.find(r=>r.id===followup.id)!.state.response_artifact_id}`);
      const request=inspection.artifacts.find(a=>a.id===followup.state.request_artifact_id)!.payload as RequestPayload;
      assert.deepEqual(request.messages.map(m=>m.role),['system','user','assistant','user']);
      assert.equal(request.messages.at(-1)!.content,'Put kitchen items first');
      assert.ok(!JSON.stringify(request).includes('Never include this'));
      assert.equal(request.provider,'deterministic');assert.equal(request.selection.instructions.length,1);
      assert.equal(request.selection.artifacts.length,3);
    });
    await t.test('C07 cancellation freezes partial output and queued cancellation has no start time',async()=>{
      const slow=await send(threadId,'Slow response please','slow');
      const partial=await until(()=>view(threadId),v=>v.artifacts.some(a=>a.runId===slow.id));
      assert.equal(partial.runs.find(r=>r.id===slow.id)!.status,'running');
      await api(`runs/${slow.id}/cancel`,{});
      const before=await view(threadId); await sleep(450); const after=await view(threadId);
      assert.deepEqual(after.artifacts.find(a=>a.runId===slow.id),before.artifacts.find(a=>a.runId===slow.id));
      assert.equal(after.runs.find(r=>r.id===slow.id)!.status,'cancelled');
      const queued=await direct.submit(threadId,randomUUID(),'Queued cancellation','normal');
      const cancelled=await direct.cancel(queued.id);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.startedAt,null);assert.equal(cancelled.state.response_artifact_id,null);
    });
    await t.test('C07/C14 retries retain prior outcomes, own their requests, and select only completed answers',async()=>{
      const failed=await send(threadId,'Retry this request','fail'); const first=await settled(threadId,failed.id); assert.equal(first.runs.find(r=>r.id===failed.id)!.status,'failed');
      const retry=await api<RunView>(`runs/${failed.id}/retry`,{requestKey:randomUUID(),mode:'normal'});await settled(threadId,retry.id);
      const failedAgain=await api<RunView>(`runs/${retry.id}/retry`,{requestKey:randomUUID(),mode:'fail-before'});await settled(threadId,failedAgain.id);
      const originalRequest=await db.artifact.findUniqueOrThrow({where:{id:failed.state.request_artifact_id}});
      const retryRequest=await db.artifact.findUniqueOrThrow({where:{id:retry.state.request_artifact_id}});
      assert.notEqual(originalRequest.id,retryRequest.id);assert.equal(retryRequest.runId,retry.id);
      assert.deepEqual((originalRequest.payload as RequestPayload).messages,(retryRequest.payload as RequestPayload).messages);
      const followup=await send(threadId,'Continue after the retries');await settled(threadId,followup.id);
      const request=(await db.artifact.findUniqueOrThrow({where:{id:followup.state.request_artifact_id}})).payload as RequestPayload;
      const good=(await view(threadId)).runs.find(r=>r.id===retry.id)!;
      assert.ok(request.selection.artifacts.some(a=>a.id===good.state.response_artifact_id));
      assert.ok(request.selection.omitted.some(a=>a.reason==='not-completed'));
      assert.equal(await db.artifact.count({where:{layer:'surface',sourceId:failed.inputArtifactId}}),1);
      const empty=await send(threadId,'Empty output','empty');const emptyState=await settled(threadId,empty.id);
      assert.deepEqual((emptyState.artifacts.find(a=>a.runId===empty.id)!.payload as {content:unknown[]}).content,[]);
    });
    await t.test('C08 independent threads can run concurrently',async()=>{
      const a=await newThread('Parallel A'), b=await newThread('Parallel B');
      const [ra,rb]=await Promise.all([send(a,'One','slow'),send(b,'Two','slow')]);
      await until(()=>view(a),v=>v.runs.some(r=>r.status==='running'));
      assert.equal((await view(b)).runs[0].status,'running');
      await Promise.all([api(`runs/${ra.id}/cancel`,{}),api(`runs/${rb.id}/cancel`,{})]);
    });
    await t.test('C11 restart preserves completed data and interrupts undispatched work',async()=>{
      const before=await view(threadId);
      await stopInstance(ws,instance.id);
      const queued=await direct.submit(threadId,randomUUID(),'Persisted before crash','normal');
      await startInstance(ws,instance.id,{headless:true});
      const after=await view(threadId);
      assert.deepEqual(after.artifacts.slice(0,before.artifacts.length),before.artifacts);
      const interrupted=after.runs.find(r=>r.id===queued.id)!;
      assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.startedAt,null);assert.equal(interrupted.state.response_artifact_id,null);
      await sleep(150);assert.equal((await view(threadId)).runs.length,after.runs.length);
    });
    await t.test('C12 the API captures context limits and rejects oversized input',async()=>{
      const target=await newThread('Bounded context');
      for (let index=0;index<3;index++) {const accepted=await send(target,`${index}:`+'x'.repeat(2998),'empty');await settled(target,accepted.id);}
      const current=await send(target,'Latest '+ 'y'.repeat(3990),'empty');await settled(target,current.id);
      const captured=(await db.artifact.findUniqueOrThrow({where:{id:current.state.request_artifact_id}})).payload as RequestPayload;
      assert.ok(captured.selection.omitted.some(item=>item.reason==='context-limit'));
      assert.ok(captured.messages.reduce((sum,message)=>sum+message.content.length,0)<=captured.selection.maxCharacters);
      assert.ok(captured.messages.at(-1)!.content.startsWith('Latest'));
      assert.equal((await requestOversized()).status,400);
      async function requestOversized() {return request(`threads/${target}/messages`,{requestKey:randomUUID(),text:'z'.repeat(4001),mode:'empty'});}
    });
    await t.test('backend ownership and crash recovery cannot silently repeat work',async()=>{
      const running=(await runtime(instance))!;
      const serverRequire=createRequire(join(instance.checkout,'package.json'));
      await assert.rejects(exec(process.execPath,['--import',serverRequire.resolve('tsx'),'packages/server/src/main.ts',join(instance.root,'server.json')],{cwd:instance.checkout,timeout:5000,env:childEnvironment(join(instance.root,'tmp'))}),/Another backend already owns/);
      const slow=await send(threadId,'Interrupt this running response','slow');
      await until(()=>view(threadId),value=>value.artifacts.some(a=>a.runId===slow.id));
      const server=running.children.find(child=>child.identity.includes('packages/server/src/main.ts'))!;
      process.kill(server.pid,'SIGKILL');
      await until(()=>runtime(instance),value=>value?.phase==='failed');
      await startInstance(ws,instance.id,{headless:true});
      const restored=await view(threadId); const interrupted=restored.runs.find(run=>run.id===slow.id)!;
      assert.equal(interrupted.status,'interrupted');
      const content=restored.artifacts.find(artifact=>artifact.runId===slow.id)!;
      await sleep(400);assert.deepEqual((await view(threadId)).artifacts.find(artifact=>artifact.id===content.id),content);
    });
    await t.test('queued and retried requests retain the original instruction snapshot',async()=>{
      const target=await newThread('Snapshot isolation');
      const queued=await direct.submit(target,randomUUID(),'Capture original instructions','normal');
      const request=(await db.artifact.findUniqueOrThrow({where:{id:queued.state.request_artifact_id}})).payload as RequestPayload;
      const cluster=await ensureCluster(ws.devRoot,ws.checkout);const admin=connect(cluster,instance.database);
      const original=await db.instruction.findUniqueOrThrow({where:{key:'response'}});
      try {
        await admin`UPDATE instructions SET text='Changed after acceptance', updated_at=now() WHERE key='response'`;
        direct.dispatch(queued.id);await settled(target,queued.id);
        const retry=await api<RunView>(`runs/${queued.id}/retry`,{requestKey:randomUUID(),mode:'normal'});await settled(target,retry.id);
        const captured=(await db.artifact.findUniqueOrThrow({where:{id:retry.state.request_artifact_id}})).payload as RequestPayload;
        assert.deepEqual(captured.messages,request.messages);
        assert.equal(captured.messages[0].content,original.text);
      } finally {await admin`UPDATE instructions SET text=${original.text},updated_at=now() WHERE key='response'`;await admin.end();}
    });
    await t.test('desktop sends, inspects, preserves drafts and reconnects during generation',async()=>{
      const running=(await runtime(instance))!;
      const entry=await buildMain(instance.checkout,join(instance.root,'build'));
      const path=join(instance.root,'chat-test-client.json');
      await atomic(path,{root:instance.root,label:instance.label,instanceId:instance.id,url:running.webUrl,windowed:true,background:true});
      const launch=()=>_electron.launch({executablePath:require('electron'),args:[entry],cwd:instance.checkout,env:{...childEnvironment(join(instance.root,'tmp')),ASH_CLIENT_CONFIG:path} as Record<string,string>,timeout:30000});
      app=await launch();let page=await app.firstWindow();
      const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
      await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
      await page.getByLabel('New thread',{exact:true}).fill('Desktop conversation');await page.getByRole('button',{name:'+ Create thread',exact:true}).click();
      await page.getByRole('heading',{name:'Desktop conversation',exact:true}).waitFor();
      await page.getByLabel('Message',{exact:true}).fill('Hello from Electron');await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByTestId('run-status').filter({hasText:'completed'}).waitFor();
      await page.getByLabel('Message',{exact:true}).fill('What did I just say?');await page.getByRole('button',{name:'Send message',exact:true}).click();
      await until(()=>page.getByTestId('run-status').filter({hasText:'completed'}).count(),n=>n===2);
      await page.getByRole('button',{name:'Inspect Ash response',exact:true}).last().click();
      await page.getByRole('heading',{name:'Captured model request',exact:true}).waitFor();
      assert.ok((await page.getByLabel('Artifact inspector').innerText()).includes('Hello from Electron'));
      await page.screenshot({path:join(evidence,'chat-inspection.png')});
      await page.getByRole('button',{name:'Close inspector'}).click();
      await page.getByLabel('Message',{exact:true}).fill('Keep this draft');
      await page.getByRole('navigation',{name:'Threads'}).getByRole('button',{name:'Persisted repair checklist',exact:true}).click();
      await page.getByRole('navigation',{name:'Threads'}).getByRole('button',{name:'Desktop conversation',exact:true}).click();
      assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Keep this draft');
      await page.getByText('Test response settings',{exact:true}).click();await page.getByLabel('Response behavior').selectOption('slow');
      await page.getByLabel('Message',{exact:true}).fill('Finish while the client is closed');await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByRole('button',{name:'Stop response',exact:true}).waitFor();
      await app.close();app=undefined;
      await sleep(450);app=await launch();page=await app.firstWindow();
      await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor();
      await until(()=>page.getByTestId('run-status').filter({hasText:'completed'}).count(),n=>n===3);
      assert.equal(await page.getByTestId('message').count(),6);
      await page.getByText('Test response settings',{exact:true}).click();await page.getByLabel('Response behavior').selectOption('slow');
      await page.getByLabel('Message',{exact:true}).fill('Cancel this in the desktop');await page.getByRole('button',{name:'Send message',exact:true}).click();
      await until(()=>page.getByTestId('message').count(),count=>count===8);
      await page.getByRole('button',{name:'Stop response',exact:true}).click();
      await page.getByTestId('run-status').filter({hasText:'cancelled'}).waitFor();
      await page.getByLabel('Response behavior').selectOption('normal');
      await page.getByRole('button',{name:'Retry response',exact:true}).last().click();
      await until(()=>page.getByTestId('run-status').filter({hasText:'completed'}).count(),count=>count===4);
      assert.equal(await page.getByTestId('message').count(),9);
      await page.screenshot({path:join(evidence,'chat-reconnected.png')});
      assert.deepEqual(errors,[]);
    });
  } finally {
    await app?.close();await db.$disconnect();await copyFile(join(instance.root,'logs/server.log'),join(evidence,'chat-server.log')).catch(()=>{});await disposeInstance(ws,instance.id);
  }
});
