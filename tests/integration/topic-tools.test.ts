import { closeInspector } from '../support/ui.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ServerConfig, RequestPayload, TopicRetrievalResult, ToolArtifact, type ToolResult, type ToolCall } from '../../packages/shared/src/index.ts';
import { devRoot,json,sleep } from '../../scripts/dev/io.ts';
import { workspace,createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance,stopInstance,disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { Organization } from '../../packages/server/src/modules/organization/service.ts';
import { TopicRetrieval } from '../../packages/server/src/modules/context/retrieval.ts';
import { topicRuntime } from '../../packages/server/src/modules/context/tools.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import { openAIModel } from '../../packages/server/src/platform/models/openai.ts';
import type { ModelAdapter,ModelOutput } from '../../packages/server/src/platform/models/adapter.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { providerResponse,sse,successEvents } from '../helpers/openai.ts';
import { desktop } from '../support/desktop.ts';

const call=(name:string,args:unknown):ToolCall=>({name,callId:randomUUID(),arguments:JSON.stringify(args)});
const data=(result:ToolResult)=>result.content.flatMap(block=>{const parsed=block.type==='data'?TopicRetrievalResult.safeParse(block.value):null;return parsed?.success?[parsed.data]:[];})[0];

test('Topic search and read through the shared dispatcher, provider and desktop',{timeout:180000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),instance=await createInstance(ws,'test','empty');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(cfg.databaseUrl),org=new Organization(db),retrieval=new TopicRetrieval(db),runtime=topicRuntime(retrieval);
  const services:Threads[]=[];
  const service=(model:ModelAdapter,auto=false)=>{const value=new Threads(db,model,auto,undefined,runtime);services.push(value);return value;};
  const seed=service({...deterministicModel,async *stream(){yield 'The policy deductible is $500.';}});
  const thread=async(title:string)=>{const id=randomUUID();await seed.createThread(id,title);return id;};
  const link=async(id:string,ids:string[])=>org.link(id,{expectedVersion:(await org.readMembership(id)).version,topicIds:ids});
  async function done(id:string){for(let n=0;n<500;n++){const row=await db.run.findUniqueOrThrow({where:{id}});if(!['queued','running'].includes(row.status))return row;await sleep(20);}throw Error('Run did not finish');}
  const runArtifacts=(id:string)=>db.artifact.findMany({where:{runId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  const results=async(id:string)=>(await runArtifacts(id)).flatMap(row=>{const parsed=ToolArtifact.safeParse(row.payload);return parsed.success&&parsed.data.type==='tool_result'?[parsed.data.result]:[];});
  const captured=async(id:string)=>(await runArtifacts(id)).flatMap(row=>{const parsed=RequestPayload.safeParse(row.payload);return parsed.success?[parsed.data]:[];});
  let app:Awaited<ReturnType<typeof desktop>>|undefined;
  try {
    await startInstance(ws,instance.id,{headless:true});
    await scenarioStep(t,'topic-tool-integration',async()=>{
      const topic=await org.create({id:randomUUID(),name:'Insurance'}),source=await thread('Earlier homeowners insurance');
      const sourceText='The homeowners deductible is $500.\n'+'Additional policy context. '.repeat(60)+'End of policy notes.';
      await link(source,[topic.id]);const initial=await seed.submit(source,randomUUID(),sourceText,'normal');seed.dispatch(initial.id);assert.equal((await done(initial.id)).status,'completed');
      const target=await thread('Insurance follow-up');await link(target,[topic.id]);
      const guidance=await org.readInstruction({scope:'global',key:'response'});
      const observed:RequestPayload[]=[];
      const scripted=(hook?:()=>Promise<void>):ModelAdapter=>({...deterministicModel,async *stream(request){
        observed.push(structuredClone(request));
        const round=request.tools?.previousOutputIds.length??0;
        if(!request.tools){yield 'No linked Topic context.';return;}
        if(round===0){yield {kind:'output',calls:[call('topic.search',{query:'deductible'})]} satisfies ModelOutput;return;}
        if(round===1){await hook?.();const source=data(request.tools.results.at(-1)!.result).results.find(x=>x.speaker==='user');if(!source){yield 'No matching accessible source.';return;}yield {kind:'output',calls:[call('topic.read',{artifactId:source.artifactId,offset:0})]} satisfies ModelOutput;return;}
        const last=request.tools.results.at(-1)!.result;
        yield last.status==='success'?`Your deductible was $500. [Earlier discussion](ash-source:${last.references[0].citationId})`:'The source is no longer available within this Topic.';
      }});
      const value=service(scripted()),accepted=await value.submit(target,randomUUID(),'What deductible did we discuss?','normal');
      await org.saveInstruction({owner:guidance.owner,text:'Guidance edited while queued',expected:{id:guidance.document!.id,updatedAt:guidance.document!.updatedAt}});
      value.dispatch(accepted.id);const completed=await done(accepted.id);assert.equal(completed.status,'completed');
      assert.equal(observed.length,3);assert.equal(observed[0].messages[0].content,guidance.document!.text);
      assert.equal(observed[1].tools!.results.length,1);assert.equal(observed[2].tools!.results.length,2);
      const records=await results(accepted.id);assert.equal(records.length,2);assert.deepEqual(observed[2].tools!.results.map(x=>x.result),records);
      const searchReference=records[0].references.find(ref=>ref.location.artifactId===records[1].references[0].location.artifactId)!;
      assert.equal(searchReference.id,records[1].references[0].id,'Both observations retain the same source identity');
      assert.notEqual(searchReference.citationId,records[1].references[0].citationId,'Search and read must identify separate captured observations');
      assert.equal(data(records[1]).results[0].text,sourceText);
      assert.ok(data(records[0]).results.find(source=>source.speaker==='user')!.text.length<sourceText.length);
      assert.equal(records[1].references[0].location.artifactId,data(records[1]).results[0].artifactId);
      assert.deepEqual((await captured(accepted.id)).map(x=>x.selection),[observed[0].selection,observed[0].selection,observed[0].selection]);
      const frozen=JSON.stringify(await runArtifacts(accepted.id));

      // Render the real saved workflow in hidden Electron and follow its original source.
      app=await desktop(instance);const page=app.page;
      // Feature tests omit the HMR wrapper: one close must produce one completed rail exit.
      await page.evaluate(()=>{(globalThis as any).__topicRailExits=0;document.addEventListener('outroend',event=>{if((event.target as HTMLElement).matches('.inspector-rail'))(globalThis as any).__topicRailExits++;},true);});
      await page.getByRole('button',{name:'Insurance follow-up',exact:true}).click();
      await page.getByRole('link',{name:'Earlier discussion',exact:true}).click();
      const readResult=observed[2].tools!.results.at(-1)!.artifactId;
      await page.getByTestId('inspected-identity').filter({hasText:readResult}).waitFor();
      assert.equal(await page.getByRole('region',{name:'Execution steps'}).locator('details[open] > summary').filter({hasText:'topic.read · completed'}).count(),1);
      await closeInspector(page);
      assert.equal(await page.evaluate(()=>(globalThis as any).__topicRailExits),1,'One rail exit per completed close');
      await page.getByRole('button',{name:'Inspect Ash response',exact:true}).click();
      const context=page.getByRole('region',{name:'Retrieved Topic context'});await context.waitFor();
      assert.equal(await context.locator('.excerpt').filter({hasText:'The homeowners deductible is $500.'}).count(),2);
      const original=context.getByRole('button',{name:'Open original message'}).last();
      const originalId=await original.evaluate(button=>button.nextElementSibling!.textContent!);
      await original.click();await page.getByRole('heading',{name:'Earlier homeowners insurance',exact:true}).waitFor();
      // Navigation first changes the heading, then finishes opening this source's inspector.
      await page.getByTestId('inspected-identity').filter({hasText:originalId}).waitFor();
      await closeInspector(page);await page.getByRole('button',{name:'Insurance follow-up',exact:true}).click();await page.getByRole('button',{name:'Inspect Ash response',exact:true}).click();
      // A delayed inspection refresh must not undo a newer manual expansion.
      const firstRequestId=accepted.state.request_artifact_id;
      const finalRound=page.getByRole('region',{name:'Execution steps'}).locator(':scope > details').nth(2);
      const requestPath=`**/api/artifacts/${firstRequestId}`;
      // Register interception after scene startup and retain it until the page closes.
      await page.locator('[data-scene-status="ready"]').waitFor();
      await page.locator('.scene-host canvas[data-cloud-state="ready"]').waitFor();
      let resume!:()=>void,arrived!:()=>void,heldCompleted!:()=>void,holding=true,started=false;
      const held=new Promise<void>(resolve=>resume=resolve),ready=new Promise<void>(resolve=>arrived=resolve),handled=new Promise<void>(resolve=>heldCompleted=resolve);
      await app.network.add(requestPath,async route=>{if(!holding){await route.continue();return;}started=true;try{const response=await route.fetch();arrived();await held;await route.fulfill({response});}finally{heldCompleted();}});
      try {
        await page.getByRole('region',{name:'Execution steps'}).getByText('Model call 1 · completed',{exact:true}).click();await page.getByRole('button',{name:'Inspect captured request',exact:true}).first().click();
        await ready;
        assert.equal(await page.getByRole('region',{name:'Retrieved Topic context'}).count(),0);
        await page.getByRole('region',{name:'Execution steps'}).getByText('Model call 3 · completed',{exact:true}).click();
        const refreshed=page.waitForResponse(response=>response.url().endsWith(`/api/artifacts/${firstRequestId}`));
        resume();await (await refreshed).finished();
        await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
        assert.equal(await finalRound.getAttribute('open'),'','Refresh must preserve the newly opened model call');
      } finally {resume();holding=false;if(started)await handled;}
      await finalRound.getByRole('button',{name:'Inspect captured request',exact:true}).click();await context.waitFor();
      const evidence=process.env.ASH_TEST_EVIDENCE??join(ws.devRoot,'evidence','topic-context');await mkdir(evidence,{recursive:true});await context.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'topic-retrieval.png')});
      assert.equal(await app.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible()||w.isFocusable()||w.isFocused())),false);
      assert.deepEqual(app.errors,[]);await app.close();app=undefined;

      // The real OpenAI adapter is HTTP-mocked; inspect the provider's actual requests.
      const bodies:any[]=[];
      const mocked=openAIModel({apiKey:'synthetic-topic-key',model:'test-topic-model',options:{api:'responses',store:false,maxOutputTokens:512,timeoutMs:5000},reserve:async()=>10000,info:async()=>({provider:'openai',model:'test-topic-model'})},async(_url,init)=>{
        const body=JSON.parse(init!.body as string);bodies.push(body);
        for(const tool of body.tools)assert.deepEqual([...tool.parameters.required].sort(),Object.keys(tool.parameters.properties).sort());
        if(bodies.length===3)return sse(successEvents('The deductible is $500 from the captured discussion.'));
        const prior=body.input.filter((item:any)=>item.type==='function_call_output').at(-1);
        const args=bodies.length===1?{query:'deductible'}:{artifactId:data(JSON.parse(prior.output)).results.find(x=>x.speaker==='user')!.artifactId,offset:0};
        return sse([{type:'response.completed',response:{...providerResponse(''),output:[{id:`fc_${bodies.length}`,type:'function_call',status:'completed',name:bodies.length===1?'ash_0':'ash_1',call_id:`topic_${bodies.length}`,arguments:JSON.stringify(args)}]}}]);
      });
      const remote=service(mocked),remoteRun=await remote.submit(target,randomUUID(),'Find the deductible through linked context.','normal');remote.dispatch(remoteRun.id);assert.equal((await done(remoteRun.id)).status,'completed');assert.equal(bodies.length,3);
      assert.equal(bodies[0].store,false);assert.equal(bodies[0].input[0].content,'Guidance edited while queued');
      const supplied=bodies[2].input.filter((item:any)=>item.type==='function_call_output').map((item:any)=>JSON.parse(item.output));
      assert.deepEqual(supplied,await results(remoteRun.id));assert.match(JSON.stringify(supplied),/The homeowners deductible is \$500/);

      // Membership changes after search deny the next read but never rewrite the search.
      const changing=service(scripted(()=>link(source,[]).then(()=>{}))),changeRun=await changing.submit(target,randomUUID(),'Read while membership changes','normal');changing.dispatch(changeRun.id);assert.equal((await done(changeRun.id)).status,'completed');
      const changed=await results(changeRun.id);assert.equal(changed[0].status,'success');assert.equal(changed[1].status,'denied');assert.equal(JSON.stringify(await runArtifacts(accepted.id)),frozen);await link(source,[topic.id]);

      // Pause at the continuation boundary, cancel, then release: no read can dispatch.
      let release!:()=>void,entered!:()=>void;
      const gate=new Promise<void>(resolve=>release=resolve),atGate=new Promise<void>(resolve=>entered=resolve);
      const cancellable=service(scripted(async()=>{entered();await gate;})),cancelRun=await cancellable.submit(target,randomUUID(),'Cancel before read','normal');cancellable.dispatch(cancelRun.id);await atGate;await cancellable.cancel(cancelRun.id);release();await cancellable.stop();assert.equal((await results(cancelRun.id)).length,1);

      const demonstration=service(deterministicModel);
      const demoRun=await demonstration.submit(target,randomUUID(),'Search Topic for "deductible"','normal');
      demonstration.dispatch(demoRun.id);assert.equal((await done(demoRun.id)).status,'completed');
      const demoResults=await results(demoRun.id);assert.equal(demoResults.length,2);
      assert.ok(demoResults.every(result=>result.status==='success'));

      const beforeRetry=JSON.stringify(await runArtifacts(accepted.id));
      await org.change(topic.id,{deleted:true,expectedUpdatedAt:topic.updatedAt});
      const retry=await value.retry(accepted.id,randomUUID(),'normal');value.dispatch(retry.id);await done(retry.id);
      assert.equal(JSON.stringify(await runArtifacts(accepted.id)),beforeRetry);
      assert.ok(!(await results(retry.id)).some(result=>result.status==='success'&&data(result)?.results.length));
      await stopInstance(ws,instance.id);await startInstance(ws,instance.id,{headless:true});assert.equal(JSON.stringify(await runArtifacts(accepted.id)),beforeRetry);
      app=await desktop(instance);await app.page.getByRole('button',{name:'Insurance follow-up',exact:true}).click();await app.page.getByRole('button',{name:'Inspect Ash response',exact:true}).first().click();await app.page.getByRole('region',{name:'Retrieved Topic context'}).waitFor();assert.deepEqual(app.errors,[]);
    });
  } finally {if(app)await app.close();for(const service of services)await service.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
