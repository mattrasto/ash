import { randomUUID, createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Attachment, type Run } from '@prisma/client';
import { mkdir,mkdtemp,open,rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { ImageMetadata, AttachmentMetadata, VIDEO_LIMITS, isVideoAttachment, IMAGE_LIMITS, RequestPayload, RunState, DescriptionPayload, imageDescription,
  VideoUnderstandingPayload, type AttachmentView, type ModelExecution } from '@ash/shared';
import { ModelFailure, type ModelAdapter } from '../../platform/models/adapter.ts';
import { runView } from '../threads/views.ts';
import { ImageStorage, AttachmentError, processImage } from './storage.ts';
import {processVideo,fileHash} from './video.ts';
import {VideoAnalysis} from '../video/service.ts';
import {deterministicVideoProvider} from '../../platform/models/gemini-video.ts';

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const include={summaryRun:true} as const;
function view(row:Attachment & {summaryRun:Run|null}):AttachmentView {
  const metadata=AttachmentMetadata.parse(row.metadata);
  return {id:row.id,filename:row.filename,...('durationSeconds' in metadata?{kind:'video' as const,metadata}:{metadata}),inputArtifactId:row.inputArtifactId,
    createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt?.toISOString()??null,summary:row.summary,summaryRun:row.summaryRun?runView(row.summaryRun):null};
}
export async function attachmentViews(tx:Tx,artifactIds:string[]) {
  return hydrateViews(tx,await tx.attachment.findMany({where:{references:{some:{artifactId:{in:artifactIds}}}},include}));
}
async function hydrateViews(tx:Pick<Tx,'artifact'>,rows:Array<Attachment & {summaryRun:Run|null}>):Promise<AttachmentView[]>{
  const ids=rows.flatMap(row=>row.summaryRun&&'durationSeconds' in (row.metadata as object)?[RunState.parse(row.summaryRun.state).response_artifact_id].filter((id):id is string=>!!id):[]);
  const results=new Map((await tx.artifact.findMany({where:{id:{in:ids}}})).map(row=>[row.id,row.payload]));
  return rows.map(row=>{const attachment=view(row),id=row.summaryRun?RunState.parse(row.summaryRun.state).response_artifact_id:null;
    const result=id?VideoUnderstandingPayload.safeParse(results.get(id)):null;
    return isVideoAttachment(attachment)&&result?.success?{...attachment,understanding:{caption:result.data.result.caption,actionItems:result.data.result.actionItems,complete:result.data.complete,transcript:result.data.result.transcript,
      limitations:result.data.result.limitations,coverage:result.data.coverage,timing:result.data.timing,resultArtifactId:id!,requestIds:result.data.requestIds}}:attachment;});
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
  if(rows.filter(row=>!isVideoAttachment(row)).reduce((n,row)=>n+row.metadata.original.sizeBytes,0)>IMAGE_LIMITS.perMessage)throw new AttachmentError(413,'Images in one message must total at most 20 MiB.');
  if(rows.filter(isVideoAttachment).reduce((n,row)=>n+row.metadata.original.sizeBytes,0)>VIDEO_LIMITS.perMessage)throw new AttachmentError(413,'Videos in one message must total at most 4 GiB.');
  if(ids.length)await tx.attachment.updateMany({where:{id:{in:ids}},data:{expiresAt:null}});
  return rows;
}

export class Attachments {
  private jobs=new Map<string,{controller:AbortController;promise:Promise<void>}>();
  private uploads=new Map<string,Promise<AttachmentView>>();
  private tail:Promise<unknown>=Promise.resolve();
  private stopping=false;
  constructor(readonly db:PrismaClient,readonly storage:ImageStorage,private model:ModelAdapter,private autoDispatch=true,
    readonly video:VideoAnalysis=new VideoAnalysis(db,storage,deterministicVideoProvider,autoDispatch)) {}
  async recover() {
    await this.db.run.updateMany({where:{threadId:null,status:{in:['queued','running']}},data:{status:'interrupted',endedAt:new Date(),error:{code:'server_interrupted',message:'Attachment analysis was interrupted. Retry it explicitly.'}}});
  }
  async get(id:string) {
    const row=await this.db.attachment.findUnique({where:{id},include});
    if(!row || (row.expiresAt && row.expiresAt.getTime()<=Date.now()))throw new AttachmentError(404,'Image not found or upload expired.');
    return (await hydrateViews(this.db,[row]))[0];
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
  async uploadVideo(id:string,filename:string,stream:Readable,incomplete=false,recorded=false) {
    if(this.stopping)throw new AttachmentError(503,'The backend is stopping.');
    filename=filename.split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,160)||'Video';
    const prior=this.uploads.get(id);
    if(!prior&&this.uploads.size>=2)throw new AttachmentError(429,'Two attachments are uploading. Retry in a moment.');
    const task=(async()=>{
      await this.storage.prepare();const tmp=join(this.storage.root,'..','video-temp');await mkdir(tmp,{recursive:true,mode:0o700});
      const dir=await mkdtemp(join(tmp,'upload-')),path=join(dir,'source'),file=await open(path,'wx',0o600);
      try {
        let size=0;try{for await(const chunk of stream){size+=chunk.length;if(size>VIDEO_LIMITS.perFile)throw new AttachmentError(413,'Each video must be at most 2 GiB.');await file.writeFile(chunk);}await file.sync();}finally{await file.close();}
        const hash=await fileHash(path),existing=prior?await prior:await this.db.attachment.findUnique({where:{id},include}).then(row=>row?view(row):null);
        if(existing){if(!isVideoAttachment(existing)||existing.filename!==filename||existing.metadata.original.hash!==hash||!!existing.metadata.incomplete!==incomplete||!!existing.metadata.recorded!==recorded)throw new AttachmentError(409,'This upload ID was already used for another attachment.');return this.get(id);}
        const processed=await processVideo(path,tmp);
        try {
          await this.storage.remove(id);await this.storage.publish(id,processed.blobs);
          const row=await this.db.$transaction(async tx=>{
            const now=new Date(),inputId=randomUUID();
            await tx.artifact.create({data:{id:inputId,layer:'input',actor:'user',payload:{type:'video_upload',attachmentId:id,filename},createdAt:now,updatedAt:now}});
            const attachment=await tx.attachment.create({data:{id,filename,inputArtifactId:inputId,metadata:json({...processed.metadata,...(incomplete?{incomplete:true}:{}),...(recorded?{recorded:true}:{})}),createdAt:now,expiresAt:new Date(now.getTime()+IMAGE_LIMITS.draftLifetimeMs)}});
            await referenceImages(tx,inputId,[id]);await this.video.create(tx,attachment,randomUUID());return tx.attachment.findUniqueOrThrow({where:{id},include});
          });if(this.autoDispatch)this.video.dispatch(row.summaryRunId!);return view(row);
        }finally{await processed.dispose();}
      }finally{await rm(dir,{recursive:true,force:true});}
    })();
    if(!prior)this.uploads.set(id,task);
    try{return await task;}finally{if(!prior)this.uploads.delete(id);}
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
    if('durationSeconds' in (attachment.metadata as object))return this.video.create(tx,attachment,key,{operation:'caption'},previous);
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
      let missingRecordingDraft=false;
      const media=AttachmentMetadata.parse(attachment.metadata);
      if(previous?.status==='completed'&&'durationSeconds' in media&&media.recorded){
        const responseId=RunState.parse(previous.state).response_artifact_id;
        const saved=responseId?await tx.artifact.findUnique({where:{id:responseId}}):null,result=VideoUnderstandingPayload.safeParse(saved?.payload);
        missingRecordingDraft=result.success&&(result.data.result.actionItems===undefined||!result.data.complete);
      }
      if(!previous || previous.id!==previousId || ['queued','running'].includes(previous.status)||previous.status==='completed'&&!missingRecordingDraft)throw new AttachmentError(409,'Only the latest failed, interrupted or incomplete recording analysis can be retried.');
      return this.createSummary(tx,attachment,key,previous);
    });
    if(this.autoDispatch && run.status==='queued'){const attachment=await this.get(id);if(isVideoAttachment(attachment))this.video.dispatch(run.id);else this.dispatch(run.id);}
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
        const pending=new Map(artifacts.filter(a=>a.id!==row.inputArtifactId).map(a=>[a.id,a]));
        while(pending.size){const parents=new Set([...pending.values()].map(a=>a.sourceId));const leaves=[...pending.values()].filter(a=>!parents.has(a.id));if(!leaves.length)throw Error('Invalid attachment Artifact chain');for(const a of leaves){await tx.artifact.delete({where:{id:a.id}});pending.delete(a.id);}}
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
    await this.video.stop();
    await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));
  }
}
