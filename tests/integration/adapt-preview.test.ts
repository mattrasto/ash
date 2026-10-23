import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import {createSocket} from 'node:dgram';
import { Instance,ServerConfig,type AdaptCheckpoint } from '../../packages/shared/src/index.ts';
import { nativePreview } from '../../scripts/dev/adapt-preview.ts';
import { workspace,createInstance,readInstance } from '../../scripts/dev/workspace.ts';
import { devRoot,json,exec,stopProcess } from '../../scripts/dev/io.ts';
import { runtime,disposeInstance,control } from '../../scripts/dev/lifecycle.ts';
import { AdaptSources,git } from '../../packages/server/src/modules/adapt/source.ts';
import { scenarioStep } from '../support/node-scenarios.ts';

test('Adapt native UI preview: trusted runtime and isolated candidate',{timeout:180000},async t=>{
  const ws=await workspace(process.cwd(),await devRoot()),parent=await createInstance(ws,'test','scratchpad'),ownerPath=join(parent.root,'instance.json');
  const workspaceId=randomUUID(),threadId=randomUUID(),sources=new AdaptSources(ws.checkout,join(parent.root,'adapt','sources'));
  const base=await sources.snapshot(await sources.revision()),directory=join(parent.root,'export');await sources.materialize(base,{patch:'',tree:base.tree},directory);
  let outsideRequests=0,udpPackets=0;const udp=createSocket('udp4');udp.on('message',()=>udpPackets++);await new Promise<void>(resolve=>udp.bind(0,'127.0.0.1',resolve));
  const canaryServer=createServer((_req,res)=>{outsideRequests++;res.end('OUTSIDE_PREVIEW_CANARY');});await new Promise<void>(resolve=>canaryServer.listen(0,'127.0.0.1',resolve));
  const canaryAddress=canaryServer.address();assert.ok(canaryAddress&&typeof canaryAddress!=='string');const canaryURL='http://127.0.0.1:'+canaryAddress.port;
  const canary=join(parent.root,'private-canary.txt');await writeFile(canary,'PRIVATE_FILE_CANARY');
  const launch=async(checkpoint:AdaptCheckpoint)=>nativePreview('request',ownerPath,{workspaceId,threadId,checkpoint,command:{action:'run',submissionId:randomUUID()}});
  const command=async(action:'stop'|'refresh')=>nativePreview('request',ownerPath,{workspaceId,threadId,checkpoint:null,command:{action,submissionId:randomUUID()}});
  const status=()=>nativePreview('status',ownerPath,{workspaceId});
  const wait=async(phase:string)=>{const until=Date.now()+70000;while(Date.now()<until){const value=await status();if(value.phase===phase)return value;if(value.phase==='failed')throw new Error(value.message);await new Promise(r=>setTimeout(r,300));}throw new Error('Preview timed out.');};
  const checkpoint=async():Promise<AdaptCheckpoint>=>{await git(directory,['add','--all']);return {id:randomUUID(),baseRevision:base.revision,tree:await git(directory,['write-tree']),patch:(await exec('git',['diff','--cached','--binary',base.tree],{cwd:directory})).stdout,checks:'Controlled UI probe.',createdAt:new Date().toISOString()};};
  let preview:Instance|undefined;
  try{
    await scenarioStep(t,'adapt-native-preview',async()=>{
      const main=join(directory,'packages/client/src/renderer/main.ts');
      await writeFile(main,(await readFile(main,'utf8'))+`\nvoid (async()=>{
        const denied=async(url:string)=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(3000)});return !response.ok;}catch{return true;}};
        const peer=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udp.address().port}'}]});peer.createDataChannel('probe');await peer.setLocalDescription(await peer.createOffer());
        await new Promise(resolve=>setTimeout(resolve,2000));peer.close();
        const info=await (await fetch('/api/info')).json();
        const checks={require:typeof (window as any).require,process:typeof (window as any).process,media:typeof (window as any).ashMedia,recording:typeof (window as any).ashRecording,
          file:await denied(${JSON.stringify('file://'+canary)}),viteFile:await denied(${JSON.stringify('/@fs'+canary)}),editor:await denied('/__open-in-editor?file='+encodeURIComponent(${JSON.stringify(canary)})),otherInstance:await denied(${JSON.stringify(canaryURL)}),adapt:info.adapt.available,model:info.model.provider,identity:info.candidatePreview.workspaceId};
        await fetch('/api/state',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({note:JSON.stringify(checks)})});
      })();\n`);
      const first=await checkpoint();await launch(first);await wait('running');
      const state=await json<{instanceId:string}>(join(parent.root,'adapt','previews',workspaceId,'preview.json'));preview=await readInstance(ws,state.instanceId);assert.notEqual(preview.id,parent.id);assert.notEqual(preview.database,parent.database);
      const running=await runtime(preview),config=ServerConfig.parse(await json(join(preview.root,'server.json')));
      const fetchState=async()=>{const current=await runtime(preview!);const response=await fetch(current!.serverUrl+'/api/state',{headers:{authorization:'Bearer '+config.token}});return response.json() as Promise<{note:string;count:number}>;};
      let result:{note:string;count:number}|undefined;
      for(let tries=0;tries<50;tries++){result=await fetchState();if(result.note.startsWith('{'))break;await new Promise(r=>setTimeout(r,200));}
      assert.ok(result);assert.ok(result.note.startsWith('{'),'Candidate renderer must load and finish the access probes.');
      const capture=await control(preview,'capture') as {png:string};await mkdir(join(ws.checkout,'out','adapt-preview'),{recursive:true});await writeFile(join(ws.checkout,'out','adapt-preview','native.png'),Buffer.from(capture.png,'base64'));
      assert.deepEqual(JSON.parse(result.note),{require:'undefined',process:'undefined',media:'undefined',recording:'undefined',file:true,viteFile:true,editor:true,otherInstance:true,adapt:false,model:'deterministic',identity:workspaceId});
      assert.equal(outsideRequests,0,'Outside HTTP listener must receive no request.');assert.equal(udpPackets,0,'WebRTC must not bypass the proxy with direct UDP.');
      await fetch(running!.serverUrl+'/api/state',{method:'PATCH',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},body:JSON.stringify({increment:true})});
      await command('refresh');await wait('running');
      await command('stop');await wait('stopped');assert.equal((await runtime(preview))?.phase,'stopped');
      await launch(first);await wait('running');assert.equal((await fetchState()).count,result.count+1);
      // A completed checkpoint follows an open preview without another Run click.
      await writeFile(join(directory,'packages/client/src/renderer/preview-follow.ts'),'export const followed = true;\n');
      const next=await checkpoint();
      const sync=()=>nativePreview('sync',ownerPath,{workspaceId,threadId,checkpoint:next});
      await sync();assert.equal((await wait('running')).checkpointId,next.id);assert.equal((await fetchState()).count,result.count+1);
      await sync();assert.equal((await status()).phase,'running','Same-checkpoint sync must not restart the preview.');
      // Simulate the native window's red close button by ending only Electron.
      const desktop=(await runtime(preview))!.desktop;assert.ok(desktop);await stopProcess(desktop,true);
      const closed=await wait('stopped');assert.equal(closed.running,false);
      await sync();assert.equal((await status()).running,false,'Automatic sync must not reopen a manually closed preview.');
      await command('refresh');assert.equal((await status()).phase,'stopped','A late Refresh after closing must be harmless.');
      await launch(next);await wait('running');assert.equal((await fetchState()).count,result.count+1);
      assert.equal((await ServerConfig.parse(await json(join(parent.root,'server.json')))).candidatePreview,undefined);
    });
    await scenarioStep(t,'adapt-preview-protected-paths',async()=>{
      const backend=join(directory,'packages/server/src/main.ts');await writeFile(backend,(await readFile(backend,'utf8'))+'\nthrow Error("must never execute");\n');
      await launch(await checkpoint());const until=Date.now()+20000;let result=await status();while(Date.now()<until&&result.phase==='preparing'){await new Promise(r=>setTimeout(r,200));result=await status();}assert.equal(result.phase,'failed');assert.match(result.message,/only ordinary files/);
      assert.equal((await runtime(preview!))?.phase,'ready','Rejected candidate must leave the previous preview intact.');assert.equal(result.running,true,'Previous preview must remain stoppable.');
      await git(directory,['restore','--source='+base.tree,'--staged','--worktree','packages/server/src/main.ts']);
      await writeFile(join(directory,'packages/client/src/renderer/blocked.css'),'@import '+JSON.stringify(canary)+';');
      await launch(await checkpoint());let css=await status();while(css.phase==='preparing'){await new Promise(r=>setTimeout(r,200));css=await status();}assert.equal(css.phase,'failed');assert.match(css.message,/plain CSS/);
    });
  }finally{
    const owned=await json<{instanceId:string}>(join(parent.root,'adapt','previews',workspaceId,'preview.json')).catch(()=>null);
    if(owned){const child=await readInstance(ws,owned.instanceId).catch(()=>null);if(child&&(await status()).phase==='failed'){for(const name of ['server.log','supervisor.log'])console.log('Preview '+name+': '+(await readFile(join(child.root,'logs',name),'utf8').catch(()=>'' )).slice(-8000));}}
    await nativePreview('dispose',ownerPath,{workspaceId});await disposeInstance(ws,parent.id);await new Promise<void>(resolve=>canaryServer.close(()=>resolve()));udp.close();await rm(directory,{recursive:true,force:true});
  }
});
