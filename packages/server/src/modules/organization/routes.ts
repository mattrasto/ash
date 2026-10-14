import type { FastifyInstance } from 'fastify';
import { Uuid, InstructionOwner } from '@ash/shared';
import { Organization } from './service.ts';

export function organizationRoutes(app:FastifyInstance, organization:Organization) {
  app.get('/api/topics',()=>organization.list());
  app.post('/api/topics',request=>organization.create(request.body));
  app.post<{Params:{id:string}}>('/api/topics/:id',request=>organization.change(Uuid.parse(request.params.id),request.body));
  app.get<{Params:{id:string}}>('/api/threads/:id/topics',request=>organization.readMembership(Uuid.parse(request.params.id)));
  app.post<{Params:{id:string}}>('/api/threads/:id/topics',request=>organization.link(Uuid.parse(request.params.id),request.body));
  app.get<{Params:{scope:string;id:string}}>('/api/instructions/:scope/:id',request=>{
    const {scope,id} = request.params;
    return organization.readInstruction(InstructionOwner.parse(scope==='global'?{scope,key:id}:{scope,id}));
  });
  app.post('/api/instructions',request=>organization.saveInstruction(request.body));
}
