import { randomUUID, createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Attachment, type Run } from '@prisma/client';
import { ImageMetadata, IMAGE_LIMITS, RequestPayload, RunState, DescriptionPayload, imageDescription,
  type AttachmentView, type ModelExecution } from '@ash/shared';
import { ModelFailure, type ModelAdapter } from '../../platform/models/adapter.ts';
import { runView } from '../conversations/views.ts';
import { ImageStorage, AttachmentError, processImage } from './storage.ts';

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const include={summaryRun:true} as const;
function view(row:Attachment & {summaryRun:Run|null}):AttachmentView {
  return {id:row.id,filename:row.filename,metadata:ImageMetadata.parse(row.metadata),inputArtifactId:row.inputArtifactId,
    createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt?.toISOString()??null,summary:row.summary,summaryRun:row.summaryRun?runView(row.summaryRun):null};
}
export async function attachmentViews(tx:Tx,artifactIds:string[]) {
  return (await tx.attachment.findMany({where:{references:{some:{artifactId:{in:artifactIds}}}},include})).map(view);
}
export async function referenceImages(tx:Tx,artifactId:string,ids:string[]) {
  if(ids.length)await tx.artifactAttachment.createMany({data:[...new Set(ids)].map(attachmentId=>({artifactId,attachmentId})),skipDuplicates:true});
}
export async function retainImages(tx:Tx,ids:string[]) {
  const rows:AttachmentView[]=[];
  for(const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT id FROM attachments WHERE id=${id}::uuid FOR UPDATE`;
    const row=await tx.attachment.findUnique({where:{id},include});
    if(!row || (row.expiresAt && row.expiresAt.getTime()<=Date.now()))throw new AttachmentError(409,'An attachment expired or is unavailable. Remove it and attach the image again.');
    rows.push(view(row));
  }
  if(rows.reduce((n,row)=>n+row.metadata.original.sizeBytes,0)>IMAGE_LIMITS.perMessage)throw new AttachmentError(413,'Images in one message must total at most 20 MiB.');
  if(ids.length)await tx.attachment.updateMany({where:{id:{in:ids}},data:{expiresAt:null}});
  return rows;
}

export class Attachments {
  private jobs=new Map<string,{controller:AbortController;promise:Promise<void>}>();
  private uploads=new Map<string,Promise<AttachmentView>>();
  private tail:Promise<unknown>=Promise.resolve();
  private stopping=false;
  constructor(readonly db:PrismaClient,readonly storage:ImageStorage,private model:ModelAdapter,private autoDispatch=true) {}
  async recover() {
    await this.db.run.updateMany({where:{threadId:null,status:{in:['queued','running']}},data:{status:'interrupted',endedAt:new Date(),error:{code:'server_interrupted',message:'The image description was interrupted. Retry it explicitly.'}}});
  }
  async get(id:string) {
    const row=await this.db.attachment.findUnique({where:{id},include});
    if(!row || (row.expiresAt && row.expiresAt.getTime()<=Date.now()))throw new AttachmentError(404,'Image not found or upload expired.');
    return view(row);
  }
  async upload(id:string,filename:string,bytes:Buffer) {
    if(this.stopping)throw new AttachmentError(503,'The backend is stopping.');
    filename=filename.split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,160)||'Image';
    const hash=createHash('sha256').update(bytes).digest('hex');
    const check=(row:AttachmentView)=>{
      if(row.filename!==filename || row.metadata.original.hash!==hash)throw new AttachmentError(409,'This upload ID was already used for another image.');
      return row;
    };
    const prior=this.uploads.get(id);
    if(prior)return check(await prior);
    if(this.uploads.size>=2)throw new AttachmentError(429,'Two images are uploading. Retry this upload in a moment.');
    const task=this.acceptUpload(id,filename,bytes,hash);
    this.uploads.set(id,task);
    try{return check(await task);}finally{this.uploads.delete(id);}
  }
  private async acceptUpload(id:string,filename:string,bytes:Buffer,hash:string) {
    const existing=await this.db.attachment.findUnique({where:{id},include});
    if(existing)return this.get(id);
    const processed=await processImage(bytes);
    // No database row owns this directory: this also repairs an interrupted publish.
    await this.storage.remove(id);await this.storage.publish(id,processed.blobs);
    const row=await this.db.$transaction(async tx=>{
      const now=new Date(),inputId=randomUUID();
      await tx.artifact.create({data:{id:inputId,layer:'input',actor:'user',payload:{type:'image_upload',attachmentId:id,filename},createdAt:now,updatedAt:now}});
      const attachment=await tx.attachment.create({data:{id,filename,inputArtifactId:inputId,metadata:json(processed.metadata),createdAt:now,expiresAt:new Date(now.getTime()+IMAGE_LIMITS.draftLifetimeMs)}});
      await referenceImages(tx,inputId,[id]);
      await this.createSummary(tx,attachment,randomUUID(),undefined,hash);
      return tx.attachment.findUniqueOrThrow({where:{id},include});
    });
    if(this.autoDispatch)this.dispatch(row.summaryRunId!);
    return view(row);
  }
  private async createSummary(tx:Tx,attachment:Attachment,key:string,previous?:Run,uploadHash?:string) {
    let request:RequestPayload;
    if(previous) {
      const saved=await tx.artifact.findUniqueOrThrow({where:{id:RunState.parse(previous.state).request_artifact_id}});
      const original=RequestPayload.parse(saved.payload);
      request=RequestPayload.parse({...original,...this.model.summaryConfiguration(original)});
    }else {
      const instruction=await tx.instruction.findUniqueOrThrow({where:{key:'image-description'}});
      request=RequestPayload.parse({type:'model_request',purpose:'image_summary',...this.model.summaryConfiguration(),messages:[
        {role:'system',content:instruction.text},{role:'user',content:[{type:'image',attachmentId:attachment.id,image:ImageMetadata.parse(attachment.metadata).model,detail:'high',description:`[Uploaded image: ${attachment.filename}] (attachmentId: ${attachment.id})`}]},
      ],selection:{instructions:[{id:instruction.id,key:instruction.key!,messageIndex:0}],artifacts:[{id:attachment.inputArtifactId,messageIndex:1}],omitted:[],maxCharacters:4000}});
    }
    const now=new Date(),id=randomUUID(),requestId=randomUUID();
    const hash=createHash('sha256').update(JSON.stringify({attachmentId:attachment.id,previousId:previous?.id??null,uploadHash})).digest('hex');
    const run=await tx.run.create({data:{id,inputArtifactId:attachment.inputArtifactId,threadId:null,retryOfId:previous?.id,status:'queued',state:{request_artifact_id:requestId,response_artifact_id:null},requestKey:key,requestHash:hash,createdAt:now}});
    await tx.artifact.create({data:{id:requestId,layer:'act',sourceId:attachment.inputArtifactId,runId:id,actor:'ash',payload:json(request),createdAt:now,updatedAt:now}});
    await referenceImages(tx,requestId,[attachment.id]);
    await tx.attachment.update({where:{id:attachment.id},data:{summaryRunId:id}});
    return run;
  }
  async retry(id:string,key:string,previousId:string) {
    if(this.stopping)throw new AttachmentError(503,'The backend is stopping.');
    const run=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM attachments WHERE id=${id}::uuid FOR UPDATE`;
      const attachment=await tx.attachment.findUnique({where:{id},include});
      if(!attachment || (attachment.expiresAt && attachment.expiresAt.getTime()<=Date.now()))throw new AttachmentError(404,'Image not found or upload expired.');
      const duplicate=await tx.run.findUnique({where:{requestKey:key}});
      if(duplicate) {
        if(duplicate.inputArtifactId!==attachment.inputArtifactId || duplicate.retryOfId!==previousId)throw new AttachmentError(409,'This retry key already belongs to another operation.');
        return duplicate;
      }
      const previous=attachment.summaryRun;
      if(!previous || previous.id!==previousId || ['queued','running','completed'].includes(previous.status))throw new AttachmentError(409,'Only the latest failed or interrupted description can be retried.');
      return this.createSummary(tx,attachment,key,previous);
    });
    if(this.autoDispatch && run.status==='queued')this.dispatch(run.id);
    return this.get(id);
  }
  dispatch(id:string) {
    if(this.stopping || this.jobs.has(id))return;
    const controller=new AbortController();
    const promise=this.tail.then(()=>this.execute(id,controller.signal)).finally(()=>this.jobs.delete(id));
    this.jobs.set(id,{controller,promise});this.tail=promise.catch(()=>{});
    void promise.catch(()=>console.error(JSON.stringify({event:'image-description-worker-error',runId:id})));
  }
  private async execute(id:string,signal:AbortSignal) {
    if(signal.aborted)return;
    if(!(await this.db.run.updateMany({where:{id,threadId:null,status:'queued'},data:{status:'running',startedAt:new Date()}})).count)return;
    try {
      const run=await this.db.run.findUniqueOrThrow({where:{id}}),state=RunState.parse(run.state);
      const saved=await this.db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}}),request=RequestPayload.parse(saved.payload);
      for(const message of request.messages)if(Array.isArray(message.content))for(const block of message.content)if(block.type==='image')await this.storage.read(block.attachmentId,block.image);
      let text='',metadata:ModelExecution|undefined;
      for await(const event of this.model.stream(request,signal,image=>this.storage.dataUrl(image))) {
        if(typeof event==='string') {text+=event;if(text.length>3000)throw new ModelFailure('description_too_long','The image description exceeded its size limit.');}
        else if (!('kind' in event)) {metadata={...metadata,...event};await this.db.run.updateMany({where:{id,status:'running'},data:{state:{...state,model:metadata}}});}
      }
      if(!text.trim())throw new ModelFailure('description_empty','No image description was returned.');
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM runs WHERE id=${id}::uuid FOR UPDATE`;
        const current=await tx.run.findUniqueOrThrow({where:{id}});
        if(current.status!=='running')return;
        const attachment=await tx.attachment.findUniqueOrThrow({where:{summaryRunId:id}});
        const now=new Date(),responseId=randomUUID();
        await tx.artifact.create({data:{id:responseId,layer:'act',sourceId:state.request_artifact_id,runId:id,actor:'ash',payload:DescriptionPayload.parse({type:'image_description',attachmentId:attachment.id,text:text.trim()}),createdAt:now,updatedAt:now}});
        await referenceImages(tx,responseId,[attachment.id]);
        await tx.run.update({where:{id},data:{status:'completed',endedAt:now,state:{...state,response_artifact_id:responseId,...(metadata?{model:metadata}:{})}}});
        await tx.attachment.update({where:{id:attachment.id},data:{summary:text.trim()}});
      });
    }catch(error) {
      await this.db.run.updateMany({where:{id,status:'running'},data:{status:'failed',endedAt:new Date(),error:{code:error instanceof ModelFailure?error.code:'description_failed',message:error instanceof ModelFailure?error.message:'The image description could not be completed. The image is still usable.'}}});
    }
  }
  async cleanup(now=new Date()) {
    const expired=await this.db.attachment.findMany({where:{expiresAt:{lte:now}},select:{id:true}});
    for(const {id} of expired) {
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM attachments WHERE id=${id}::uuid FOR UPDATE`;
        const row=await tx.attachment.findUnique({where:{id},include});
        if(!row?.expiresAt || row.expiresAt>now || row.summaryRun && ['queued','running'].includes(row.summaryRun.status))return false;
        const runs=await tx.run.findMany({where:{inputArtifactId:row.inputArtifactId},orderBy:{createdAt:'desc'}});
        const artifacts=await tx.artifact.findMany({where:{OR:[{id:row.inputArtifactId},{runId:{in:runs.map(run=>run.id)}}]}});
        const ids=artifacts.map(a=>a.id);
        if(await tx.artifactAttachment.count({where:{attachmentId:id,artifactId:{notIn:ids}}}))return false;
        await tx.artifactAttachment.deleteMany({where:{attachmentId:id}});
        await tx.attachment.delete({where:{id}});
        // Remove children before parents, retaining accepted graphs via the reference guard above.
        for(const type of ['image_description','model_request'])for(const artifact of artifacts.filter(a=>(a.payload as {type:string}).type===type))await tx.artifact.delete({where:{id:artifact.id}});
        // Retry timestamps can tie; delete leaves before their retry_of parents.
        const remaining=new Map(runs.map(run=>[run.id,run]));
        while(remaining.size) {
          const parents=new Set([...remaining.values()].map(run=>run.retryOfId));
          const leaves=[...remaining.values()].filter(run=>!parents.has(run.id));
          if(!leaves.length)throw new Error('Invalid image description retry chain');
          for(const run of leaves){await tx.run.delete({where:{id:run.id}});remaining.delete(run.id);}
        }
        await tx.artifact.delete({where:{id:row.inputArtifactId}});
        // Keep the row lock until files are gone. A retry of this upload ID
        // must not publish replacement bytes while an older cleanup removes them.
        await this.storage.remove(id);
        return true;
      });
    }
    await this.storage.sweepUnpublished(new Set((await this.db.attachment.findMany({select:{id:true}})).map(row=>row.id)),now.getTime());
  }
  async stop() {
    this.stopping=true;await Promise.allSettled(this.uploads.values());await this.recover();
    for(const job of this.jobs.values())job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));
  }
}
