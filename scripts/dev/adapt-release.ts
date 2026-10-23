import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {_electron} from 'playwright';
import {Instance,Uuid,ServerConfig,AdaptCandidateEvidence,type AdaptApplicationView} from '../../packages/shared/src/index.ts';
import {AdaptSources,git} from '../../packages/server/src/modules/adapt/source.ts';
import {atomic,json,exists,withLock,processRef,alive,stopProcess,fingerprint,exec,childEnvironment,type ProcessRef} from './io.ts';
import {workspace,readInstance,createInstance,instancePath} from './workspace.ts';
import {startInstance,disposeInstance,control,runtime} from './lifecycle.ts';
import {prepareRenderer} from './renderer-candidate.ts';
import {buildMain} from './build.ts';
import {buildProtectedRenderer} from './protected-renderer.ts';
import {ReleaseRequest,type ReleaseJob,type ReleaseVersion,readJob,readVersion,readActive,installedVersion,releaseRoot,jobPath,versionRoot,owner,directoryDigest} from './release-store.ts';

async function view(instance:Instance,candidateId?:string):Promise<AdaptApplicationView>{
  const active=await readActive(instance),version=await installedVersion(instance);
  if(!candidateId||!await exists(jobPath(instance,candidateId)))return {phase:'idle',message:'Prepare a verified build, then approve the exact update.',installedVersion:version,canRestore:!!active?.previous};
  const job=await readJob(instance,candidateId);
  if(job.phase==='preparing'&&((job.worker&&!await alive(job.worker))||(!job.worker&&Date.now()-job.startedAt>10000))){job.phase='failed';job.message='Update preparation was interrupted. Prepare a new candidate.';}
  return {candidateId,checkpointId:job.request.checkpoint.id,action:job.request.action,phase:job.phase,message:job.message,evidence:job.evidence,installedVersion:version,canRestore:!!active?.previous};
}
async function launch(instance:Instance,mode:'verify'|'install',job:ReleaseJob){
  const require=createRequire(join(instance.checkout,'package.json')),log=await open(join(releaseRoot(instance),'controller.log'),'a',0o600);
  const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(instance.checkout,'scripts/dev/adapt-release-cli.ts'),mode,join(instance.root,'instance.json')],{cwd:instance.checkout,detached:true,stdio:['pipe',log.fd,log.fd],env:childEnvironment(join(instance.root,'tmp'))});
  child.stdin!.end(JSON.stringify({candidateId:job.request.candidateId}));child.unref();await log.close();
  job.worker=await processRef(child.pid!);await atomic(jobPath(instance,job.request.candidateId),job);
}
export async function localRelease(action:string,parentPath:string,input:unknown):Promise<AdaptApplicationView|import('../../packages/shared/src/index.ts').AdaptRefreshResult>{
  const instance=Instance.parse(await json(parentPath)),ws=await workspace(instance.checkout,instance.devRoot);
  if((await readInstance(ws,instance.id)).generation!==instance.generation)throw Error('Application owner generation changed.');
  const data=input as {candidateId?:string;decisionId?:string};
  const candidateId=data.candidateId?Uuid.parse(data.candidateId):undefined;
  if(action==='refresh')return (await import('./adapt-refresh.ts')).refreshWorkspace(instance,input);
  if(action==='status')return view(instance,candidateId);
  if(action==='prepare'){
    const request=ReleaseRequest.parse(input);
    await withLock(instance.devRoot,'adapt-release-request-'+instance.id,async()=>{
      if(await exists(jobPath(instance,request.candidateId))){const old=await readJob(instance,request.candidateId);if(JSON.stringify(old.request)!==JSON.stringify(request))throw Error('Application identity was reused with different content.');return;}
      const job:ReleaseJob={owner:owner(instance),request,targetVersion:await installedVersion(instance),phase:'preparing',message:'Checking and building the UI update…',startedAt:Date.now()};
      await atomic(jobPath(instance,request.candidateId),job);await launch(instance,'verify',job);
    });return view(instance,request.candidateId);
  }
  if(!candidateId)throw Error('An application candidate is required.');
  if(action==='apply'){
    const decisionId=Uuid.parse(data.decisionId);
    await withLock(instance.devRoot,'adapt-release-request-'+instance.id,async()=>{
      const job=await readJob(instance,candidateId);
      if(job.decisionId&&job.decisionId!==decisionId)throw Error('Application already belongs to a different Decision.');
      if(!['ready','applying'].includes(job.phase)||job.worker&&await alive(job.worker))return;
      job.decisionId=decisionId;job.phase='applying';job.message='Applying and restarting…';await atomic(jobPath(instance,candidateId),job);await launch(instance,'install',job);
    });return view(instance,candidateId);
  }
  if(action==='verify'){
    await withLock(instance.devRoot,'adapt-release-build-'+instance.id,async()=>{
      let job=await readJob(instance,candidateId);
      try{job=await prepare(instance,job);job.phase='ready';job.message='Protected UI checks passed. Review the exact update before applying it.';}
      catch(error){job.phase='failed';job.message=(error instanceof Error?error.message:'UI update verification failed.').slice(0,2000);}
      delete job.worker;await atomic(jobPath(instance,candidateId),job);
    });return view(instance,candidateId);
  }
  if(action==='install'){
    const job=await readJob(instance,candidateId);
    try{await control(instance,'install/'+candidateId+'/'+Uuid.parse(job.decisionId));}
    catch{const current=await readJob(instance,candidateId);if(current.phase==='applying'){current.message='Application was interrupted. Reconnecting to the saved operation.';delete current.worker;await atomic(jobPath(instance,candidateId),current);}}
    return view(instance,candidateId);
  }
  throw Error('Unknown application operation.');
}

async function prepare(instance:Instance,job:ReleaseJob):Promise<ReleaseJob>{
  // Candidate-controlled manifests, dependencies, scripts and checks never run.
  if(await git(instance.checkout,['status','--porcelain','--untracked-files=no','--','packages','scripts','package.json','pnpm-lock.yaml','tsconfig.json']))throw Error('Checkpoint the current developer build before preparing an update.');
  const before=await fingerprint(instance.checkout),sources=new AdaptSources(instance.checkout,join(releaseRoot(instance),'sources'));
  const base=await sources.snapshot(before.commit),root=versionRoot(instance,job.request.candidateId);
  if(await installedVersion(instance)!==job.targetVersion)throw Error('Installed version changed during preparation. Prepare again.');
  if(job.request.action==='restore'){
    const active=await readActive(instance);if(!active?.previous)throw Error('No previous runnable version is available.');
    const previous=await readVersion(instance,active.previous);if(previous.trustedHash!==before.hash)throw Error('The previous UI belongs to a different trusted backend build.');
    job.evidence=AdaptCandidateEvidence.parse({type:'adapt_candidate',candidateId:job.request.candidateId,workspaceId:job.request.workspaceId,checkpointId:null,action:'restore',targetVersion:job.targetVersion,versionId:previous.id,sourceTree:previous.sourceTree,buildDigest:previous.buildDigest,policy:'renderer-release-v1',checks:previous.checks});return job;
  }
  const active=await readActive(instance);
  if(active){const current=await readVersion(instance,active.current);if(job.request.baselineVersion!==active.current)throw Error('Refresh Workspace against the installed version before preparing an update.');}
  await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true,mode:0o700});
  const downloaded=join(root,'workspace-source');await sources.materialize(await sources.snapshot(job.request.checkpoint.baseRevision),job.request.checkpoint,downloaded);
  await prepareRenderer(downloaded,(await sources.snapshot(job.request.checkpoint.baseRevision)).tree,instance.checkout);
  const candidate=join(root,'source');await sources.materialize(base,{patch:'',tree:base.tree},candidate);
  await writeFile(join(candidate,'.git','application.patch'),job.request.checkpoint.patch,{mode:0o600});
  try{if(job.request.checkpoint.patch)await git(candidate,['apply','--index','--whitespace=nowarn',join(candidate,'.git','application.patch')]);}
  catch{throw Error('The Workspace patch conflicts with the current app. Refresh the change before applying.');}
  await prepareRenderer(candidate,base.tree,instance.checkout);
  const sourceTree=await git(candidate,['write-tree']);
  await checkTypes(instance,candidate);
  const build=join(root,'build');await buildProtectedRenderer(candidate,build,instance.checkout);
  const version:ReleaseVersion={id:job.request.candidateId,owner:owner(instance),trustedCommit:before.commit,trustedHash:before.hash,sourceTree,buildDigest:await directoryDigest(join(build,'renderer')),workspaceId:job.request.workspaceId,checkpoint:job.request.checkpoint,checks:'Protected renderer path checks, TypeScript/Svelte checks, production build and isolated persisted-chat smoke check passed.'};
  await atomic(join(root,'version.json'),version);
  await smoke(instance,job,candidate,version);
  if(!active){
    const baselineId=randomUUID(),baselineRoot=versionRoot(instance,baselineId),baselineSource=join(baselineRoot,'source');
    await mkdir(baselineRoot,{recursive:true,mode:0o700});await sources.materialize(base,{patch:'',tree:base.tree},baselineSource);await prepareRenderer(baselineSource,base.tree,instance.checkout);
    await buildProtectedRenderer(baselineSource,join(baselineRoot,'build'),instance.checkout);
    await atomic(join(baselineRoot,'version.json'),{...version,checkpoint:undefined,id:baselineId,workspaceId:null,sourceTree:base.tree,buildDigest:await directoryDigest(join(baselineRoot,'build','renderer')),checks:'Retained trusted UI baseline.'});
    await smoke(instance,job,baselineSource,await readVersion(instance,baselineId));
    job.baselineVersionId=baselineId;
  }
  if((await fingerprint(instance.checkout)).hash!==before.hash||await installedVersion(instance)!==job.targetVersion)throw Error('The app changed during verification. Prepare a new update.');
  job.evidence=AdaptCandidateEvidence.parse({type:'adapt_candidate',candidateId:job.request.candidateId,workspaceId:job.request.workspaceId,checkpointId:job.request.checkpoint.id,action:'apply',targetVersion:job.targetVersion,versionId:version.id,sourceTree,buildDigest:version.buildDigest,policy:'renderer-release-v1',checks:version.checks});return job;
}
async function checkTypes(instance:Instance,candidate:string){
  const require=createRequire(join(instance.checkout,'package.json')),config=join(candidate,'.git','protected-types.json');
  await writeFile(config,JSON.stringify({extends:join(instance.checkout,'tsconfig.json'),include:[join(candidate,'packages/client/src/renderer/**/*.ts'),join(candidate,'packages/client/src/renderer/**/*.svelte')],exclude:[]}));
  try{await exec(process.execPath,[require.resolve('svelte-check/bin/svelte-check'),'--workspace',join(candidate,'packages/client'),'--tsconfig',config],{cwd:candidate,env:childEnvironment(join(instance.root,'tmp')),timeout:60000,maxBuffer:2*1024*1024});}
  catch(error){const result=error as {stdout?:string;stderr?:string};await writeFile(join(candidate,'.git','typecheck.log'),((result.stdout??'')+'\n'+(result.stderr??'')).slice(0,32000));throw Error('Protected TypeScript/Svelte checks failed. Fix the UI before applying.');}
}
async function smoke(instance:Instance,job:ReleaseJob,candidate:string,version:ReleaseVersion){
  const ws=await workspace(instance.checkout,instance.devRoot),testId=job.testInstanceId??randomUUID().replaceAll('-','').slice(0,24);job.testInstanceId=testId;await atomic(jobPath(instance,job.request.candidateId),job);
  const probe=await createInstance(ws,'test','scratchpad',testId);let app:Awaited<ReturnType<typeof _electron.launch>>|undefined;
  try{
    const config=ServerConfig.parse(await json(join(probe.root,'server.json')));
    await atomic(join(probe.root,'server.json'),{...config,candidatePreview:{workspaceId:job.request.workspaceId,threadId:job.request.threadId,checkpointId:job.request.checkpoint.id,baseRevision:version.trustedCommit,tree:version.sourceTree,checkout:candidate,ownerInstancePath:join(instance.root,'instance.json'),releaseId:version.id}});
    await startInstance(ws,testId,{headless:true,background:true});const state=(await runtime(probe))!;
    const main=await buildMain(instance.checkout,join(probe.root,'build')),client=join(probe.root,'release-client.json');
    await atomic(client,{root:probe.root,label:'Protected UI verification',instanceId:probe.id,url:state.webUrl,windowed:true,background:true,candidatePreview:true});
    const require=createRequire(join(instance.checkout,'package.json'));app=await _electron.launch({executablePath:require('electron'),args:[main],env:{...childEnvironment(join(probe.root,'tmp')),ASH_CLIENT_CONFIG:client} as Record<string,string>,timeout:20000});
    const page=await app.firstWindow();await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor({timeout:15000});
    // Supply only the restart lifecycle callback, without privileged native bridges.
    await page.addInitScript({content:"(()=>{let prepare;window.ashNavigation={onThread:()=>()=>{},onPrepareRestart:callback=>{prepare=callback;return()=>{}}};window.__protectedRestart=()=>prepare?.()})()"});
    await page.reload();await page.getByTestId('connection').filter({hasText:'Connected'}).waitFor({timeout:15000});
    const editor=page.getByRole('textbox',{name:'Message',exact:true});await editor.fill('Protected UI persisted-chat check.');await editor.press('Enter');
    await page.getByRole('article',{name:'Ash response',exact:true}).waitFor({timeout:15000});await page.reload();await page.getByRole('article',{name:'User message',exact:true}).filter({hasText:'Protected UI persisted-chat check.'}).waitFor({timeout:15000});
    await editor.fill('Protected unsent draft.');if(!await page.evaluate(()=>(window as any).__protectedRestart()))throw Error('Updated UI did not preserve the restart lifecycle.');
    await page.reload();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea')?.value==='Protected unsent draft.',undefined,{timeout:10000});
    const response=await fetch(state.serverUrl+'/api/threads',{headers:{authorization:'Bearer '+config.token}});if(!response.ok)throw Error('Persisted-chat verification failed.');
  }finally{await app?.close();await disposeInstance(ws,testId);delete job.testInstanceId;}
}
export async function disposeOwnedReleases(instance:Instance){
  const root=join(releaseRoot(instance),'jobs'),ws=await workspace(instance.checkout,instance.devRoot);
  for(const file of await readdir(root).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;})){
    const id=Uuid.parse(file.replace(/\.json$/,'')),job=await readJob(instance,id);
    if(job.worker&&await alive(job.worker)){if(!job.worker.identity.includes(join(instance.root,'instance.json')))throw Error('Application worker ownership mismatch.');await stopProcess(job.worker,true);}
    if(job.testInstanceId&&await exists(join(instancePath(ws,job.testInstanceId),'instance.json')))await disposeInstance(ws,job.testInstanceId);
  }
}
