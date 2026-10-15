import type { FastifyInstance } from 'fastify';
import { Uuid } from '@ash/shared';
import type { Incoming } from './service.ts';
export function incomingRoutes(app:FastifyInstance,incoming:Incoming){
 app.post('/api/incoming',request=>incoming.receive(request.body));
 app.get<{Querystring:{before?:string}}>('/api/incoming',request=>incoming.list(request.query.before?Uuid.parse(request.query.before):undefined));
 app.get<{Params:{id:string}}>('/api/incoming/:id',request=>incoming.get(Uuid.parse(request.params.id)));
 app.post<{Params:{id:string}}>('/api/incoming/:id/retry',request=>incoming.retry(Uuid.parse(request.params.id)));
}
