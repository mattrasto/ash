import type { FastifyInstance } from 'fastify';
import { Uuid, FormalizePermission } from '@ash/shared';
import { Permissions } from './service.ts';
import { filesystemResource } from './authoring.ts';
export function permissionRoutes(app:FastifyInstance,service:Permissions){
  app.get('/api/permissions',()=>service.list());app.post('/api/permissions',request=>service.changeEffect(request.body));
  app.post<{Params:{id:string}}>('/api/permissions/:id/remove',request=>service.remove(Uuid.parse(request.params.id)).then(()=>({removed:true})));
  app.post('/api/permissions/review',request=>service.review(request.body));
  app.post('/api/permissions/commit',request=>service.commit(request.body));
  app.post('/api/permissions/formalize',request=>service.formalize(FormalizePermission.parse(request.body)));
  app.post('/api/permissions/filesystem-resource',request=>filesystemResource(request.body));
}
