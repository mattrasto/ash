import { measure, recordResource } from './telemetry.ts';
import postgres from 'postgres';
import { initializeProduct } from './product-database.ts';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { type Instance } from '../../packages/shared/src/index.ts';
import { atomic, exec, exists, id, json, secret, withLock } from './io.ts';

export interface Cluster { id: string; password: string; port: number; containerId?: string; composeHash?: string }
interface ContainerState {
  id: string; owner: string; running: boolean; health: string | null;
  ports: Record<string, Array<{HostIp: string; HostPort: string}> | null>;
}
async function inspectContainer(name: string): Promise<ContainerState | undefined> {
  try {
    const { stdout } = await exec('docker', ['container', 'inspect', '--format',
      '{"id":{{json .Id}},"owner":{{json (index .Config.Labels "dev.ash.cluster")}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"ports":{{json .NetworkSettings.Ports}}}', name]);
    return JSON.parse(stdout);
  } catch (e) {
    if (/No such (object|container)/i.test((e as {stderr?: string}).stderr ?? '')) return undefined;
    throw e;
  }
}
export function databaseUrl(cluster: Cluster, database = 'postgres', role = 'ash_admin', password = cluster.password) {
  return `postgres://${role}:${password}@127.0.0.1:${cluster.port}/${database}`;
}
export function connect(cluster: Cluster, database = 'postgres') {
  return postgres(databaseUrl(cluster, database), { max: 1, connect_timeout: 5, onnotice: () => {} });
}
export async function ensureCluster(root: string, checkout: string): Promise<Cluster> {
  return withLock(root, 'cluster', async () => {
    const path = join(root, 'cluster.json');
    const registered = await exists(path);
    const cluster: Cluster = registered ? await json<Cluster>(path) : { id: id(), password: secret(), port: 0 };
    if (!registered) await atomic(path, cluster);
    if (!registered && process.env.ASH_TEST_EVIDENCE && root.startsWith(join(process.env.ASH_TEST_EVIDENCE,'tmp') + '/')) recordResource('clusters',cluster.id,{id:cluster.id,root});
    const name = `ash-dev-${cluster.id}`;
    const composeHash = createHash('sha256').update(await readFile(join(checkout, 'compose.yaml'))).digest('hex');
    let container = await inspectContainer(name);
    if (container && container.owner !== cluster.id) throw new Error('Development container ownership mismatch');
    const needsSetup = !container?.running || container.health !== 'healthy' || container.id !== cluster.containerId || composeHash !== cluster.composeHash;
    if (needsSetup) {
      await exec('docker', ['compose', '-f', join(checkout, 'compose.yaml'), '-p', name, 'up', '-d', '--wait'], {
        env: { ...process.env, ASH_DEV_CLUSTER_ID: cluster.id, ASH_DEV_PG_PASSWORD: cluster.password }, timeout: 120_000,
      });
      container = await inspectContainer(name);
    }
    if (!container || container.owner !== cluster.id || !container.running || container.health !== 'healthy') throw new Error('Owned development database is not healthy');
    const bindings = container.ports['5432/tcp'];
    if (bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(bindings[0].HostPort)) throw new Error('Development database is not bound exclusively to loopback');
    const port = Number(bindings[0].HostPort);
    if (port < 1 || port > 65535) throw new Error('Invalid development database port');
    const updated = { ...cluster, port, containerId: container.id, composeHash };
    const db = connect(updated);
    try {
      if (needsSetup) await db`CREATE TABLE IF NOT EXISTS ash_dev_cluster (id text PRIMARY KEY)`;
      const rows = await db`SELECT id FROM ash_dev_cluster`;
      if (!rows.length && needsSetup) await db`INSERT INTO ash_dev_cluster VALUES (${cluster.id})`;
      else if (rows.length !== 1 || rows[0].id !== cluster.id) throw new Error('Development database cluster identity mismatch');
      if (needsSetup) await db.unsafe('REVOKE ALL ON DATABASE postgres FROM PUBLIC');
    } finally { await db.end(); }
    if (needsSetup || cluster.port !== port) await atomic(path, updated);
    return updated;
  });
}
export async function checkedCluster(instance: Instance) {
  const cluster = await json<Cluster>(join(instance.devRoot, 'cluster.json'));
  if (cluster.id !== instance.clusterId) throw new Error('Cluster ownership mismatch');
  const { stdout } = await exec('docker', ['container', 'inspect', '--format', '{{index .Config.Labels "dev.ash.cluster"}}', `ash-dev-${cluster.id}`]);
  if (stdout.trim() !== cluster.id) throw new Error('Container ownership mismatch');
  const db = connect(cluster);
  try {
    const rows = await db`SELECT id FROM ash_dev_cluster`;
    if (rows[0]?.id !== cluster.id) throw new Error('Cluster identity mismatch');
  } finally { await db.end(); }
  return cluster;
}
function ident(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe SQL identifier');
  return `"${value}"`;
}
const marker = (instance: Instance) => `ash-dev:${instance.clusterId}:${instance.id}`;
export async function assertDatabaseOwner(instance: Instance, cluster: Cluster) {
  const db = connect(cluster);
  try {
    const rows = await db`SELECT shobj_description(oid, 'pg_database') AS marker, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${instance.database}`;
    if (!rows.length) return false;
    if (rows[0].marker !== marker(instance) || rows[0].owner !== instance.ownerRole) throw new Error('Database ownership mismatch; refusing mutation');
    return true;
  } finally { await db.end(); }
}
export async function provision(instance: Instance, cluster: Cluster) {
  const admin = connect(cluster);
  const password = secret();
  try {
    await admin.begin(async tx => {
      await tx.unsafe(`CREATE ROLE ${ident(instance.ownerRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await tx.unsafe(`CREATE ROLE ${ident(instance.runtimeRole)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
      for (const role of [instance.ownerRole, instance.runtimeRole]) await tx.unsafe(`COMMENT ON ROLE ${ident(role)} IS '${marker(instance)}'`);
    });
    await admin.unsafe(`CREATE DATABASE ${ident(instance.database)} OWNER ${ident(instance.ownerRole)}`);
    await admin.unsafe(`COMMENT ON DATABASE ${ident(instance.database)} IS '${marker(instance)}'`);
    await admin.unsafe(`REVOKE ALL ON DATABASE ${ident(instance.database)} FROM PUBLIC`);
    await admin.unsafe(`GRANT CONNECT ON DATABASE ${ident(instance.database)} TO ${ident(instance.runtimeRole)}`);
  } finally { await admin.end(); }
  await measure('database.migrate', () => initializeProduct(instance, cluster), instance.id);
  await writeFile(join(instance.root, 'files/note.txt'), '', { mode: 0o600 });
  await atomic(join(instance.root, 'server.json'), { instance, databaseUrl: databaseUrl(cluster, instance.database, instance.runtimeRole, password), token: secret(), ...(instance.profile === 'test' && process.env.ASH_TEST_TIMING === 'accelerated' ? {testTiming:'accelerated'} : {}) });
}
export async function dropDatabase(instance: Instance, cluster: Cluster) {
  const databaseExists = await assertDatabaseOwner(instance, cluster);
  const db = connect(cluster);
  try {
    const roles = await db`SELECT rolname, shobj_description(oid, 'pg_authid') AS marker FROM pg_roles WHERE rolname IN (${instance.runtimeRole}, ${instance.ownerRole})`;
    if (roles.some(role => role.marker !== marker(instance))) throw new Error('Role ownership mismatch; refusing mutation');
    if (databaseExists) {
      await db`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${instance.database} AND pid <> pg_backend_pid()`;
      await db.unsafe(`DROP DATABASE ${ident(instance.database)}`);
    }
    for (const role of roles) await db.unsafe(`DROP ROLE ${ident(role.rolname)}`);
  } finally { await db.end(); }
}

// Recovery for a separately owned disposable cluster; the caller validates its session root.
export async function disposeTestCluster(clusterId: string) {
  if (!/^[a-f0-9]{24}$/.test(clusterId)) throw new Error('Invalid cluster identity');
  const name = `ash-dev-${clusterId}`;
  const container = await inspectContainer(name);
  if (container) {
    if (container.owner !== clusterId) throw new Error('Test cluster ownership mismatch');
    await exec('docker',['rm','-f',name]);
  }
  try {
    const label = (await exec('docker',['volume','inspect','--format','{{index .Labels "dev.ash.cluster"}}',name])).stdout.trim();
    if (label !== clusterId) throw new Error('Test volume ownership mismatch');
    await exec('docker',['volume','rm',name]);
  } catch (error) {
    if (!(error as {stderr?:string}).stderr?.toLowerCase().includes('no such volume')) throw error;
  }
}
