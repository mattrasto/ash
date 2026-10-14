import { ZodError } from '@ash/shared';
import { connectProduct } from './platform/db/client.ts';
import { Conversations, ConversationError } from './modules/conversations/service.ts';
import { conversationRoutes } from './modules/conversations/routes.ts';
import { deterministicModel } from './platform/models/deterministic.ts';
import { openAIModel } from './platform/models/openai.ts';
import { openSession } from './platform/models/session.ts';
import { readOpenAIKey } from './platform/models/credentials.ts';
import { Attachments } from './modules/attachments/service.ts';
import { ImageStorage, AttachmentError } from './modules/attachments/storage.ts';
import { attachmentRoutes } from './modules/attachments/routes.ts';
import { filesystemRuntime, loadFilesystemConfig } from './modules/filesystem/runtime.ts';
import { composeToolRuntimes } from './modules/tools/contract.ts';
import Fastify from 'fastify';
import postgres from 'postgres';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerConfig, ScratchChange } from '@ash/shared';

const config = ServerConfig.parse(JSON.parse(await readFile(process.argv[2], 'utf8')));
const { instance, token } = config;
const db = postgres(config.databaseUrl, { max: 3, onnotice: () => {} });
const [identity] = await db`SELECT instance_id, generation, schema_version FROM dev_meta`;
if (identity.instance_id !== instance.id || identity.generation !== instance.generation || identity.schema_version !== instance.schemaVersion) { await db.end(); throw new Error('Database identity does not match this instance'); }
let stopping = false;
let ownsDatabase = false;
const ownerDb = postgres(config.databaseUrl, {max:1, onnotice:()=>{}, onclose:()=>{
  if (ownsDatabase && !stopping) { console.error('Database ownership connection lost'); process.exit(1); }
}});
const ownership = await ownerDb.reserve();
const [owner] = await ownership`SELECT pg_try_advisory_lock(1095976961, 1) AS acquired`;
if (!owner.acquired) { ownership.release(); await ownerDb.end(); await db.end(); throw new Error('Another backend already owns this database'); }
ownsDatabase = true;
const product = connectProduct(config.databaseUrl);
const modelSessionId = process.argv[3];
const model = modelSessionId ? openAIModel({...await openSession(instance,modelSessionId),apiKey:await readOpenAIKey(instance.checkout)}) : deterministicModel;
const imageStorage=new ImageStorage(instance.root);
await imageStorage.prepare();
const attachments=new Attachments(product,imageStorage,model);
const conversations = new Conversations(product,model,true,imageStorage,composeToolRuntimes(filesystemRuntime(()=>loadFilesystemConfig(instance.profile === 'preview' ? instance.checkout : instance.root))));
await conversations.recover();
await attachments.recover();await attachments.cleanup();
const cleanupTimer=setInterval(()=>{void attachments.cleanup().catch(()=>console.error('Image cleanup failed'));},60*60*1000);cleanupTimer.unref();
const app = Fastify({ logger: false });
app.addHook('onRequest', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: 'Unauthorized' });
});
conversationRoutes(app, conversations);
attachmentRoutes(app,attachments);
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
  model: await model.info(),
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
  if (error instanceof ZodError) return reply.code(400).send({error:'Invalid conversation request.'});
  if (error instanceof ConversationError) return reply.code(error.status).send({error:error.message});
  if (error instanceof AttachmentError) return reply.code(error.status).send({error:error.message});
  if ((error as {statusCode?:number}).statusCode===413)return reply.code(413).send({error:'Each image must be at most 10 MiB.'});
  console.error(JSON.stringify({ event: 'request-error', message: (error instanceof Error ? error.message : 'Unknown error').replaceAll(token, '[redacted]') }));
  reply.code(500).send({ error: 'The preview could not complete this operation.' });
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('Missing server address');
process.send?.({ type: 'listening', url: `http://127.0.0.1:${address.port}` });
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanupTimer);await app.close(); await conversations.stop();await attachments.stop(); await product.$disconnect(); ownership.release(); await ownerDb.end(); await db.end(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('disconnect', stop);
