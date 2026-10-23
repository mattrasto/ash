import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {AdaptCheckpoint,AdaptPreparation,AdaptCandidateEvidence,AdaptApplicationEvidence,PrepareAdaptApplication,CreateDecision,type AdaptApplicationView} from '@ash/shared';
import {Decisions,fingerprint,decisionView} from '../decisions/service.ts';
import {AdaptError,type ApplicationController} from './contract.ts';
import {workspaceController} from './controller.ts';
const json=(v:unknown)=>v as Prisma.InputJsonValue;
type Intent=NonNullable<ReturnType<typeof workspaceController.parse>['application']>;

export class AdaptApplications {
  private busy=false;
  constructor(readonly db:PrismaClient,readonly decisions:Decisions,readonly controller:ApplicationController){}
  async prepare(threadId:string,input:unknown){
    if(!this.controller.available)throw new AdaptError(409,this.controller.unavailableReason??'Local application is unavailable in this instance.');
    const command=PrepareAdaptApplication.parse(input),installed=await this.controller.status();
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM adapt_workspaces WHERE thread_id=${threadId}::uuid FOR UPDATE`;
      const workspace=await tx.adaptWorkspace.findUnique({where:{threadId}});if(!workspace?.checkpoint)throw new AdaptError(409,'Finish a coding turn before preparing an update.');
      const preparation=AdaptPreparation.parse({type:'adapt_preparation',candidateId:command.submissionId,workspaceId:workspace.id,checkpointId:command.checkpointId,action:command.action});
      const previous=await tx.artifact.findUnique({where:{id:command.submissionId}});
      if(previous){if(fingerprint(previous.payload)!==fingerprint(preparation))throw new AdaptError(409,'This application request ID was reused with different content.');return;}
      if(AdaptCheckpoint.parse(workspace.checkpoint).id!==command.checkpointId)throw new AdaptError(409,'The source changed. Review its latest checkpoint.');
      if(await tx.adaptExecution.findFirst({where:{workspaceId:workspace.id,run:{status:{in:['queued','running','waiting']}}}}))throw new AdaptError(409,'Finish or stop coding before preparing an update.');
      const control=workspaceController.parse(workspace.controller);
      if(command.action==='apply'&&control.integration?.conflicts.length)throw new AdaptError(409,'Resolve merge conflicts before preparing an update.');
      if(command.action==='apply'){if(!installed.installedVersion.startsWith('development:')&&control.integration?.version!==installed.installedVersion)throw new AdaptError(409,'Refresh Workspace against the installed version before preparing an update.');}
      if(control.application?.phase==='applying')throw new AdaptError(409,'Another application is still being reconciled.');
      if(control.application?.decisionId)await this.decisions.cancelIn(tx,control.application.decisionId,'A new update was prepared.');
      const now=new Date();
      await tx.artifact.create({data:{id:command.submissionId,layer:'act',actor:'user',threadId,sourceId:command.checkpointId,payload:preparation,createdAt:now,updatedAt:now}});
      control.application={candidateId:command.submissionId,checkpointId:command.checkpointId,action:command.action,phase:'preparing',evidenceId:randomUUID(),outcomeId:randomUUID()};
      await tx.adaptWorkspace.update({where:{id:workspace.id},data:{controller:json(control)}});
    });
    void this.pump().catch(()=>{});return this.view(threadId);
  }
  async view(threadId:string):Promise<AdaptApplicationView>{
    const workspace=await this.db.adaptWorkspace.findUnique({where:{threadId}}),intent=workspace?workspaceController.parse(workspace.controller).application:undefined;
    const control=workspace?workspaceController.parse(workspace.controller):undefined;
    const status={...await this.controller.status(intent?.candidateId)};
    if(intent?.phase==='applying'&&['applied','restored','rolled_back','failed','stale'].includes(status.phase)){status.phase='applying';status.message='Confirming the saved update outcome…';}
    status.needsRefresh=!status.installedVersion.startsWith('development:')?control?.integration?.version!==status.installedVersion:!!control?.integration&&!control.integration.version.startsWith('development:');status.conflicts=control?.integration?.conflicts??[];
    if(intent?.phase==='preparing'&&status.phase==='idle')return {...status,candidateId:intent.candidateId,checkpointId:intent.checkpointId,action:intent.action,phase:'preparing',message:'Checking and building the UI update…'};
    return intent?{...status,candidateId:intent.candidateId,checkpointId:intent.checkpointId,action:intent.action,decisionId:intent.decisionId,
      phase:['awaiting_approval','declined','stale'].includes(intent.phase)?intent.phase as AdaptApplicationView['phase']:status.phase,
      ...(intent.message?{message:intent.message}:{})}:status;
  }
  async pump(){
    if(this.busy||!this.controller.available)return;this.busy=true;
    try{
      for(const workspace of await this.db.adaptWorkspace.findMany()){
        const intent=workspaceController.parse(workspace.controller).application;
        if(!intent||['applied','restored','rolled_back','failed','stale','declined'].includes(intent.phase))continue;
        try{
          const checkpoint=AdaptCheckpoint.parse(workspace.checkpoint);
          if(checkpoint.id!==intent.checkpointId&&intent.phase!=='applying'){
            await this.update(workspace.id,intent,async(tx,current)=>{current.phase='stale';current.message='Newer changes need a new verification and approval.';if(current.decisionId)await this.decisions.cancelIn(tx,current.decisionId!,current.message);});continue;
          }
          const status=intent.phase==='preparing'?await this.controller.prepare({candidateId:intent.candidateId,workspaceId:workspace.id,threadId:workspace.threadId,checkpoint,action:intent.action,baselineVersion:workspaceController.parse(workspace.controller).integration?.version}):await this.controller.status(intent.candidateId);
          if(status.phase==='preparing')continue;
          if(status.phase==='ready'&&status.evidence&&status.evidence.targetVersion!==status.installedVersion){await this.update(workspace.id,intent,async(tx,current)=>{current.phase='stale';current.message='The installed version changed. Refresh Workspace, then prepare a new update.';if(current.decisionId)await this.decisions.cancelIn(tx,current.decisionId,current.message);});continue;}
          if(['failed','stale','applied','restored','rolled_back'].includes(status.phase)){
            await this.update(workspace.id,intent,async(tx,current,control)=>{
              current.phase=status.phase;current.message=status.message;
              if(status.phase==='applied')control.integration={version:status.installedVersion,baseline:checkpoint,conflicts:[]};
              if(current.decisionId&&status.evidence){
                const payload=AdaptApplicationEvidence.parse({type:'adapt_application',candidateId:current.candidateId,decisionId:current.decisionId,fromVersion:status.evidence.targetVersion,toVersion:status.evidence.versionId,outcome:status.phase,message:status.message});
                await tx.artifact.upsert({where:{id:current.outcomeId},create:{id:current.outcomeId,layer:'act',actor:'ash',threadId:workspace.threadId,sourceId:current.evidenceId,payload,createdAt:new Date(),updatedAt:new Date()},update:{}});
              }
              if(['failed','stale'].includes(status.phase)&&current.decisionId)await this.decisions.cancelIn(tx,current.decisionId,status.message);
            });continue;
          }
          if(status.phase==='ready'&&status.evidence&&!intent.decisionId){
            const evidence=AdaptCandidateEvidence.parse(status.evidence);
            await this.update(workspace.id,intent,async(tx,current)=>{
              if(current.decisionId)return;
              const now=new Date();
              await tx.artifact.upsert({where:{id:current.evidenceId},create:{id:current.evidenceId,layer:'act',actor:'ash',threadId:workspace.threadId,sourceId:current.candidateId,payload:evidence,createdAt:now,updatedAt:now},update:{}});
              const restore=evidence.action==='restore';
              const decision=await this.decisions.createIn(tx,CreateDecision.parse({id:randomUUID(),threadId:workspace.threadId,sourceArtifactId:current.evidenceId,request:{kind:'permission',form:'approval',question:restore?'Restore the previous version and restart?':'Apply these UI changes and restart?',reason:'This verified UI build will use your existing Ash data. Conversations and drafts are retained. The backend and database schema stay unchanged.',
                action:{operation:restore?'ash.restore':'ash.apply',resources:[{kind:'app',id:evidence.versionId,label:restore?'Previous Ash UI version':'Verified Ash UI update'}],effects:['write','control'],facts:{fromVersion:evidence.targetVersion,sourceTree:evidence.sourceTree,buildDigest:evidence.buildDigest}},binding:fingerprint(evidence),
                options:[{id:'approve',label:restore?'Restore and restart':'Apply and restart'},{id:'decline',label:'Keep working'}]}}));
              current.decisionId=decision.id;current.phase='awaiting_approval';
            });continue;
          }
          if(intent.decisionId){
            const decision=decisionView(await this.db.decision.findUniqueOrThrow({where:{id:intent.decisionId}}));
            if(['pending','snoozed'].includes(decision.status))continue;
            if(decision.resolution?.kind!=='answer'||decision.resolution.value!=='approve'){
              await this.update(workspace.id,intent,async(_tx,current)=>{current.phase='declined';current.message='Update left unapplied. Keep working or prepare another version.';});continue;
            }
            await this.update(workspace.id,intent,async(_tx,current)=>{current.phase='applying';delete current.message;});
            await this.controller.apply(intent.candidateId,intent.decisionId);
          }
        }catch{/* Persisted intent is reconciled on the next pass; no duplicate authority. */}
      }
    }finally{this.busy=false;}
  }
  private async update(workspaceId:string,expected:Intent,change:(tx:Prisma.TransactionClient,current:Intent,control:ReturnType<typeof workspaceController.parse>)=>Promise<void>){
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM adapt_workspaces WHERE id=${workspaceId}::uuid FOR UPDATE`;
      const workspace=await tx.adaptWorkspace.findUniqueOrThrow({where:{id:workspaceId}}),control=workspaceController.parse(workspace.controller);
      if(control.application?.candidateId!==expected.candidateId)return;
      await change(tx,control.application,control);await tx.adaptWorkspace.update({where:{id:workspaceId},data:{controller:json(control)}});
    });
  }
}
