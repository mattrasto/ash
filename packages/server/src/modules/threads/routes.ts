import type { FastifyInstance } from 'fastify';
import { CreateThread, UpdateThread, SendMessage, RetryRun, Uuid } from '@ash/shared';
import { Threads } from './service.ts';
export function threadRoutes(app: FastifyInstance, threads: Threads) {
  app.get('/api/threads', () => threads.listThreads());
  app.post('/api/threads', async request => { const {id,title,topicId} = CreateThread.parse(request.body); return threads.createThread(id,title,topicId); });
  app.get<{Params:{id:string}}>('/api/threads/:id', request => threads.readThread(Uuid.parse(request.params.id)));
  app.post<{Params:{id:string}}>('/api/threads/:id', request => threads.updateThread(Uuid.parse(request.params.id),UpdateThread.parse(request.body)));
  app.post<{Params:{id:string}}>('/api/threads/:id/messages', async request => {
    const command = SendMessage.parse(request.body);
    return threads.submitMessage(Uuid.parse(request.params.id),command.requestKey,command.text,command.mode,command.attachmentIds);
  });
  app.post<{Params:{id:string}}>('/api/runs/:id/retry', async request => {
    const command = RetryRun.parse(request.body);
    return threads.retry(Uuid.parse(request.params.id),command.requestKey,command.mode);
  });
  app.post<{Params:{id:string}}>('/api/runs/:id/cancel', request => threads.cancel(Uuid.parse(request.params.id)));
  app.get<{Params:{id:string}}>('/api/artifacts/:id', request => threads.inspect(Uuid.parse(request.params.id)));
}
