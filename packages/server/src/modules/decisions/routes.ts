import type { FastifyInstance } from 'fastify';
import { Uuid, CreateDecision } from '@ash/shared';
import { z } from 'zod';
import { Decisions } from './service.ts';
export function decisionRoutes(app:FastifyInstance,service:Decisions){
  app.get('/api/decisions',()=>service.list());
  app.post('/api/decisions',request=>service.create(CreateDecision.parse(request.body)));
  app.post<{Params:{id:string}}>('/api/decisions/:id/answer',request=>service.answer(Uuid.parse(request.params.id),request.body));
  app.post<{Params:{id:string}}>('/api/decisions/:id/snooze',request=>service.snooze(Uuid.parse(request.params.id),z.object({until:z.string().datetime().nullable()}).strict().parse(request.body).until));
  app.post<{Params:{id:string}}>('/api/decisions/:id/cancel',request=>service.cancel(Uuid.parse(request.params.id)));
}
