import { measure } from './telemetry.ts';
import { migrateProduct } from './product-database.ts';
import { spawn } from 'node:child_process';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Instance, Fixture, ServerConfig } from '../../packages/shared/src/index.ts';
import { atomic, exists, json, id, withLock, processRef, alive, stopProcess, sleep, childEnvironment, type ProcessRef } from './io.ts';
import { type Workspace, readInstance, directories } from './workspace.ts';
import { assertDatabaseOwner, checkedCluster, ensureCluster, dropDatabase, provision } from './database.ts';
import { readSession } from '../../packages/server/src/platform/models/session.ts';

export interface Runtime {
  phase: 'starting' | 'ready' | 'stopped' | 'failed'; instanceId: string; generation: string;
  supervisor: ProcessRef; children: ProcessRef[]; serverUrl?: string; webUrl?: string; controlUrl?: string;
  source?: { commit: string; hash: string }; error?: string;
  modelSessionId?: string;
}
export async function runtime(instance: Instance) {
  const path = join(instance.root, 'runtime.json');
  if (!await exists(path)) return null;
  const value = await json<Runtime>(path);
  if (value.instanceId !== instance.id || value.generation !== instance.generation) throw new Error('Runtime identity mismatch');
  return value;
}
export async function control(instance: Instance, action: string, options?: { windowed?: boolean; background?: boolean }) {
  const state = await runtime(instance);
  if (!state?.controlUrl || !await alive(state.supervisor)) throw new Error('Instance supervisor is not running');
  const config = ServerConfig.parse(await json(join(instance.root, 'server.json')));
  const query = new URLSearchParams();
  if (options?.windowed) query.set('windowed', 'true');
  if (options?.background) query.set('background', 'true');
  const response = await fetch(`${state.controlUrl}/${action}?${query}`, { method: 'POST', headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Instance control failed (${response.status})`);
  return response.json();
}
async function recover(instance: Instance, state: Runtime) {
  // A process group is ours only while its registered leader has the same start identity.
  for (const ref of state.children) {
    if (!ref.identity.includes(instance.root)) throw new Error('Process ownership record is outside this instance');
    await stopProcess(ref, true);
  }
}
export async function startInstance(ws: Workspace, instanceId: string, options: { headless?: boolean; windowed?: boolean; background?: boolean; modelSessionId?: string } = {}) {
  return measure('services.ready', () => withLock(ws.devRoot, `instance-${instanceId}`, async () => {
    const instance = await readInstance(ws, instanceId);
    if (options.modelSessionId) await readSession(instance,options.modelSessionId);
    const cluster = await ensureCluster(ws.devRoot, ws.checkout);
    if (cluster.id !== instance.clusterId) throw new Error('Cluster ownership mismatch');
    if (!await assertDatabaseOwner(instance, cluster)) throw new Error('Missing instance database; reset explicitly');
    const configPath = join(instance.root, 'server.json');
    const config = ServerConfig.parse(await json(configPath));
    const databaseUrl = new URL(config.databaseUrl);
    if (databaseUrl.port !== String(cluster.port)) {
      databaseUrl.port = String(cluster.port);
      await atomic(configPath, {...config, databaseUrl:databaseUrl.toString()});
    }
    const prior = await runtime(instance);
    if (prior && await alive(prior.supervisor)) {
      if (prior.modelSessionId !== options.modelSessionId) throw new Error('Stop the running instance before changing its model session');
      if (prior.phase !== 'ready') throw new Error('Instance is not ready; inspect status or stop it');
      let healthy = false;
      try {
        const response = await fetch(`${prior.serverUrl}/health`, {headers:{authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(2000)});
        const health = await response.json() as {instanceId?:string;generation?:string};
        healthy = response.ok && health.instanceId === instance.id && health.generation === instance.generation;
      } catch {}
      if (healthy) {
        if (!options.headless) await control(instance, 'open', options);
        return (await runtime(instance))!;
      }
      await stopUnlocked(instance);
    }
    if (prior) await recover(instance, prior);
    await measure('database.migrate', () => migrateProduct(instance, cluster), instance.id);
    const log = await open(join(instance.root, 'logs/supervisor.log'), 'a', 0o600);
    const require = createRequire(join(ws.checkout, 'package.json'));
    const child = spawn(process.execPath, ['--import', require.resolve('tsx'), join(ws.checkout, 'scripts/dev/supervisor.ts'), join(instance.root, 'instance.json'),
      ...(options.modelSessionId ? ['--model-session',options.modelSessionId] : []),
      ...(options.headless ? ['--headless'] : []), ...(options.windowed ? ['--windowed'] : []), ...(options.background ? ['--background'] : [])],
    { cwd: ws.checkout, detached: true, stdio: ['ignore', log.fd, log.fd], env: childEnvironment(join(instance.root, 'tmp')) });
    child.unref(); await log.close();
    const ref = await processRef(child.pid!);
    for (let i = 0; i < 600; i++) {
      const current = await runtime(instance).catch(() => null);
      if (current?.supervisor.pid === ref.pid && current.phase === 'ready') return current;
      if (current?.supervisor.pid === ref.pid && current.phase === 'failed') throw new Error(current.error ?? 'Startup failed');
      if (!await alive(ref)) throw new Error(`Launcher exited; see ${join(instance.root, 'logs/supervisor.log')}`);
      await sleep(100);
    }
    await stopProcess(ref, true);
    throw new Error(`Startup timed out; see ${join(instance.root, 'logs/supervisor.log')}`);
  }), instanceId);
}
async function stopUnlocked(instance: Instance) {
  const state = await runtime(instance);
  if (!state) return;
  if (await alive(state.supervisor)) {
    if (!state.supervisor.identity.includes(instance.root)) throw new Error('Supervisor ownership mismatch');
    try { await control(instance, 'stop'); } catch { await stopProcess(state.supervisor, true); }
    for (let i = 0; i < 100 && await alive(state.supervisor); i++) await sleep(100);
    if (await alive(state.supervisor)) await stopProcess(state.supervisor, true);
  }
  await recover(instance, state);
  await atomic(join(instance.root, 'runtime.json'), { ...state, phase: 'stopped', children: [], controlUrl: undefined, serverUrl: undefined, webUrl: undefined });
}
export async function stopInstance(ws: Workspace, instanceId = ws.previewId) {
  return withLock(ws.devRoot, `instance-${instanceId}`, async () => stopUnlocked(await readInstance(ws, instanceId)));
}
export async function resetInstance(ws: Workspace, instanceId = ws.previewId, fixture: Fixture = 'scratchpad') {
  return withLock(ws.devRoot, `instance-${instanceId}`, async () => {
    const instance = await readInstance(ws, instanceId);
    const cluster = await checkedCluster(instance);
    await assertDatabaseOwner(instance, cluster);
    await stopUnlocked(instance);
    await dropDatabase(instance, cluster);
    await rm(instance.root, { recursive: true });
    const fresh = { ...instance, fixture, generation: id() };
    await directories(fresh.root);
    await atomic(join(fresh.root, 'instance.json'), fresh);
    await provision(fresh, cluster);
    return fresh;
  });
}
export async function disposeInstance(ws: Workspace, instanceId = ws.previewId) {
  return measure('instance.cleanup', () => withLock(ws.devRoot, `instance-${instanceId}`, async () => {
    const instance = await readInstance(ws, instanceId);
    const cluster = await checkedCluster(instance);
    await assertDatabaseOwner(instance, cluster);
    await stopUnlocked(instance);
    await dropDatabase(instance, cluster);
    await rm(instance.root, { recursive: true });
  }), instanceId);
}

// A verifier may race the fixture's own teardown or recover after its checkout was removed.
export async function recoverRecordedInstance(instance: Instance) {
  if (!await exists(instance.root)) return;
  const ws = await json<Workspace>(join(instance.devRoot, 'registry', `${instance.workspaceId}.json`));
  if (ws.version !== 1 || ws.id !== instance.workspaceId || ws.checkout !== instance.checkout || ws.devRoot !== instance.devRoot) throw new Error('Workspace registry mismatch during recovery');
  try { await disposeInstance(ws, instance.id); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || await exists(instance.root)) throw error;
  }
}
