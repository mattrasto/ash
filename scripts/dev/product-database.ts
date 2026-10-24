import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Instance, SCHEMA_VERSION } from '../../packages/shared/src/index.ts';
import { BASE_INSTRUCTION_ID, BASE_INSTRUCTIONS, IMAGE_INSTRUCTION_ID, IMAGE_INSTRUCTIONS } from '../../packages/server/src/modules/instructions/defaults.ts';
import { assertDatabaseOwner, connect, databaseUrl, type Cluster } from './database.ts';
import { exec, childEnvironment } from './io.ts';
import { measure } from './telemetry.ts';

// Process-local receipts only: provisioning still deploys every fresh database.
const deployed = new Map<string, string>();
async function migrationInputs(checkout: string) {
  const root = join(checkout, 'packages/server/prisma');
  const directories = (await readdir(join(root, 'migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const migrations = await Promise.all(directories.map(async name => ({ name,
    checksum: createHash('sha256').update(await readFile(join(root, 'migrations', name, 'migration.sql'))).digest('hex'),
  })));
  const hash = createHash('sha256').update(JSON.stringify(migrations));
  for (const path of [join(root, 'schema.prisma'), join(root, 'migrations/migration_lock.toml'), join(checkout, 'pnpm-lock.yaml')]) hash.update(await readFile(path));
  return { migrations, hash: hash.digest('hex') };
}

// Called only after the development provisioner has checked this database's owner.
export async function migrateProduct(instance: Instance, cluster: Cluster, options: { reuseCurrent?: boolean } = {}) {
  const inputs = instance.profile === 'test' ? await migrationInputs(instance.checkout) : undefined;
  const receipt = `${instance.root}:${instance.generation}`;
  const inspection = connect(cluster,instance.database);
  let baseline = false, current = false;
  try {
    const [marker] = await inspection`SELECT instance_id, generation FROM dev_meta`;
    if (marker.instance_id !== instance.id || marker.generation !== instance.generation) throw new Error('Database identity mismatch before migration');
    const [table] = await inspection`SELECT to_regclass('public._prisma_migrations') AS name`;
    baseline = !table.name || !(await inspection`SELECT migration_name FROM _prisma_migrations LIMIT 1`).length;
    if (options.reuseCurrent && inputs && !baseline && deployed.get(receipt) === inputs.hash) {
      current = await measure('database.current', async () => {
        const rows = await inspection`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
        return rows.length === inputs.migrations.length && rows.every((row, index) =>
          row.finished_at !== null && row.rolled_back_at === null && row.migration_name === inputs.migrations[index].name && row.checksum === inputs.migrations[index].checksum);
      }, instance.id);
    }
  } finally { await inspection.end(); }
  if (!current) await deployProduct(instance, cluster, baseline);
  await configureProduct(instance, cluster);
  if (inputs) deployed.set(receipt, inputs.hash);
  return current ? 'current' : 'deployed';
}

// Only a newly created, owned database may run bootstrap as a real migration.
export async function initializeProduct(instance: Instance, cluster: Cluster) {
  if (!await assertDatabaseOwner(instance, cluster)) throw new Error('Fresh database ownership is missing');
  const inputs = instance.profile === 'test' ? await migrationInputs(instance.checkout) : undefined;
  const inspection = connect(cluster, instance.database);
  try {
    const [objects] = await inspection`SELECT EXISTS (
      SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
      UNION ALL SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      UNION ALL SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace
    ) AS present`;
    if (objects.present) throw new Error('Fresh migration requires an empty public schema');
    await inspection.unsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  } finally { await inspection.end(); }
  await deployProduct(instance, cluster, false);
  const db = connect(cluster, instance.database);
  try {
    await db.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE "${instance.ownerRole}"`);
      await tx.unsafe('INSERT INTO dev_meta VALUES ($1,$2,$3)', [instance.id, instance.generation, SCHEMA_VERSION]);
      await tx.unsafe('INSERT INTO dev_scratch VALUES (1,$1,0)', [instance.fixture === 'empty' ? '' : 'A little space to try things out.']);
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT ON dev_meta, dev_scratch TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE ON dev_scratch TO "${instance.runtimeRole}"`);
    });
  } finally { await db.end(); }
  await configureProduct(instance, cluster);
  if (inputs) deployed.set(`${instance.root}:${instance.generation}`, inputs.hash);
}

async function deployProduct(instance: Instance, cluster: Cluster, baseline: boolean) {
  const require = createRequire(join(instance.checkout, 'packages/server/package.json'));
  const url = new URL(databaseUrl(cluster, instance.database));
  url.searchParams.set('options', `-c role=${instance.ownerRole}`);
  const environment = {...childEnvironment(join(instance.root,'tmp')), ASH_MIGRATION_DATABASE_URL:url.toString()};
  try {
    if (baseline) await exec(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'resolve', '--applied', '202610090000_dev_bootstrap', '--schema', 'prisma/schema.prisma'], {cwd:join(instance.checkout,'packages/server'),timeout:60_000,env:environment});
    await measure('database.deploy', () => exec(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd:join(instance.checkout,'packages/server'), timeout:60_000,
      env:environment,
    }), instance.id);
  } catch (error) {
    const diagnostic = (error as {stderr?:string}).stderr ?? '';
    throw new Error(`Product migration failed; existing data was not reset. ${diagnostic.replaceAll(url.toString(),'[database]').replaceAll(cluster.password,'[redacted]')}`);
  }
}

async function configureProduct(instance: Instance, cluster: Cluster) {
  const db = connect(cluster,instance.database);
  try {
    await db.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE "${instance.ownerRole}"`);
      await tx.unsafe("INSERT INTO instructions (id,key,name,text,created_at,updated_at) VALUES ($1,'response','Base response instructions',$2,now(),now()) ON CONFLICT (key) DO NOTHING", [BASE_INSTRUCTION_ID,BASE_INSTRUCTIONS]);
      await tx.unsafe("INSERT INTO instructions (id,key,name,text,created_at,updated_at) VALUES ($1,'image-description','Image description instructions',$2,now(),now()) ON CONFLICT (key) DO NOTHING", [IMAGE_INSTRUCTION_ID,IMAGE_INSTRUCTIONS]);
      await tx.unsafe(`GRANT SELECT ON topics, threads, thread_topics, artifacts, instructions, runs, attachments, artifact_attachments TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT INSERT ON threads, artifacts, runs TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON scene_bundles TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE ON scene_state TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT ON application_changes, thread_assessments, incoming_items TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (status,finished_at,result) ON thread_assessments TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (status,state,error,updated_at) ON incoming_items TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT ON provider_continuations TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT ON permissions, decisions TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (effect, policy, updated_at, deleted_at) ON permissions TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (status, resolution, snoozed_until, updated_at) ON decisions TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT INSERT ON topics, thread_topics, instructions TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT DELETE ON thread_topics TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (name, instruction_id, deleted_at, updated_at) ON topics TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (text, updated_at) ON instructions TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (instruction_id, topics_version) ON threads TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT INSERT, DELETE ON attachments, artifact_attachments TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT DELETE ON artifacts, runs TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (summary_run_id, summary, expires_at, metadata) ON attachments TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (title, is_archived, is_pinned, lifecycle, updated_at) ON threads TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (payload, updated_at) ON artifacts TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (status, state, error, started_at, ended_at) ON runs TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (interaction_mode) ON threads TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT ON adapt_workspaces, adapt_executions TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (status, controller, checkpoint, updated_at) ON adapt_workspaces TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (controller) ON adapt_executions TO "${instance.runtimeRole}"`);
    });
  } finally { await db.end(); }
}
