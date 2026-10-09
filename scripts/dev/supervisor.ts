import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { Instance, ServerConfig } from '../../packages/shared/src/index.ts';
import { atomic, json, processRef, stopProcess, fingerprint, childEnvironment } from './io.ts';
import { buildMain, rendererConfig } from './build.ts';
import type { Runtime } from './lifecycle.ts';

const instance = Instance.parse(await json(process.argv[2]));
const config = ServerConfig.parse(await json(join(instance.root, 'server.json')));
const require = createRequire(join(instance.checkout, 'package.json'));
const headless = process.argv.includes('--headless');
const windowed = process.argv.includes('--windowed') || instance.profile !== 'preview';
const background = process.argv.includes('--background');
let state: Runtime = { phase: 'starting', instanceId: instance.id, generation: instance.generation, supervisor: await processRef(process.pid), children: [] };
let vite: ViteDevServer | undefined;
let stopping = false;
let restarting = false;
let electronChild: ChildProcess | null = null;
const watchers: FSWatcher[] = [];
const save = () => atomic(join(instance.root, 'runtime.json'), state);
const log = await open(join(instance.root, 'logs/server.log'), 'a', 0o600);
async function remember(child: ChildProcess) {
  const ref = await processRef(child.pid!);
  state.children.push(ref); await save();
  return ref;
}
async function launchClient(options: { windowed?: boolean; background?: boolean } = {}) {
  if (electronChild && electronChild.exitCode === null && !electronChild.killed) return;
  const mainPath = await buildMain(instance.checkout, join(instance.root, 'build'));
  await atomic(join(instance.root, 'client.json'), { root: instance.root, label: instance.label, instanceId: instance.id,
    url: state.webUrl, windowed: options.windowed ?? windowed, background: options.background ?? background });
  electronChild = spawn(require('electron') as string, [mainPath], {
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
  child.once('exit', () => { if (electronChild === child) electronChild = null; });
  await remember(child);
  await ready;
}
async function startServices() {
  const server = spawn(process.execPath, ['--import', require.resolve('tsx'), join(instance.checkout, 'packages/server/src/main.ts'), join(instance.root, 'server.json')], {
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
  // Vite interprets zero as its default port, so retry actual binds instead.
  for (let attempt = 0; attempt < 12; attempt++) {
    vite = await createViteServer({ ...rendererConfig(instance.checkout, join(instance.root, 'build')), server: {
      host: '127.0.0.1', port: randomInt(20000, 60000), strictPort: true, cors: false,
      fs: { strict: true, allow: [join(instance.checkout, 'packages'), join(instance.checkout, 'node_modules'), join(instance.root, 'build/vite-cache')] },
      proxy: { '/api': { target: state.serverUrl, headers: { authorization: `Bearer ${config.token}` } } },
    } });
    try { await vite.listen(); break; }
    catch (e) { await vite.close(); if (!/in use|EADDRINUSE/.test((e as Error).message) || attempt === 11) throw e; }
  }
  const address = vite!.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Missing frontend address');
  state.webUrl = `http://127.0.0.1:${address.port}`;
  state.source = await fingerprint(instance.checkout);
  if (!headless) await launchClient();
  state.phase = 'ready'; await save();
  server.once('exit', () => { if (!stopping && !restarting) void shutdown('failed', 'Backend exited unexpectedly'); });
}
async function stopServices() {
  for (const ref of [...state.children].reverse()) await stopProcess(ref, true);
  state.children = []; electronChild = null;
  await vite?.close(); vite = undefined;
}
const control = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${config.token}`) { response.writeHead(401).end(); return; }
  response.setHeader('content-type', 'application/json');
  try {
    const url = new URL(request.url!, 'http://127.0.0.1');
    if (url.pathname === '/stop') { response.end('{"stopping":true}'); void shutdown('stopped'); }
    else if (url.pathname === '/open') {
      await launchClient({ ...(url.searchParams.has('windowed') ? {windowed:true} : {}), ...(url.searchParams.has('background') ? {background:true} : {}) });
      response.end('{"opened":true}');
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
  for (const path of ['packages/server/src', 'packages/shared/src', 'packages/client/src/main', 'packages/client/src/preload']) {
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
