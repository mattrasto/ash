import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { open,readFile,rm } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';
import type { ViteDevServer } from 'vite';
import { Instance, ServerConfig, RecordingOrigin } from '../../packages/shared/src/index.ts';
import { atomic, json, processRef, stopProcess, fingerprint, childEnvironment } from './io.ts';
import { measure, testEvent } from './telemetry.ts';
import type { Runtime } from './lifecycle.ts';
import {RendererReleaseHost} from './renderer-release-host.ts';
import {readActive} from './release-store.ts';

const instance = Instance.parse(await json(process.argv[2]));
testEvent({id:`${process.pid}-bootstrap`,kind:'phase',name:'services.bootstrap',context:instance.id,status:'passed',at:Date.now(),durationMs:Math.round(performance.now())});
const config = ServerConfig.parse(await json(join(instance.root, 'server.json')));
const require = createRequire(join(instance.checkout, 'package.json'));
const headless = process.argv.includes('--headless');
const windowed = process.argv.includes('--windowed') || instance.profile !== 'preview';
const background = process.argv.includes('--background');
const debugging=process.argv.includes('--debugging')&&background&&instance.profile==='test'&&!config.candidatePreview;
const modelSessionId = process.argv.includes('--model-session') ? process.argv[process.argv.indexOf('--model-session')+1] : undefined;
const frontendPath = join(instance.root, 'frontend.json');
let frontendPort: number | undefined;
try { frontendPort = (await json<{port:number}>(frontendPath)).port; }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  // Upgrade an existing desktop without moving its browser-storage origin.
  try {
    const {url} = await json<{url:string}>(join(instance.root, 'client.json'));
    const previous = new URL(url);
    if (previous.protocol !== 'http:' || previous.hostname !== '127.0.0.1') throw new Error('Invalid saved preview address');
    frontendPort = Number(previous.port);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
if (frontendPort !== undefined && (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535)) throw new Error('Invalid saved preview port');
let state: Runtime = { phase: 'starting', instanceId: instance.id, generation: instance.generation, supervisor: await processRef(process.pid), children: [], modelSessionId,rendererUpdates:!config.candidatePreview };
let vite: ViteDevServer | undefined;
let stopping = false;
let restarting = false;
let electronChild: ChildProcess | null = null;
const watchers: FSWatcher[] = [];
const save = () => atomic(join(instance.root, 'runtime.json'), state);
const log = await open(join(instance.root, 'logs/server.log'), 'a', 0o600);
const releases=new RendererReleaseHost(instance,restartClientAndCheck);
async function clientResult(type:string,reply:string,timeout=5000):Promise<boolean>{
  const child=electronChild;if(!child?.connected)throw Error('Open the managed Ash desktop before applying an update.');
  const requestId=String(Date.now())+Math.random();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.off('message',listener);reject(Error('Desktop restart check timed out.'));},timeout);
    const listener=(value:unknown)=>{const message=value as {type?:string;requestId?:string;ready?:boolean};if(message.type===reply&&message.requestId===requestId){clearTimeout(timer);child.off('message',listener);resolve(!!message.ready);}};
    child.on('message',listener);child.send({type,requestId});
  });
}
async function restartClientAndCheck(){
  const previous=electronChild;
  if(previous){previous.send({type:'quit-for-update'});await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Desktop did not stop safely.')),15000);previous.once('exit',()=>{clearTimeout(timer);resolve();});});}
  await launchClient();
  await checkClientHealth();
}
async function checkClientHealth(){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){if(await clientResult('release-health','release-health'))return;await new Promise(resolve=>setTimeout(resolve,200));}
  throw Error('Updated UI failed its startup health check.');
}
async function remember(child: ChildProcess) {
  const ref = await processRef(child.pid!);
  state.children.push(ref); await save();
  return ref;
}
async function launchClient(options: { windowed?: boolean; background?: boolean;threadId?:string;origin?:RecordingOrigin } = {}) {
  if (electronChild && electronChild.exitCode === null && !electronChild.killed) {electronChild.send({type:'open',threadId:options.threadId,origin:options.origin});return;}
  const { buildMain } = await import('./build.ts');
  const mainPath = await buildMain(instance.checkout, join(instance.root, 'build'));
  const installed=await readActive(instance);
  await atomic(join(instance.root, 'client.json'), { root: instance.root, label: instance.label+(installed?' · UI '+installed.current.slice(0,7):''),installedUI:installed?.current, instanceId: instance.id,
    url: state.webUrl, windowed: options.windowed ?? windowed, background: options.background ?? background,candidatePreview:!!config.candidatePreview,...(config.candidatePreview?{returnToThread:{instancePath:config.candidatePreview.ownerInstancePath,threadId:config.candidatePreview.threadId}}:{}) });
  if(debugging)await rm(join(instance.root,'electron','DevToolsActivePort'),{force:true});
  electronChild = spawn(require('electron') as string, [mainPath,...(debugging?['--remote-debugging-port=0']:[])], {
    cwd: instance.checkout, detached: true, stdio: ['ignore', log.fd, log.fd, 'ipc'],
    env: { ...childEnvironment(join(instance.root, 'tmp')), ASH_CLIENT_CONFIG: join(instance.root, 'client.json') },
  });
  const child = electronChild;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Desktop readiness timed out')), 20_000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Desktop exited during startup (${code})`)); });
    child.on('message', (message: unknown) => {
      if ((message as { type?: string }).type === 'client-ready') { clearTimeout(timer); resolve(); }
    });
  });
  child.once('exit', () => {
    if (electronChild !== child) return;
    electronChild = null; state.desktop = undefined;
    // Closing a candidate window ends its preview, while retaining its test data.
    if (config.candidatePreview && !stopping && !restarting) void shutdown('stopped');
    else if (!stopping) void save();
  });
  state.desktop = await remember(child); await save();
  await ready;
  if(!config.candidatePreview&&await releases.needsRecovery()){await checkClientHealth();await releases.confirmRecovery();}
  if(debugging){state.debuggingPort=Number((await readFile(join(instance.root,'electron','DevToolsActivePort'),'utf8')).split('\n')[0]);await save();}
  if(options.threadId)child.send({type:'open',threadId:options.threadId,origin:options.origin});
}
async function startBackend() {
  const server = spawn(process.execPath, ['--import', require.resolve('tsx'), join(instance.checkout, 'packages/server/src/main.ts'), join(instance.root, 'server.json'), ...(modelSessionId ? [modelSessionId] : [])], {
    cwd: instance.checkout, detached: true, stdio: ['ignore', log.fd, log.fd, 'ipc'], env: childEnvironment(join(instance.root, 'tmp')),
  });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend readiness timed out')), 20_000);
    server.once('error', e => { clearTimeout(timer); reject(e); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited (${code})`)); });
    server.on('message', (message: unknown) => {
      const value = message as { type?: string; url?: string };
      if (value.type === 'listening' && value.url) { clearTimeout(timer); resolve(value.url); }
    });
  });
  await remember(server);
  state.serverUrl = await ready;
  const response = await fetch(`${state.serverUrl}/health`, { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(5000) });
  const health = await response.json() as { instanceId: string; generation: string; schemaVersion: number };
  if (!response.ok || health.instanceId !== instance.id || health.generation !== instance.generation || health.schemaVersion !== instance.schemaVersion) throw new Error('Backend readiness identity mismatch');
  return server;
}
async function startServices() {
  if(config.candidatePreview?.releaseId)await releases.serveVerifiedPreview(config.candidatePreview.ownerInstancePath,config.candidatePreview.releaseId);
  else if(config.candidatePreview?.rendererBuild)releases.serveCompiledPreview(config.candidatePreview.rendererBuild);
  else if(config.candidatePreview)throw Error('Reopen the Adapt preview to compile it with protected filesystem access.');
  else if(!config.candidatePreview)await releases.initialize();
  const preparation = [
    measure('services.backend', startBackend, instance.id),
    measure('source.fingerprint', () => fingerprint(instance.checkout), instance.id),
    measure('services.modules', () => Promise.all([import('vite'), import('./build.ts')]), instance.id),
  ] as const;
  const [server, source, [{ createServer: createViteServer }, { rendererConfig }]] = await Promise.all(preparation).catch(async error => {
    // Drain launched work before shutdown so no late child can escape recovery.
    await Promise.allSettled(preparation);throw error;
  });
  // Keep the browser-storage origin stable. Only a new instance may choose another port.
  await measure('services.frontend', async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const renderer=rendererConfig(instance.checkout, join(instance.root, 'build'));
      vite = await createViteServer({ ...renderer,plugins:[{name:'ash-local-ui-release',configureServer(server){server.middlewares.use(releases.middleware);}},...renderer.plugins??[]], server: {
        // Feature tests need production transition semantics, not the pinned Svelte HMR wrapper.
        hmr: instance.profile !== 'test',
        host: '127.0.0.1', port: frontendPort ?? randomInt(20000, 60000), strictPort: true, cors: false,
        fs: { strict: true, allow: config.candidatePreview?[join(config.candidatePreview.checkout,'packages/client/src/renderer'),join(config.candidatePreview.checkout,'packages/client/index.html'),join(instance.checkout,'packages/shared'),join(instance.checkout,'node_modules'),join(instance.root,'build/vite-cache')]:[join(instance.checkout, 'packages'), join(instance.checkout, 'node_modules'), join(instance.root, 'build/vite-cache')] },
        proxy: { '/api': { target: state.serverUrl, headers: { authorization: `Bearer ${config.token}` } } },
      } });
      try { await vite.listen(); break; }
      catch (e) {
        await vite.close();
        if (!/in use|EADDRINUSE/.test((e as Error).message) || attempt === 11) throw e;
        if (frontendPort !== undefined) throw new Error(`Preview port ${frontendPort} is in use. Stop its listener and start the preview again; the port is retained to preserve drafts and client preferences.`);
      }
    }
    const address = vite!.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing frontend address');
    state.webUrl = `http://127.0.0.1:${address.port}`;
    frontendPort = address.port;
    await atomic(frontendPath, {port:frontendPort});
  }, instance.id);
  state.source = source;
  if (!headless) await launchClient();
  state.phase = 'ready'; await save();
  server.once('exit', () => { if (!stopping && !restarting) void shutdown('failed', 'Backend exited unexpectedly'); });
}
async function stopServices() {
  for (const ref of [...state.children].reverse()) await stopProcess(ref, true);
  state.children = []; state.desktop = undefined; electronChild = null;
  await vite?.close(); vite = undefined;
}
const control = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${config.token}`) { response.writeHead(401).end(); return; }
  response.setHeader('content-type', 'application/json');
  try {
    const url = new URL(request.url!, 'http://127.0.0.1');
    if (url.pathname === '/stop') { response.end('{"stopping":true}'); void shutdown('stopped'); }
    else if (url.pathname === '/open') {
      await launchClient({ ...(url.searchParams.has('origin')?{origin:RecordingOrigin.parse(JSON.parse(url.searchParams.get('origin')!))}:{}), ...(url.searchParams.has('thread')&&/^[0-9a-f-]{36}$/.test(url.searchParams.get('thread')!)?{threadId:url.searchParams.get('thread')!}:{}), ...(url.searchParams.has('windowed') ? {windowed:true} : {}), ...(url.searchParams.has('background') ? {background:true} : {}) });
      response.end('{"opened":true}');
    }
    else if(url.pathname==='/capture'&&background&&config.candidatePreview){
      if(!electronChild?.connected)throw new Error('Preview window is not running.');
      const child=electronChild,requestId=String(Date.now());
      const png=await new Promise<string>((resolve,reject)=>{
        const timer=setTimeout(()=>{child.off('message',listener);reject(new Error('Preview capture timed out.'));},5000);
        const listener=(value:unknown)=>{const message=value as {type?:string;requestId?:string;png?:string};if(message.type==='captured'&&message.requestId===requestId){clearTimeout(timer);child.off('message',listener);resolve(message.png!);}};
        child.on('message',listener);child.send({type:'capture',requestId});
      });response.end(JSON.stringify({png}));
    }
    else if(url.pathname==='/refresh'){if(!electronChild?.connected)throw new Error('Preview window is not running.');electronChild.send({type:'refresh'});response.end('{"refreshed":true}');}
    else if(/^\/install\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(url.pathname)&&!config.candidatePreview){
      if(!await clientResult('prepare-restart','restart-ready'))throw Error('Finish recording, uploads, or open Settings edits before restarting.');
      const [,candidateId,decisionId]=url.pathname.slice(1).split('/');await releases.install(candidateId,decisionId);response.end('{"reconciled":true}');
    }
    else { response.writeHead(404).end('{}'); }
  } catch (e) { response.writeHead(500).end(JSON.stringify({ error: (e as Error).message })); }
});
async function shutdown(phase: 'stopped' | 'failed', error?: string) {
  if (stopping) return;
  stopping = true;
  for (const watcher of watchers) watcher.close();
  await stopServices(); control.close(); await log.close();
  state = { ...state, phase, error, controlUrl: undefined, serverUrl: undefined, webUrl: undefined }; await save();
  process.exit(phase === 'failed' ? 1 : 0);
}
await save();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void shutdown('stopped'));
process.on('uncaughtException', e => void shutdown('failed', e.message));
process.on('unhandledRejection', e => void shutdown('failed', String(e)));
try {
  await new Promise<void>(resolve => control.listen(0, '127.0.0.1', resolve));
  const address = control.address();
  if (!address || typeof address === 'string') throw new Error('Missing control address');
  state.controlUrl = `http://127.0.0.1:${address.port}`;
  await startServices();
  let debounce: ReturnType<typeof setTimeout>;
  for (const path of ['packages/server/src', 'packages/shared/src', 'packages/scenes/src', 'packages/client/src/main', 'packages/client/src/preload']) {
    watchers.push(watch(join(instance.checkout, path), { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        if (stopping || restarting) return;
        restarting = true;
        try { state.phase = 'starting'; await save(); await stopServices(); await startServices(); }
        catch (e) { await shutdown('failed', (e as Error).message); }
        finally { restarting = false; }
      }, 250);
    }));
  }
} catch (e) { await shutdown('failed', (e as Error).message); }
