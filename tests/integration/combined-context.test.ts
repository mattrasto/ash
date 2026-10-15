import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerConfig, RequestPayload, RunState, type RunView } from '../../packages/shared/src/index.ts';
import { devRoot, json, sleep } from '../../scripts/dev/io.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, disposeInstance } from '../../scripts/dev/lifecycle.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { Organization } from '../../packages/server/src/modules/organization/service.ts';
import { TopicRetrieval } from '../../packages/server/src/modules/context/retrieval.ts';
import { topicRuntime } from '../../packages/server/src/modules/context/tools.ts';
import { filesystemRuntime, loadFilesystemConfig } from '../../packages/server/src/modules/filesystem/runtime.ts';
import { composeToolRuntimes } from '../../packages/server/src/modules/tools/contract.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { desktop } from '../support/desktop.ts';

test('Topic and filesystem context coexist in the running app', {timeout: 120000}, async t => {
  const ws = await workspace(process.cwd(), await devRoot()), instance = await createInstance(ws, 'test', 'empty');
  const cfg = ServerConfig.parse(await json(join(instance.root, 'server.json'))), db = connectProduct(cfg.databaseUrl);
  const org = new Organization(db), services: Threads[] = [];
  let app: Awaited<ReturnType<typeof desktop>> | undefined;
  async function done(id: string) {
    for (let n=0;n<500;n++) {
      const run=await db.run.findUniqueOrThrow({where:{id}});
      if (!['queued','running'].includes(run.status)) { assert.equal(run.status,'completed',JSON.stringify(run.error)); return RunState.parse(run.state); }
      await sleep(20);
    }
    throw new Error('Combined context Run did not finish');
  }
  const request = async (id: string) => RequestPayload.parse((await db.artifact.findUniqueOrThrow({where:{id}})).payload);
  try {
    await scenarioStep(t, 'combined-context', async () => {
      const folder=join(instance.root,'files','source');await mkdir(folder);
      const root=await realpath(folder), path=join(root,'marker.ts');
      await writeFile(path,'export const integration_marker = "from filesystem";\n');
      const configuration=JSON.stringify({version:1,scopes:[{path:root,operations:['list','read','glob','search'],excludedNames:[]}]});
      const configPath=join(instance.root,'.ash-tools.json');await writeFile(configPath,configuration);
      const live=await startInstance(ws,instance.id,{headless:true});
      const post=async<T>(path:string,body:object):Promise<T>=>{
        const response=await fetch(`${live.serverUrl}/api/${path}`,{method:'POST',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
        assert.equal(response.ok,true,await response.clone().text());return response.json() as Promise<T>;
      };
      const topic=await org.create({id:randomUUID(),name:'Ash development'});
      await org.saveInstruction({owner:{scope:'topic',id:topic.id},text:'ROUTING_ONLY: group integration work here.',expected:null});
      const create=async(title:string,linked=true)=>{const id=randomUUID();await post('threads',{id,title,...(linked?{topicId:topic.id}:{})});return id;};
      const send=async(thread:string,text:string)=>{const run=await post<RunView>(`threads/${thread}/messages`,{requestKey:randomUUID(),text,mode:'normal'});return done(run.id);};
      const source=await create('Earlier integration findings');await send(source,'integration_marker was discussed in this earlier Thread.');
      const target=await create('Combined evidence');
      const topicState=await send(target,'Search Topic for "integration_marker"');
      const initial=await request(topicState.request_artifact_id);
      assert.deepEqual(initial.tools!.definitions.map(tool=>tool.name).sort(),['filesystem.glob','filesystem.list','filesystem.read','filesystem.search','topic.read','topic.search']);
      assert.doesNotMatch(JSON.stringify(initial.messages),/ROUTING_ONLY/);
      assert.deepEqual(topicState.tools!.calls.map(call=>call.call.name),['topic.search','topic.read']);
      const filesystemState=await send(target,'Find source for "integration_marker"');
      assert.ok(filesystemState.tools!.calls.some(call=>call.call.name==='filesystem.read'));

      const runtime=composeToolRuntimes(topicRuntime(new TopicRetrieval(db)),filesystemRuntime(()=>loadFilesystemConfig(instance.root)));
      const combined=new Threads(db,{...deterministicModel,async *stream(input){
        if(!input.tools!.previousOutputIds.length){yield {kind:'output',calls:[
          {callId:'topic',name:'topic.search',arguments:JSON.stringify({query:'integration_marker'})},
          {callId:'file',name:'filesystem.read',arguments:JSON.stringify({path,startLine:1,maxLines:10})},
        ]};return;}
        assert.deepEqual(input.tools!.results.map(item=>item.result.status),['success','success']);
        assert.match(JSON.stringify(input.tools!.results[0].result),/earlier Thread/);
        assert.match(JSON.stringify(input.tools!.results[1].result),/from filesystem/);
        yield input.tools!.results.map((item,index)=>`[${index?'Source file':'Prior finding'}](ash-source:${item.result.references[0].citationId})`).join(' and ');
      }},false,undefined,runtime);services.push(combined);
      const mixed=await combined.submit(target,randomUUID(),'Combine the saved finding and implementation.','normal');combined.dispatch(mixed.id);
      const mixedState=await done(mixed.id),calls=mixedState.tools!.calls;
      assert.equal(new Set(calls.flatMap(call=>call.citationIds!)).size,calls.flatMap(call=>call.citationIds!).length);
      const frozen=JSON.stringify(await db.artifact.findMany({where:{runId:mixed.id},orderBy:{id:'asc'}}));
      app=await desktop(instance);const page=app.page;
      await page.getByRole('region',{name:'Topic Ash development',exact:true}).getByRole('button',{name:'Combined evidence',exact:true}).click();
      for(const [index,label] of ['Prior finding','Source file'].entries()){
        await page.getByRole('link',{name:label,exact:true}).click();
        await page.locator('.inspector > code').filter({hasText:calls[index].resultArtifactId!}).waitFor();
        await page.getByRole('button',{name:'Close inspector',exact:true}).click();
      }
      const evidence=process.env.ASH_TEST_EVIDENCE??join(ws.devRoot,'evidence','combined-context');await mkdir(evidence,{recursive:true});
      await page.screenshot({path:join(evidence,'combined-context.png')});
      assert.equal(await app.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible()||w.isFocusable()||w.isFocused())),false);
      assert.deepEqual(app.errors,[]);await app.app.close();app=undefined;

      await writeFile(configPath,'invalid configuration');
      const degraded=await send(target,'Search Topic for "integration_marker"'), unavailable=await request(degraded.request_artifact_id);
      assert.deepEqual(unavailable.tools!.definitions.map(tool=>tool.name),['topic.search','topic.read']);
      assert.equal(unavailable.tools!.availabilityIssues![0].code,'scope_configuration');
      assert.ok(degraded.tools!.calls.every(call=>call.status==='completed'));
      await writeFile(configPath,configuration);
      const unlinked=await create('Unlinked filesystem work',false),isolated=await send(unlinked,'Find source for "integration_marker"');
      assert.ok((await request(isolated.request_artifact_id)).tools!.definitions.every(tool=>tool.name.startsWith('filesystem.')));
      assert.equal(JSON.stringify(await db.artifact.findMany({where:{runId:mixed.id},orderBy:{id:'asc'}})),frozen);
    });
  } finally {if(app)await app.app.close();for(const service of services)await service.stop();await db.$disconnect();await disposeInstance(ws,instance.id);}
});
