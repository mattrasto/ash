import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { open,mkdir,rm,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Instance,Uuid,ServerConfig,AdaptCheckpoint,AdaptPreviewCommand,type AdaptPreviewState } from '../../packages/shared/src/index.ts';
import { AdaptSources } from '../../packages/server/src/modules/adapt/source.ts';
import { atomic,json,id,withLock,exists,processRef,alive,stopProcess,type ProcessRef } from './io.ts';
import { workspace,readInstance,createInstance,instancePath } from './workspace.ts';
import {prepareRenderer} from './renderer-candidate.ts';
import {buildProtectedRenderer} from './protected-renderer.ts';
import { startInstance,stopInstance,runtime,control,disposeInstance } from './lifecycle.ts';

type State=AdaptPreviewState & {owner:string;workspaceId:string;instanceId:string;submissionId?:string;worker?:ProcessRef;startedAt?:number;request?:ReturnType<typeof request.parse>};
const request={parse(value:unknown){const data=value as Record<string,unknown>;return {workspaceId:Uuid.parse(data.workspaceId),threadId:Uuid.parse(data.threadId),checkpoint:AdaptCheckpoint.nullable().parse(data.checkpoint),command:AdaptPreviewCommand.parse(data.command),automatic:data.automatic===true};}};
const stopped:AdaptPreviewState={phase:'stopped',running:false,message:'UI preview stopped.'};

export async function nativePreview(action:string,parentPath:string,input:unknown):Promise<AdaptPreviewState>{
  const parent=Instance.parse(await json(parentPath)),ws=await workspace(parent.checkout,parent.devRoot);
  if((await readInstance(ws,parent.id)).generation!==parent.generation)throw new Error('Preview owner generation changed.');
  const workspaceId=Uuid.parse((input as {workspaceId:unknown}).workspaceId);
  const root=join(parent.root,'adapt','previews',workspaceId),manifest=join(root,'preview.json');
  const read=async()=>{if(!await exists(manifest))return null;const state=await json<State>(manifest);if(state.owner!==parent.id+':'+parent.generation||state.workspaceId!==workspaceId||!/^[a-f0-9]{24}$/.test(state.instanceId))throw new Error('Preview ownership mismatch.');return state;};
  const view=(state:State|null):AdaptPreviewState=>state?{phase:state.phase,running:state.running??state.phase==='running',message:state.message,checkpointId:state.checkpointId,tree:state.tree}:stopped;
  const isRunning=async(state:State|null)=>{
    if(!state)return false;
    const instance=await readInstance(ws,state.instanceId).catch(()=>null),current=instance?await runtime(instance):null;
    return !!(current?.phase==='ready'&&current.desktop&&await alive(current.supervisor)&&await alive(current.desktop));
  };
  // Status reads atomically published state without waiting for a long startup lock.
  if(action==='status'){
    const state=await read();
    if(state?.phase==='preparing'&&((state.worker&&!await alive(state.worker))||(!state.worker&&Date.now()-(state.startedAt??0)>10000)))return {...view(state),phase:'failed',message:'Preview preparation was interrupted. Run again to recover.'};
    if(state?.phase==='preparing')return view(state);
    if(state?.phase==='running'||state?.running){
      if(!await isRunning(state))return {...view(state),phase:state.phase==='failed'?'failed':'stopped',running:false,message:state.phase==='failed'?state.message:'UI preview closed.'};
    }
    return view(state);
  }
  if(action==='sync'){
    // Do not queue behind a long preparation. The durable coordinator retries it.
    const state=await read();
    if(state?.phase==='preparing'&&(state.worker?await alive(state.worker):Date.now()-(state.startedAt??0)<=10000))return view(state);
  }
  return withLock(parent.devRoot,'adapt-preview-'+parent.id+'-'+workspaceId,async()=>{
    let state=await read();
    if(state?.phase==='preparing'&&((state.worker&&!await alive(state.worker))||(!state.worker&&Date.now()-(state.startedAt??0)>10000))){state={...state,phase:'failed',message:'Preview preparation was interrupted. Run again to recover.',worker:undefined};await atomic(manifest,state);}
    if(action==='dispose'){
      if(state){if(state.phase==='preparing')throw new Error('Wait for preview preparation before disposal.');if(await exists(join(instancePath(ws,state.instanceId),'instance.json')))await disposeInstance(ws,state.instanceId);await rm(root,{recursive:true,force:true});}return stopped;
    }
    if(action==='request'||action==='sync'){
      const checkpoint=action==='sync'?AdaptCheckpoint.nullable().parse((input as {checkpoint:unknown}).checkpoint):null;
      if(action==='sync'&&!checkpoint)return view(state);
      const data=request.parse(action==='sync'?{...input as object,automatic:true,command:{action:'run',submissionId:checkpoint?.id}}:input);
      if(action==='sync'&&(!checkpoint||!await isRunning(state)))return {...view(state),phase:'stopped',running:false,message:'UI preview closed.'};
      if(action==='sync'&&state?.checkpointId===checkpoint?.id)return view(state);
      if(action==='sync'&&state?.tree===checkpoint?.tree){state={...state!,checkpointId:checkpoint!.id};await atomic(manifest,state);return view(state);}
      const receipt=join(root,'requests',data.command.submissionId+'.json');
      if(await exists(receipt)){const saved=await json<{action:string;checkpointId:string|null}>(receipt);if(saved.action!==data.command.action||saved.checkpointId!==(data.checkpoint?.id??null))throw new Error('Preview command identity was reused with different content.');return view(state);}
      if(state?.submissionId===data.command.submissionId)return view(state);
      if(state?.phase==='preparing')throw new Error('Preview is preparing. Wait before another action.');
      if(data.command.action==='run'&&!data.checkpoint)throw new Error('Finish a coding turn before running its preview.');
      if(data.command.action!=='run'&&!state)return stopped;
      if(data.command.action==='refresh'&&!await isRunning(state))return {...view(state),...stopped};
      await mkdir(root,{recursive:true,mode:0o700});
      state={...state,owner:parent.id+':'+parent.generation,workspaceId,instanceId:state?.instanceId??id(),phase:'preparing',startedAt:Date.now(),message:data.command.action==='stop'?'Stopping preview…':state?.running?'Updating preview…':'Starting preview…',request:data,submissionId:data.command.submissionId};
      await atomic(manifest,state);await atomic(receipt,{action:data.command.action,checkpointId:data.checkpoint?.id??null});
      const require=createRequire(join(parent.checkout,'package.json')),log=await open(join(root,'controller.log'),'a',0o600);
      const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(parent.checkout,'scripts/dev/adapt-preview-cli.ts'),'perform',parentPath,workspaceId],{cwd:parent.checkout,detached:true,stdio:['ignore',log.fd,log.fd],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:join(parent.root,'tmp')}});child.unref();await log.close();
      state.worker=await processRef(child.pid!);await atomic(manifest,state);return view(state);
    }
    if(action!=='perform'||!state?.request)throw new Error('Invalid preview operation.');
    try{
      const data=state.request;
      if(data.automatic&&!await isRunning(state)){state={...state,...stopped};}
      else if(data.command.action==='stop'){await stopInstance(ws,state.instanceId);state={...state,...stopped};}
      else if(data.command.action==='refresh'){
        const instance=await readInstance(ws,state.instanceId);await control(instance,'refresh');state={...state,phase:'running',running:true,message:'UI preview refreshed.'};
      }else if(state.checkpointId===data.checkpoint?.id&&await isRunning(state)){
        await control(await readInstance(ws,state.instanceId),'open',{windowed:true,background:parent.profile!=='preview'});state={...state,phase:'running',running:true,message:'UI preview running · isolated test data.'};
      }else{
        const checkpoint=data.checkpoint!;
        const candidate=join(root,'candidate-'+checkpoint.id),sources=new AdaptSources(parent.checkout,join(parent.root,'adapt','sources'));
        // Validate before stopping the previous preview or creating another runtime.
        if(!await exists(candidate))await sources.materialize(await sources.snapshot(checkpoint.baseRevision),checkpoint,candidate);
        await prepareRenderer(candidate,(await sources.snapshot(checkpoint.baseRevision)).tree,parent.checkout);
        const rendererBuild=join(root,'build-'+checkpoint.id);await buildProtectedRenderer(candidate,rendererBuild,parent.checkout);
        if(data.automatic&&!await isRunning(state)){state={...state,...stopped};delete state.worker;delete state.request;await atomic(manifest,state);return view(state);}
        let instance=await createInstance(ws,'test','scratchpad',state.instanceId);await stopInstance(ws,instance.id);
        instance={...instance,label:'Adapt preview · '+workspaceId.slice(0,6)+' · '+checkpoint.tree.slice(0,7)};
        await atomic(join(instance.root,'instance.json'),instance);
        const config=ServerConfig.parse(await json(join(instance.root,'server.json')));
        await atomic(join(instance.root,'server.json'),{...config,instance,candidatePreview:{ownerInstancePath:parentPath,workspaceId,threadId:data.threadId,checkpointId:checkpoint.id,baseRevision:checkpoint.baseRevision,tree:checkpoint.tree,checkout:candidate,rendererBuild}});
        await startInstance(ws,instance.id,{windowed:true,background:parent.profile!=='preview'});
        state={...state,phase:'running',running:true,message:'UI preview running · isolated test data.',checkpointId:checkpoint.id,tree:checkpoint.tree};
      }
    }catch(error){state={...state,phase:'failed',message:(error instanceof Error?error.message:'Preview failed.').slice(0,2000)};}
    delete state.worker;delete state.request;await atomic(manifest,state);return view(state);
  });
}
export async function disposeOwnedPreviews(parent:Instance){
  const root=join(parent.root,'adapt','previews');
  for(const workspaceId of await readdir(root).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;})){
    if(!/^[a-f0-9-]{36}$/.test(workspaceId))throw new Error('Unknown resource in owned preview directory.');
    const state=await json<State>(join(root,workspaceId,'preview.json'));
    if(state.owner!==parent.id+':'+parent.generation)throw new Error('Refusing to dispose another instance’s preview.');
    if(state.worker&&await alive(state.worker)){
      if(!state.worker.identity.includes(join(parent.root,'instance.json')))throw new Error('Preview worker ownership mismatch.');
      await stopProcess(state.worker,true);
    }
    await nativePreview('dispose',join(parent.root,'instance.json'),{workspaceId});
  }
}
