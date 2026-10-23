import type { FastifyInstance } from 'fastify';
import type { SceneService } from './service.ts';
import { searchSceneLocations } from './locations.ts';
import { sceneEventReceipt } from './intent.ts';
import type { ReceiveItem } from '@ash/shared';
import type { SceneWorkflow } from './workflow.ts';
import { z } from 'zod';
import { SceneError } from './storage.ts';

/** Register inside the host's authenticated Fastify boundary. No public asset routes. */
export function sceneRoutes(app: FastifyInstance, scenes: SceneService, options?: { workflow: SceneWorkflow; receive: (receipt: ReceiveItem) => Promise<unknown> }) {
  app.get('/api/scenes', async (_request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return scenes.choices();
  });
  app.post('/api/scenes/select', { bodyLimit: 2048 }, async request => {
    const { id, expectedRevision } = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), expectedRevision: z.number().int().nonnegative() }).strict().parse(request.body);
    await scenes.activate(id, expectedRevision);
    return scenes.choices();
  });
  app.post('/api/scenes/new', { bodyLimit: 2048 }, async () => {
    throw new SceneError(409, 'New scene generation is not connected yet.');
  });
  if (options) {
    app.post('/api/scenes/events', { bodyLimit: 16384 }, request => options.receive(sceneEventReceipt(request.body)));
    app.get<{ Params: { id: string } }>('/api/scenes/candidates/:id', async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      return options.workflow.candidates.get(request.params.id);
    });
    app.get<{ Params: { id: string; hash: string } }>('/api/scenes/candidates/:id/assets/:hash', async (request, reply) => {
      const bytes = await options.workflow.candidates.asset(request.params.id, request.params.hash);
      return reply.header('cache-control', 'private, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').type('image/png').send(bytes);
    });
  }
  app.get('/api/scenes/state', async (_request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return scenes.getState();
  });
  app.post('/api/scenes/location', { bodyLimit: 2048 }, async request => scenes.updateLocation(request.body));
  app.get<{ Querystring: { q?: string } }>('/api/scenes/locations', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return searchSceneLocations(request.query.q);
  });
  app.get<{ Params: { id: string } }>('/api/scenes/bundles/:id', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return scenes.getBundle(request.params.id);
  });
  app.get<{ Params: { id: string; hash: string } }>('/api/scenes/bundles/:id/assets/:hash', async (request, reply) => {
    const { bytes, asset } = await scenes.readAsset(request.params.id, request.params.hash);
    return reply.header('cache-control', 'private, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').header('content-length', bytes.length).type(asset.mediaType).send(bytes);
  });
}
