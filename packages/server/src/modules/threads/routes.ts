import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateThread, UpdateThread, SendMessage, RetryRun, Uuid } from '@ash/shared';
import { Threads } from './service.ts';
export function threadRoutes(app: FastifyInstance, threads: Threads) {
  app.post<{Params:{id:string}}>('/api/threads/:id/draft',request=>threads.saveDraftPresence(Uuid.parse(request.params.id),request.body));
  app.post<{Params:{id:string}}>('/api/threads/:id/seen', request=>threads.markSeen(Uuid.parse(request.params.id),z.object({cursor:z.number().int().nonnegative()}).strict().parse(request.body).cursor));
  app.get<{Params:{id:string}}>('/api/threads/:id/assessments', request=>threads.assessments(Uuid.parse(request.params.id)));
  app.get<{Params:{id:string}}>('/api/thread-assessments/:id', request=>threads.inspectAssessment(Uuid.parse(request.params.id)));
  app.get<{Params:{id:string}}>('/api/application-changes/:id', request=>threads.inspectChange(Uuid.parse(request.params.id)));
  app.get<{Params:{id:string}}>('/api/threads/:id/changes', request=>threads.changes(Uuid.parse(request.params.id)));
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
