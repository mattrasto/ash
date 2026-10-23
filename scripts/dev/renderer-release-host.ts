import {readFile,rm} from 'node:fs/promises';
import {join,resolve,sep,extname} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Instance,ServerConfig,AdaptCandidateEvidence,AdaptCheckpoint} from '../../packages/shared/src/index.ts';
import {connectProduct} from '../../packages/server/src/platform/db/client.ts';
import {decisionView,fingerprint} from '../../packages/server/src/modules/decisions/service.ts';
import {workspaceController} from '../../packages/server/src/modules/adapt/controller.ts';
import {atomic,json,withLock,fingerprint as sourceFingerprint} from './io.ts';
import {readActive,readVersion,readJob,versionRoot,jobPath,releaseRoot,installedVersion,type ActiveRelease} from './release-store.ts';

/** Runs in the trusted supervisor, which survives renderer replacement. */
export class RendererReleaseHost {
  private build:string|undefined;
  constructor(readonly instance:Instance,readonly restartAndCheck:()=>Promise<void>){}
  async initialize(){
    const active=await readActive(this.instance);if(!active)return;
    // An interrupted install is never silently treated as a successful update.
    if(!active.confirmed){
      if(!active.recovering&&!active.previous)throw Error('Interrupted application has no recovery version.');
      await atomic(join(releaseRoot(this.instance),'active.json'),{current:active.recovering?active.current:active.previous!,previous:active.recovering?active.previous:active.recoveryPrevious??null,operation:active.operation,confirmed:false,recovering:true,message:'Starting the previous UI after an interrupted application.'});
    }
    const current=await readActive(this.instance),version=await readVersion(this.instance,current!.current);
    if(version.trustedHash!==(await sourceFingerprint(this.instance.checkout)).hash){
      await atomic(join(releaseRoot(this.instance),'inactive-'+Date.now()+'.json'),current);
      await rm(join(releaseRoot(this.instance),'active.json'));this.build=undefined;return;
    }
    this.build=join(versionRoot(this.instance,version.id),'build','renderer');
  }
  async needsRecovery(){const active=await readActive(this.instance);return !!(active?.recovering&&!active.confirmed);}
  async confirmRecovery(){
    const active=await readActive(this.instance);if(!active?.recovering||active.confirmed)return;
    active.confirmed=true;delete active.recovering;active.message='Previous UI recovered after an interrupted application.';await atomic(join(releaseRoot(this.instance),'active.json'),active);
    if(active.operation){const job=await readJob(this.instance,active.operation);job.phase='rolled_back';job.message='Application was interrupted. The previous UI was restored and checked.';delete job.worker;await atomic(jobPath(this.instance,active.operation),job);}
  }
  middleware=(request:IncomingMessage,response:ServerResponse,next:()=>void)=>{
    if(!this.build||request.url?.startsWith('/api')||request.url?.startsWith('/health'))return next();
    const build=this.build;
    void(async()=>{
      const path=decodeURIComponent(new URL(request.url!,'http://127.0.0.1').pathname);
      const file=resolve(build,'.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(build+sep))throw Error('Invalid release path.');
      const bytes=await readFile(file);
      const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
      response.setHeader('content-type',mime[extname(file)]??'application/octet-stream');response.setHeader('cache-control','no-store');response.end(bytes);
    })().catch(()=>{response.writeHead(404).end('Release asset unavailable.');});
  };
  async serveVerifiedPreview(ownerPath:string,versionId:string){
    const parent=Instance.parse(await json(ownerPath));await readVersion(parent,versionId);
    this.build=join(versionRoot(parent,versionId),'build','renderer');
  }
  serveCompiledPreview(output:string){this.build=join(output,'renderer');}
  async install(candidateId:string,decisionId:string){
    return withLock(this.instance.devRoot,'adapt-install-'+this.instance.id,async()=>{
      const job=await readJob(this.instance,candidateId);
      if(['applied','restored','rolled_back','failed','stale'].includes(job.phase))return;
      const evidence=AdaptCandidateEvidence.parse(job.evidence),before=await readActive(this.instance);
      if(before?.recovering&&!before.confirmed&&before.operation===candidateId)return;
      if(before?.confirmed&&before.operation===candidateId){job.phase=evidence.action==='restore'?'restored':'applied';job.message='The verified UI version is running.';await atomic(jobPath(this.instance,candidateId),job);return;}
      const config=ServerConfig.parse(await json(join(this.instance.root,'server.json'))),db=connectProduct(config.databaseUrl);
      try{
        const decision=decisionView(await db.decision.findUniqueOrThrow({where:{id:decisionId}}));
        if(decision.threadId!==job.request.threadId||decision.request.kind!=='permission'||decision.request.binding!==fingerprint(evidence)||decision.resolution?.kind!=='answer'||decision.resolution.source!=='controls'||decision.resolution.value!=='approve')throw Error('This exact update has no valid application approval.');
        const workspace=await db.adaptWorkspace.findUniqueOrThrow({where:{id:job.request.workspaceId}});
        const intent=workspaceController.parse(workspace.controller).application;
        if(intent?.candidateId!==candidateId||intent.decisionId!==decisionId||decision.sourceArtifactId!==intent.evidenceId||decision.request.action?.operation!==(evidence.action==='restore'?'ash.restore':'ash.apply'))throw Error('The selected application or approval changed after review. Prepare a new update.');
        const capture=await db.artifact.findUniqueOrThrow({where:{id:intent.evidenceId}});
        if(fingerprint(capture.payload)!==fingerprint(evidence))throw Error('The captured application evidence changed.');
        if(AdaptCheckpoint.parse(workspace.checkpoint).id!==job.request.checkpoint.id)throw Error('The Workspace changed after review. Prepare and approve a new update.');
        if(await db.adaptExecution.findFirst({where:{workspaceId:workspace.id,run:{status:{in:['queued','running','waiting']}}}}))throw Error('Coding is still active in this Workspace.');
        if(await installedVersion(this.instance)!==evidence.targetVersion)throw Error('The installed version changed after verification. Prepare a new update.');
        const version=await readVersion(this.instance,evidence.versionId);
        if(version.buildDigest!==evidence.buildDigest||version.sourceTree!==evidence.sourceTree)throw Error('The reviewed build identity changed.');
        if(version.trustedHash!==(await sourceFingerprint(this.instance.checkout)).hash)throw Error('The trusted developer build changed after verification.');
        const previous=before?.current??job.baselineVersionId;if(!previous)throw Error('Previous runnable version is missing.');
        if((await readVersion(this.instance,previous)).trustedHash!==version.trustedHash)throw Error('Previous version is incompatible with the current trusted backend.');
        await db.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM adapt_workspaces WHERE id=${workspace.id}::uuid FOR UPDATE`;
          const locked=await tx.adaptWorkspace.findUniqueOrThrow({where:{id:workspace.id}}),saved=workspaceController.parse(locked.controller);
          if(saved.application?.candidateId!==candidateId||AdaptCheckpoint.parse(locked.checkpoint).id!==job.request.checkpoint.id||await tx.adaptExecution.findFirst({where:{workspaceId:workspace.id,run:{status:{in:['queued','running','waiting']}}}}))throw Error('The Workspace changed before application.');
          saved.application.phase='applying';await tx.adaptWorkspace.update({where:{id:workspace.id},data:{controller:saved}});
        });
        const active:ActiveRelease={current:version.id,previous,recoveryPrevious:before?.previous??null,operation:candidateId,confirmed:false,message:'Starting the approved UI version.'};
        job.phase='applying';job.decisionId=decisionId;job.message='Applying and restarting…';await atomic(jobPath(this.instance,candidateId),job);
        await atomic(join(releaseRoot(this.instance),'active.json'),active);
        this.build=join(versionRoot(this.instance,version.id),'build','renderer');
        try{
          await this.restartAndCheck();
          active.confirmed=true;delete active.recoveryPrevious;active.message='Verified UI version is running.';await atomic(join(releaseRoot(this.instance),'active.json'),active);
          job.phase=evidence.action==='restore'?'restored':'applied';job.message=evidence.action==='restore'?'Previous version restored. Conversations and drafts were kept.':'Update applied. Conversations and drafts were kept.';
        }catch{
          const recoveryVersion=await readVersion(this.instance,previous);
          this.build=join(versionRoot(this.instance,recoveryVersion.id),'build','renderer');
          const recovery:ActiveRelease={current:previous,previous:before?.previous??null,operation:candidateId,confirmed:false,recovering:true,message:'Starting the previous UI after failed application.'};
          await atomic(join(releaseRoot(this.instance),'active.json'),recovery);
          await this.restartAndCheck();recovery.confirmed=true;delete recovery.recovering;await atomic(join(releaseRoot(this.instance),'active.json'),recovery);job.phase='rolled_back';job.message='The update failed to start. The previous version was restored; your data was kept.';
        }
      }catch(error){
        job.phase=String(error).includes('changed')?'stale':'failed';job.message=(error instanceof Error?error.message:'Application failed.').slice(0,2000);
      }finally{await db.$disconnect();delete job.worker;await atomic(jobPath(this.instance,candidateId),job);}
    });
  }
}
