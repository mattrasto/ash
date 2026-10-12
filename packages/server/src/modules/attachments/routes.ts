import type { FastifyInstance } from 'fastify';
import { Uuid, IMAGE_LIMITS } from '@ash/shared';
import { Attachments } from './service.ts';
import { AttachmentError } from './storage.ts';

export function attachmentRoutes(app:FastifyInstance,attachments:Attachments) {
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:IMAGE_LIMITS.perFile},(_request,body,done)=>done(null,body));
  app.put<{Params:{id:string}}>('/api/attachments/:id',{bodyLimit:IMAGE_LIMITS.perFile},async request=>{
    const id=Uuid.parse(request.params.id);
    if(!Buffer.isBuffer(request.body))throw new AttachmentError(400,'Upload image bytes.');
    let filename:string;
    try{filename=decodeURIComponent(String(request.headers['x-image-filename']??'Image'));}catch{throw new AttachmentError(400,'Invalid image filename.');}
    return attachments.upload(id,filename,request.body);
  });
  app.get<{Params:{id:string}}>('/api/attachments/:id',request=>attachments.get(Uuid.parse(request.params.id)));
  app.post<{Params:{id:string}}>('/api/attachments/:id/retry',async request=>{
    const body=request.body as {requestKey?:unknown;previousId?:unknown};
    return attachments.retry(Uuid.parse(request.params.id),Uuid.parse(body?.requestKey),Uuid.parse(body?.previousId));
  });
  for(const variant of ['original','model','thumbnail','clipboard'] as const)app.get<{Params:{id:string}}>(`/api/attachments/:id/${variant}`,async(request,reply)=>{
    const row=await attachments.get(Uuid.parse(request.params.id));
    reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff');
    if(variant==='clipboard')return reply.type('image/png').send(await attachments.storage.clipboard(row.id,row.metadata.original));
    const image=row.metadata[variant];
    return reply.type(image.mimeType).send(await attachments.storage.read(row.id,image));
  });
}
