import type { FastifyInstance } from 'fastify';
import { Uuid, IMAGE_LIMITS, isVideoAttachment,VideoModelRequest,RecordingOrigin,VideoFrame,CodingRequest,ToolArtifact } from '@ash/shared';
import type {Readable} from 'node:stream';
import { Attachments } from './service.ts';
import { AttachmentError } from './storage.ts';

export function attachmentRoutes(app:FastifyInstance,attachments:Attachments) {
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:IMAGE_LIMITS.perFile},(_request,body,done)=>done(null,body));
  app.addContentTypeParser('application/x-ash-video',(_request,payload,done)=>done(null,payload));
  app.put<{Params:{id:string}}>('/api/attachments/:id',{bodyLimit:IMAGE_LIMITS.perFile},async request=>{
    const id=Uuid.parse(request.params.id);
    let filename:string;
    try{filename=decodeURIComponent(String(request.headers['x-image-filename']??'Attachment'));}catch{throw new AttachmentError(400,'Invalid attachment filename.');}
    let origin;
    if(request.headers['x-recording-origin'])try{origin=RecordingOrigin.parse(JSON.parse(decodeURIComponent(String(request.headers['x-recording-origin']))));}catch{throw new AttachmentError(400,'Invalid recording origin.');}
    if(request.headers['content-type']==='application/x-ash-video'){const incomplete=request.headers['x-recording-incomplete'],source=request.headers['x-recording-source'];if(incomplete!==undefined&&incomplete!=='true'&&incomplete!=='false'||source!==undefined&&source!=='screen')throw new AttachmentError(400,'Invalid recording outcome.');return attachments.uploadVideo(id,filename,request.body as Readable,incomplete==='true',source==='screen',origin);}
    if(!Buffer.isBuffer(request.body))throw new AttachmentError(400,'Upload image bytes.');
    return attachments.upload(id,filename,request.body);
  });
  app.get<{Params:{id:string}}>('/api/attachments/:id',request=>attachments.get(Uuid.parse(request.params.id)));
  app.post<{Params:{id:string}}>('/api/attachments/:id/frames',request=>attachments.prepareFrames(Uuid.parse(request.params.id)));
  app.get<{Params:{id:string;artifactId:string;hash:string}}>('/api/attachments/:id/frame/:artifactId/:hash',async(request,reply)=>{
    const attachment=await attachments.get(Uuid.parse(request.params.id)),row=await attachments.db.artifact.findUnique({where:{id:Uuid.parse(request.params.artifactId)}});
    if(!row||!isVideoAttachment(attachment))throw new AttachmentError(404,'Captured frame unavailable.');
    const coding=CodingRequest.safeParse(row.payload),tool=ToolArtifact.safeParse(row.payload);
    const candidates:unknown[]=coding.success?coding.data.context.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(b=>b.type==='image'&&b.attachmentId===attachment.id).map(b=>'frame' in b?b.frame:undefined):[]):tool.success&&tool.data.type==='tool_result'?tool.data.result.references.filter(r=>r.kind==='video-frame'&&r.location.attachmentId===attachment.id).map(r=>r.location.frame):[];
    const frame=candidates.map(v=>VideoFrame.safeParse(v)).find(v=>v.success&&v.data.image.hash===request.params.hash);
    if(!frame?.success)throw new AttachmentError(404,'Captured frame unavailable.');
    reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff');return reply.type(frame.data.image.mimeType).send(await attachments.storage.read(attachment.id,frame.data.image));
  });
  app.get<{Params:{id:string;requestId:string}}>('/api/attachments/:id/evidence/:requestId',async(request,reply)=>{
    const attachment=await attachments.get(Uuid.parse(request.params.id));
    const row=await attachments.db.artifact.findUnique({where:{id:Uuid.parse(request.params.requestId)}}),parsed=VideoModelRequest.safeParse(row?.payload);
    if(!isVideoAttachment(attachment)||!parsed.success||parsed.data.attachmentId!==attachment.id||!parsed.data.media)throw new AttachmentError(404,'Captured video evidence is unavailable.');
    const file=parsed.data.media.file;
    await attachments.storage.checkedFile(attachment.id,file);
    const media=await attachments.storage.stream(attachment.id,file,request.headers.range);
    reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff').header('accept-ranges','bytes').header('content-length',media.end-media.start+1);
    if(media.partial)reply.code(206).header('content-range','bytes '+media.start+'-'+media.end+'/'+media.size);
    return reply.type(file.mimeType).send(media.stream);
  });
  app.post<{Params:{id:string}}>('/api/attachments/:id/retry',async request=>{
    const body=request.body as {requestKey?:unknown;previousId?:unknown};
    return attachments.retry(Uuid.parse(request.params.id),Uuid.parse(body?.requestKey),Uuid.parse(body?.previousId));
  });
  for(const variant of ['original','model','thumbnail','clipboard','playback'] as const)app.get<{Params:{id:string}}>(`/api/attachments/:id/${variant}`,async(request,reply)=>{
    const row=await attachments.get(Uuid.parse(request.params.id));
    reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff');
    if(isVideoAttachment(row)) {
      if(variant==='model'||variant==='clipboard')throw new AttachmentError(400,'Video pixels are not available as model input.');
      const descriptor=row.metadata[variant];
      if(variant==='thumbnail')return reply.type(descriptor.mimeType).send(await attachments.storage.read(row.id,descriptor));
      const media=await attachments.storage.stream(row.id,descriptor,request.headers.range);
      reply.header('accept-ranges','bytes').header('content-length',media.end-media.start+1);
      if(media.partial)reply.code(206).header('content-range',`bytes ${media.start}-${media.end}/${media.size}`);
      return reply.type(descriptor.mimeType).send(media.stream);
    }
    if(variant==='playback')throw new AttachmentError(400,'This attachment is an image.');
    if(variant==='clipboard')return reply.type('image/png').send(await attachments.storage.clipboard(row.id,row.metadata.original));
    const image=row.metadata[variant];
    return reply.type(image.mimeType).send(await attachments.storage.read(row.id,image));
  });
}
