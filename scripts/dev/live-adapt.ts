// Explicit paid check; excluded from deterministic verification. Two coding Runs, each with a 12-minute deadline; native preview and screenshot feedback.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerConfig } from '../../packages/shared/src/index.ts';
import { readOpenAIKey } from '../../packages/server/src/platform/models/credentials.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { Adapt } from '../../packages/server/src/modules/adapt/service.ts';
import { AdaptSources } from '../../packages/server/src/modules/adapt/source.ts';
import { managedCodex } from '../../packages/server/src/platform/adapt/codex.ts';
import { localPreview } from '../../packages/server/src/platform/adapt/local-preview.ts';
import { ImageStorage } from '../../packages/server/src/modules/attachments/storage.ts';
import { Attachments } from '../../packages/server/src/modules/attachments/service.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import { Decisions } from '../../packages/server/src/modules/decisions/service.ts';
import { workspace,createInstance,readInstance } from './workspace.ts';
import { disposeInstance,control } from './lifecycle.ts';
import { devRoot,json } from './io.ts';

const checkout=process.cwd(),ws=await workspace(checkout,await devRoot());
const key=await readOpenAIKey(checkout);
const binding=managedCodex(key,async(url,options)=>{
  const response=await fetch(url,options);if(!response.ok){const body=await response.clone().json().catch(()=>({}));console.error(JSON.stringify({providerStatus:response.status,code:body.error?.code,param:body.error?.param,message:String(body.error?.message??'').replaceAll(key,'[redacted]').slice(0,500)}));}return response;
});
const instance=await createInstance(ws,'test','empty'),config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl);
const directory=join(checkout,'out','adapt-live',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(directory,{recursive:true,mode:0o700});
const decisions=new Decisions(db),sources=new AdaptSources(checkout,join(instance.root,'adapt','sources'));
const images=new ImageStorage(instance.root);await images.prepare();const previews=localPreview(instance),attachments=new Attachments(db,images,deterministicModel);
let adapt=new Adapt(db,sources,binding,decisions,images,previews),threads=new Threads(db,undefined,true,images,undefined,undefined,decisions,undefined,undefined,adapt);
const services=[threads],thread=randomUUID();let runId:string|undefined,last='',restarted=false;
const deadline=Date.now()+12*60*1000;
try{
  await threads.createThread(thread,'Live Adapt verification');await adapt.mode(thread,{mode:'adapt',expectedMode:'chat'});
  const run=await threads.submit(thread,randomUUID(),'Before editing, use ash_ask_user once to ask "Which empty Thread label should be used?". Wait for its answer. Then change only packages/client/src/renderer/features/threads/Chat.svelte: replace the empty Thread paragraph "Ask a question, share an image, or start with a thought." with the exact answer. Run pnpm verify --profile quick, report actual outcomes and export the requested source checkpoint. Do not edit tests, lockfiles or verification policy.','normal');runId=run.id;
  while(Date.now()<deadline){
    await adapt.pump(id=>threads.dispatch(id));
    const detail=await threads.readThread(thread),current=detail.runs.find(r=>r.id===run.id)!;
    const signature=JSON.stringify({status:current.status,phase:current.state.adapt?.phase,message:current.state.adapt?.message});if(signature!==last){console.log(signature);last=signature;}
    const question=(await decisions.list(thread)).find(d=>d.status==='pending');
    if(question){
      assert.equal(question.request.question,'Which empty Thread label should be used?');
      if(!restarted){await threads.stop();adapt=new Adapt(db,sources,binding,decisions,images,previews);threads=new Threads(db,undefined,true,images,undefined,undefined,decisions,undefined,undefined,adapt);services.push(threads);await threads.recover();restarted=true;}
      const answer={submissionId:randomUUID(),value:'Describe a change, then try the preview.'};await decisions.answer(question.id,answer);await decisions.answer(question.id,answer);
    }
    if(['failed','cancelled','interrupted'].includes(current.status))throw new Error(JSON.stringify(current.error));
    if(current.status==='completed'){
      assert.ok(restarted);const checkpoint=detail.workspace!.checkpoint!;assert.ok(checkpoint.patch.includes('+Describe a change, then try the preview.')||checkpoint.patch.includes('Describe a change, then try the preview.'));assert.ok(checkpoint.checks);
      const inspection=await threads.inspect(run.state.request_artifact_id);assert.ok(inspection.artifacts.some(a=>a.payload.type==='coding_evidence'));
      await writeFile(join(directory,'candidate.patch'),checkpoint.patch,{mode:0o600});await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,threadId:thread,runId:run.id,restartedWhileWaiting:restarted,baseRevision:checkpoint.baseRevision,tree:checkpoint.tree,checks:checkpoint.checks},null,2),{mode:0o600});
      console.log(JSON.stringify({passed:true,evidence:directory,tree:checkpoint.tree}));break;
    }
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  if((await db.run.findUniqueOrThrow({where:{id:runId!}})).status!=='completed')throw new Error('Live Adapt deadline reached.');
  const original=(await threads.readThread(thread)).workspace!;
  await adapt.preview(thread,{action:'run',submissionId:randomUUID()});
  const waitPreview=async(tree:string)=>{for(let attempt=0;attempt<120;attempt++){const state=await previews.status(original.id);if(state.phase==='failed')throw Error(state.message);if(state.phase==='running'&&state.tree===tree)return;await new Promise(r=>setTimeout(r,500));}throw Error('Native preview timed out.');};
  await waitPreview(original.checkpoint!.tree);
  const manifest=await json<{instanceId:string}>(join(instance.root,'adapt','previews',original.id,'preview.json'));
  const preview=await readInstance(ws,manifest.instanceId);
  const capture=await control(preview,'capture') as {png:string},png=Buffer.from(capture.png,'base64');
  await writeFile(join(directory,'native-preview.png'),png);
  const imageId=randomUUID();await attachments.upload(imageId,'native-preview.png',png);
  const followup=await threads.submit(thread,randomUUID(),'This screenshot is the native preview of checkpoint '+original.checkpoint!.tree+'. Continue in the same Workspace. In the empty Thread paragraph you just changed, append exactly " Your workspace is isolated.". Keep the previous sentence and all other source unchanged. Use the screenshot as UI evidence, run pnpm verify --profile quick and export the full cumulative checkpoint. Do not ask another question.', 'normal',[imageId]);
  runId=followup.id;const followupDeadline=Date.now()+12*60*1000;
  while(Date.now()<followupDeadline){
    await adapt.pump(id=>threads.dispatch(id));const current=await db.run.findUniqueOrThrow({where:{id:followup.id}});
    if(['failed','cancelled','interrupted'].includes(current.status))throw Error(JSON.stringify(current.error));
    if(current.status==='completed')break;await new Promise(r=>setTimeout(r,1500));
  }
  assert.equal((await db.run.findUniqueOrThrow({where:{id:followup.id}})).status,'completed');
  const updated=(await threads.readThread(thread)).workspace!;assert.equal(updated.id,original.id);assert.ok(updated.checkpoint!.patch.includes('Your workspace is isolated.'));
  await adapt.preview(thread,{action:'run',submissionId:randomUUID()});await waitPreview(updated.checkpoint!.tree);
  await writeFile(join(directory,'followup.patch'),updated.checkpoint!.patch);
  await writeFile(join(directory,'feedback.json'),JSON.stringify({passed:true,workspaceId:original.id,threadId:thread,runId:followup.id,screenshotBytes:png.length,baseRevision:updated.baseRevision,tree:updated.checkpoint!.tree,checks:updated.checkpoint!.checks},null,2));
  console.log(JSON.stringify({nativePreviewAndScreenshotFeedback:true,evidence:directory,tree:updated.checkpoint!.tree}));
}finally{
  if(runId)await threads.cancel(runId).catch(()=>{});
  for(const service of services)await service.stop();
  for(const row of await db.adaptExecution.findMany()){
    const controller=row.controller as {session?:{id:string}};if(controller.session){await binding.harness.cancel(controller.session,'cleanup-'+row.runId).catch(()=>{});await binding.harness.close(controller.session).catch(()=>{});}
  }
  await attachments.stop();await db.$disconnect();await disposeInstance(ws,instance.id);
}
