import type { FastifyInstance } from 'fastify';
import { CreateThread, UpdateThread, SendMessage, RetryRun, Uuid } from '@ash/shared';
import { Conversations } from './service.ts';
export function conversationRoutes(app: FastifyInstance, conversations: Conversations) {
  app.get('/api/threads', () => conversations.listThreads());
  app.post('/api/threads', async request => { const {id,title} = CreateThread.parse(request.body); return conversations.createThread(id,title); });
  app.get<{Params:{id:string}}>('/api/threads/:id', request => conversations.readThread(Uuid.parse(request.params.id)));
  app.post<{Params:{id:string}}>('/api/threads/:id', request => conversations.updateThread(Uuid.parse(request.params.id),UpdateThread.parse(request.body)));
  app.post<{Params:{id:string}}>('/api/threads/:id/messages', async request => {
    const command = SendMessage.parse(request.body);
    return conversations.submit(Uuid.parse(request.params.id),command.requestKey,command.text,command.mode,command.attachmentIds);
  });
  app.post<{Params:{id:string}}>('/api/runs/:id/retry', async request => {
    const command = RetryRun.parse(request.body);
    return conversations.retry(Uuid.parse(request.params.id),command.requestKey,command.mode);
  });
  app.post<{Params:{id:string}}>('/api/runs/:id/cancel', request => conversations.cancel(Uuid.parse(request.params.id)));
  app.get<{Params:{id:string}}>('/api/artifacts/:id', request => conversations.inspect(Uuid.parse(request.params.id)));
}
