import { ModelRouting } from './modules/threads/model-routing.ts';
import { jevRouter } from './platform/models/jev-router.ts';
import { ensureRoutingInstruction } from './modules/instructions/model-routing.ts';
import { ThreadVisibility } from './modules/visibility/service.ts';
import { ensureVisibilityInstructions } from './modules/visibility/instructions.ts';
import { Incoming } from './modules/artifacts/service.ts';
import { incomingRoutes } from './modules/artifacts/routes.ts';
import { ensureEngineInstructions } from './modules/artifacts/instructions.ts';
import { ZodError } from '@ash/shared';
import { connectProduct } from './platform/db/client.ts';
import { Threads, ThreadError } from './modules/threads/service.ts';
import { threadRoutes } from './modules/threads/routes.ts';
import { deterministicModel } from './platform/models/deterministic.ts';
import { openAIModel } from './platform/models/openai.ts';
import { openSession } from './platform/models/session.ts';
import { readOpenAIKey,readGeminiKey,readJevKey } from './platform/models/credentials.ts';
import {geminiVideoProvider,deterministicVideoProvider} from './platform/models/gemini-video.ts';
import {VideoAnalysis} from './modules/video/service.ts';
import {videoRuntime} from './modules/video/tools.ts';
import {ensureVideoInstructions} from './modules/video/instructions.ts';
import { Decisions, DecisionError, fingerprint } from './modules/decisions/service.ts';
import { decisionRoutes } from './modules/decisions/routes.ts';
import { decisionRuntime } from './modules/decisions/tools.ts';
import { Permissions, PermissionError } from './modules/permissions/service.ts';
import { permissionRoutes } from './modules/permissions/routes.ts';
import { JevEvaluator, offlineEvaluator, unavailableEvaluator } from './modules/permissions/evaluator.ts';
import { Attachments } from './modules/attachments/service.ts';
import { ImageStorage, AttachmentError } from './modules/attachments/storage.ts';
import { attachmentRoutes } from './modules/attachments/routes.ts';
import { filesystemRuntime, loadFilesystemConfig } from './modules/filesystem/runtime.ts';
import { composeToolRuntimes } from './modules/tools/contract.ts';
import { topicRuntime } from './modules/context/tools.ts';
import { TopicRetrieval } from './modules/context/retrieval.ts';
import { Organization, OrganizationError } from './modules/organization/service.ts';
import { organizationRoutes } from './modules/organization/routes.ts';
import Fastify from 'fastify';
import postgres from 'postgres';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerConfig, ScratchChange } from '@ash/shared';
import { previewSource } from './platform/preview.ts';

const config = ServerConfig.parse(JSON.parse(await readFile(process.argv[2], 'utf8')));
const { instance, token } = config;
const source = previewSource(instance.checkout);
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
const modelSession=modelSessionId?await openSession(instance,modelSessionId):undefined;
const model = modelSession ? openAIModel({...modelSession,apiKey:await readOpenAIKey(instance.checkout)}) : deterministicModel;
const imageStorage=new ImageStorage(instance.root);
await imageStorage.prepare();
const video=new VideoAnalysis(product,imageStorage,modelSession?geminiVideoProvider({readKey:()=>readGeminiKey(instance.checkout),reserve:()=>modelSession.reserve()}):deterministicVideoProvider);
await ensureVideoInstructions(product);
const attachments=new Attachments(product,imageStorage,model,true,video);
const decisions=new Decisions(product);
const jevKey=modelSessionId?await readJevKey(instance.checkout):undefined;
const permissions=new Permissions(product,decisions,modelSessionId?(jevKey?new JevEvaluator(jevKey):unavailableEvaluator):offlineEvaluator,model);
let filesystemImport='',filesystemImporting:Promise<void>|undefined;
const filesystemConfiguration=async()=>{
  const settings=await loadFilesystemConfig(instance.profile==='preview'?instance.checkout:instance.root,instance.checkout),revision=fingerprint(settings);
  if(revision!==filesystemImport){
    await filesystemImporting;
    if(revision!==filesystemImport){
      const importing=permissions.seed(settings,instance.checkout).then(()=>{filesystemImport=revision;});filesystemImporting=importing;
      try{await importing;}finally{if(filesystemImporting===importing)filesystemImporting=undefined;}
    }
  }
  return settings;
};
await permissions.seed();await filesystemConfiguration().catch(()=>undefined);
await ensureRoutingInstruction(product);
const modelRouting=model.routingConfiguration?new ModelRouting(product,model,jevRouter(jevKey)):undefined;
const threads = new Threads(product,model,true,imageStorage,composeToolRuntimes(decisionRuntime(decisions),topicRuntime(new TopicRetrieval(product)),filesystemRuntime(filesystemConfiguration,modelSessionId?'all':'offline-demo',true),videoRuntime(video)),undefined,decisions,permissions,modelRouting);
await threads.recover();
await ensureEngineInstructions(product);
const incoming=new Incoming(product,threads,model);
await incoming.recover();
const incomingTimer=setInterval(()=>{void incoming.pump().catch(()=>console.error('Incoming processing unavailable'));},1000);incomingTimer.unref();
await attachments.recover();await attachments.cleanup();
const cleanupTimer=setInterval(()=>{void attachments.cleanup().catch(()=>console.error('Image cleanup failed'));},60*60*1000);cleanupTimer.unref();
await ensureVisibilityInstructions(product);
const visibility=new ThreadVisibility(product,model);await visibility.recover();
const visibilityTimer=setInterval(()=>{void visibility.pump().catch(()=>console.error('Thread assessment scheduling unavailable'));},5000);visibilityTimer.unref();
const app = Fastify({ logger: false });
app.addHook('onRequest', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: 'Unauthorized' });
});
threadRoutes(app, threads);
incomingRoutes(app,incoming);
attachmentRoutes(app,attachments);
organizationRoutes(app,new Organization(product));
decisionRoutes(app,decisions);permissionRoutes(app,permissions);
const decisionTimer=setInterval(()=>{void decisions.wake().then(()=>threads.resumeWaiting()).catch(()=>console.error('Decision recovery failed'));},1000);decisionTimer.unref();
app.get('/health', async () => {
  const [meta] = await db`SELECT instance_id, generation, schema_version FROM dev_meta`;
  if (meta.instance_id !== instance.id || meta.generation !== instance.generation || meta.schema_version !== instance.schemaVersion) {
    throw new Error('Database identity does not match this instance');
  }
  return { ready: true, instanceId: instance.id, generation: instance.generation, schemaVersion: meta.schema_version };
});
app.get('/api/info', async () => ({
  label: instance.label, workspaceId: instance.workspaceId, instanceId: instance.id,
  checkout: instance.checkout, source: await source(),
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
  if (error instanceof ZodError) return reply.code(400).send({error:'Invalid thread request.'});
  if (error instanceof ThreadError) return reply.code(error.status).send({error:error.message});
  if (error instanceof OrganizationError) return reply.code(error.status).send({error:error.message});
  if (error instanceof DecisionError || error instanceof PermissionError) return reply.code(error.status).send({error:error.message});
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
  clearInterval(visibilityTimer);await visibility.stop();clearInterval(cleanupTimer);clearInterval(incomingTimer);clearInterval(decisionTimer);await app.close();await incoming.stop(); await threads.stop();await attachments.stop(); await product.$disconnect(); ownership.release(); await ownerDb.end(); await db.end(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('disconnect', stop);
