import type { FastifyInstance } from 'fastify';
import { Uuid } from '@ash/shared';
import type { Adapt } from './service.ts';
export function adaptRoutes(app:FastifyInstance,adapt:Adapt){
  app.post<{Params:{id:string}}>('/api/threads/:id/preview',request=>adapt.preview(Uuid.parse(request.params.id),request.body));
  app.post<{Params:{id:string}}>('/api/threads/:id/application',request=>{if(!adapt.applications)throw Error('Local application unavailable.');return adapt.applications.prepare(Uuid.parse(request.params.id),request.body);});
  app.post<{Params:{id:string}}>('/api/threads/:id/workspace/refresh',request=>adapt.refresh(Uuid.parse(request.params.id),request.body));
  app.get('/api/adapt',()=>adapt.info());
  app.post<{Params:{id:string}}>('/api/threads/:id/mode',request=>adapt.mode(Uuid.parse(request.params.id),request.body));
}
