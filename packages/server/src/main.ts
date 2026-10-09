import Fastify from 'fastify';
import postgres from 'postgres';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerConfig, ScratchChange } from '@ash/shared';

const config = ServerConfig.parse(JSON.parse(await readFile(process.argv[2], 'utf8')));
const { instance, token } = config;
const db = postgres(config.databaseUrl, { max: 3, onnotice: () => {} });
const app = Fastify({ logger: false });
app.addHook('onRequest', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: 'Unauthorized' });
});
app.get('/health', async () => {
  const [meta] = await db`SELECT instance_id, generation, schema_version FROM dev_meta`;
  if (meta.instance_id !== instance.id || meta.generation !== instance.generation || meta.schema_version !== instance.schemaVersion) {
    throw new Error('Database identity does not match this instance');
  }
  return { ready: true, instanceId: instance.id, generation: instance.generation, schemaVersion: meta.schema_version };
});
app.get('/api/info', async () => ({
  label: instance.label, workspaceId: instance.workspaceId, instanceId: instance.id,
  generation: instance.generation, profile: instance.profile, fixture: instance.fixture, schemaVersion: instance.schemaVersion,
}));
async function state() {
  const [row] = await db`SELECT note, count FROM dev_scratch WHERE id = 1`;
  return { ...row, fileNote: await readFile(join(instance.root, 'files/note.txt'), 'utf8') };
}
app.get('/api/state', state);
app.patch('/api/state', async (request, reply) => {
  const parsed = ScratchChange.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid scratchpad change' });
  const change = parsed.data;
  if (change.note !== undefined) await db`UPDATE dev_scratch SET note = ${change.note} WHERE id = 1`;
  if (change.increment) await db`UPDATE dev_scratch SET count = count + 1 WHERE id = 1`;
  if (change.fileNote !== undefined) await writeFile(join(instance.root, 'files/note.txt'), change.fileNote, { mode: 0o600 });
  return state();
});
app.setErrorHandler((error, _request, reply) => {
  console.error(JSON.stringify({ event: 'request-error', message: (error instanceof Error ? error.message : 'Unknown error').replaceAll(token, '[redacted]') }));
  reply.code(500).send({ error: 'The preview could not complete this operation.' });
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('Missing server address');
process.send?.({ type: 'listening', url: `http://127.0.0.1:${address.port}` });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close(); await db.end(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('disconnect', stop);
