import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {AdaptCheckpoint,AdaptRefreshRequest,AdaptRefreshResult,type Instance} from '../../packages/shared/src/index.ts';
import {AdaptSources,git,gitOutput} from '../../packages/server/src/modules/adapt/source.ts';
import {json,atomic,exists,withLock} from './io.ts';
import {releaseRoot,readActive,readVersion,readJob,installedVersion} from './release-store.ts';

/** Pure Git reconciliation. Never runs a candidate command, compiler or hook. */
export async function refreshWorkspace(instance:Instance,input:unknown){
  const request=AdaptRefreshRequest.parse(input),root=join(releaseRoot(instance),'refreshes',request.submissionId),saved=join(root,'result.json');
  return withLock(instance.devRoot,'adapt-refresh-'+instance.id+'-'+request.submissionId,async()=>{
    if(await installedVersion(instance)!==request.version)throw Error('The installed version changed. Refresh again against the current version.');
    if(await exists(saved)){const prior=await json<{request:unknown;result:unknown}>(saved);if(JSON.stringify(prior.request)!==JSON.stringify(request))throw Error('Refresh identity was reused with different content.');return AdaptRefreshResult.parse(prior.result);}
    await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true,mode:0o700});
    const sources=new AdaptSources(instance.checkout,join(root,'archives')),base=await sources.snapshot(request.checkpoint.baseRevision),repo=join(root,'merged'),previous=join(root,'previous');
    await sources.materialize(base,request.checkpoint,repo);
    const original={...request.checkpoint,patch:'',tree:base.tree},baseline=request.baseline??original;
    if(baseline.baseRevision!==base.revision)throw Error('The Workspace integration baseline changed.');
    await sources.materialize(base,baseline,previous);
    const alternates=[join(previous,'.git','objects')];
    const active=await readActive(instance);let incoming=original;
    if(active){
      const version=await readVersion(instance,active.current);
      const checkpoint=version.checkpoint??(version.workspaceId?(await readJob(instance,version.id)).request.checkpoint:undefined);
      if(checkpoint){
        const incomingRepo=join(root,'installed'),incomingBase=await sources.snapshot(checkpoint.baseRevision);await sources.materialize(incomingBase,checkpoint,incomingRepo);alternates.push(join(incomingRepo,'.git','objects'));
        await writeFile(join(repo,'.git','objects','info','alternates'),alternates.join('\n')+'\n');
        if(checkpoint.baseRevision===base.revision)incoming=checkpoint;
        else {const converted=await merge(repo,incomingBase.tree,base.tree,checkpoint.tree);if(converted.conflicts.length)throw Error('The installed changes conflict with this Workspace’s older source base. Start a new Workspace from the current source before combining these changes.');incoming={...checkpoint,baseRevision:base.revision,tree:converted.tree};}
      }
    }
    await writeFile(join(repo,'.git','objects','info','alternates'),alternates.join('\n')+'\n');
    const merged=await merge(repo,baseline.tree,request.checkpoint.tree,incoming.tree),now=new Date().toISOString();
    const patch=async(tree:string)=>await gitOutput(repo,['diff','--binary',base.tree,tree]);
    const result=AdaptRefreshResult.parse({version:request.version,baseline:AdaptCheckpoint.parse({...original,id:request.submissionId,tree:incoming.tree,patch:await patch(incoming.tree),checks:'Installed source baseline for this Workspace.',createdAt:now}),checkpoint:AdaptCheckpoint.parse({...request.checkpoint,id:request.submissionId,tree:merged.tree,patch:await patch(merged.tree),checks:merged.conflicts.length?'Resolve merge conflicts before preview or Apply.':'Refreshed against the installed UI. Run coding checks and protected verification before Apply.',createdAt:now}),conflicts:merged.conflicts});
    if(await installedVersion(instance)!==request.version)throw Error('The installed version changed during refresh. Try again.');
    await atomic(saved,{request,result});return result;
  });
}
async function merge(repo:string,base:string,ours:string,theirs:string){
  const commit=async(tree:string,parent?:string)=>git(repo,['-c','user.name=Ash','-c','user.email=refresh@localhost','commit-tree',tree,...(parent?['-p',parent]:[]),'-m','Workspace refresh']);
  const common=await commit(base),left=await commit(ours,common),right=await commit(theirs,common);
  let output:string;
  try{output=await gitOutput(repo,['merge-tree','--write-tree','--name-only',left,right]);}
  catch(error){if((error as {code:number}).code!==1)throw error;output=(error as {stdout:string}).stdout;}
  const [tree,...paths]=output.split('\n\n')[0].trim().split('\n');if(!/^[a-f0-9]{40,64}$/.test(tree))throw Error('Git did not produce a refresh tree.');
  const conflicts=paths.filter(Boolean).map(path=>path.startsWith('"')?JSON.parse(path):path);return {tree,conflicts};
}
