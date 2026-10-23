import { measure, recordResource } from './telemetry.ts';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Instance, Fixture, SCHEMA_VERSION } from '../../packages/shared/src/index.ts';
import { atomic, exists, guardedPath, id, json, withLock, exec } from './io.ts';
import { ensureCluster, provision, assertDatabaseOwner } from './database.ts';

export interface Workspace { version: 1; id: string; checkout: string; label: string; devRoot: string; previewId: string }
export async function workspace(checkout: string, devRoot: string): Promise<Workspace> {
  checkout = await realpath(checkout);
  const top = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd: checkout })).stdout.trim();
  if (await realpath(top) !== checkout) throw new Error('Run development commands from the checkout root');
  return withLock(devRoot, 'workspaces', async () => {
    const path = join(checkout, '.ash-dev/workspace.json');
    await guardedPath(checkout, path);
    if (await exists(path)) {
      const data = await json<Workspace>(path);
      if (data.version !== 1 || data.checkout !== checkout || data.devRoot !== devRoot || !/^[a-f0-9]{24}$/.test(data.id)) throw new Error('Copied or incompatible workspace identity; refusing ownership');
      const record = await json<Workspace>(join(devRoot, 'registry', `${data.id}.json`));
      if (record.checkout !== checkout || record.previewId !== data.previewId) throw new Error('Workspace registry mismatch');
      return record;
    }
    const branch = (await exec('git', ['branch', '--show-current'], { cwd: checkout })).stdout.trim();
    const data: Workspace = { version: 1, id: id(), checkout, devRoot, previewId: id(), label: branch ? branch.replace(/^codex\//, '') : basename(checkout) };
    await atomic(join(devRoot, 'registry', `${data.id}.json`), data);
    await atomic(path, data);
    return data;
  });
}
export function instancePath(ws: Workspace, instanceId: string) {
  if (!/^[a-f0-9]{24}$/.test(instanceId)) throw new Error('Invalid instance ID');
  return join(ws.devRoot, 'workspaces', ws.id, instanceId === ws.previewId ? 'preview' : `verify/${instanceId}`);
}
export async function readInstance(ws: Workspace, instanceId = ws.previewId): Promise<Instance> {
  const root = instancePath(ws, instanceId);
  await guardedPath(ws.devRoot, root);
  const instance = Instance.parse(await json(join(root, 'instance.json')));
  if (instance.id !== instanceId || instance.workspaceId !== ws.id || instance.root !== root || instance.checkout !== ws.checkout || instance.devRoot !== ws.devRoot || instance.database !== `ash_d_${instanceId}` || instance.ownerRole !== `ash_o_${instanceId}` || instance.runtimeRole !== `ash_r_${instanceId}`) throw new Error('Instance ownership mismatch');
  return instance;
}
export async function createInstance(ws: Workspace, profile: 'preview' | 'verify' | 'test' = 'preview', fixture: Fixture = 'scratchpad', instanceId = profile === 'preview' ? ws.previewId : id()) {
  const root = instancePath(ws, instanceId);
  return withLock(ws.devRoot, `instance-${instanceId}`, async () => {
    await guardedPath(ws.devRoot, root);
    if (await exists(join(root, 'instance.json'))) {
      const prior = await readInstance(ws, instanceId);
      const cluster = await ensureCluster(ws.devRoot, ws.checkout);
      if (cluster.id !== prior.clusterId) throw new Error('Cluster ownership mismatch');
      if (!await assertDatabaseOwner(prior, cluster) || !await exists(join(root, 'server.json'))) throw new Error('Instance setup is incomplete; reset it explicitly');
      return prior;
    }
    const cluster = await ensureCluster(ws.devRoot, ws.checkout);
    const instance: Instance = { version: 1, id: instanceId, workspaceId: ws.id, checkout: ws.checkout, label: profile === 'preview' ? ws.label : `${ws.label} · ${profile} ${instanceId.slice(0, 6)}`,
      profile, fixture, root, devRoot: ws.devRoot, database: `ash_d_${instanceId}`, ownerRole: `ash_o_${instanceId}`, runtimeRole: `ash_r_${instanceId}`,
      clusterId: cluster.id, schemaVersion: SCHEMA_VERSION, generation: id() };
    await directories(root);
    await atomic(join(root, 'instance.json'), instance);
    recordResource('instances', instance.id, instance);
    await measure('database.provision', () => provision(instance, cluster), instance.id);
    return instance;
  });
}
export async function directories(root: string) {
  for (const name of ['files', 'electron', 'tmp', 'build', 'logs']) await mkdir(join(root, name), { recursive: true, mode: 0o700 });
}
