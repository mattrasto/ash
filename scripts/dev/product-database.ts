import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Instance } from '../../packages/shared/src/index.ts';
import { BASE_INSTRUCTION_ID, BASE_INSTRUCTIONS, IMAGE_INSTRUCTION_ID, IMAGE_INSTRUCTIONS } from '../../packages/server/src/modules/instructions/defaults.ts';
import { connect, databaseUrl, type Cluster } from './database.ts';
import { exec, childEnvironment } from './io.ts';

// Called only after the development provisioner has checked this database's owner.
export async function migrateProduct(instance: Instance, cluster: Cluster) {
  const require = createRequire(join(instance.checkout, 'packages/server/package.json'));
  const url = new URL(databaseUrl(cluster, instance.database));
  url.searchParams.set('options', `-c role=${instance.ownerRole}`);
  const inspection = connect(cluster,instance.database);
  let baseline = false;
  try {
    const [marker] = await inspection`SELECT instance_id, generation FROM dev_meta`;
    if (marker.instance_id !== instance.id || marker.generation !== instance.generation) throw new Error('Database identity mismatch before migration');
    const [table] = await inspection`SELECT to_regclass('public._prisma_migrations') AS name`;
    baseline = !table.name || !(await inspection`SELECT migration_name FROM _prisma_migrations LIMIT 1`).length;
  } finally { await inspection.end(); }
  const environment = {...childEnvironment(join(instance.root,'tmp')), ASH_MIGRATION_DATABASE_URL:url.toString()};
  try {
    if (baseline) await exec(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'resolve', '--applied', '202610090000_dev_bootstrap', '--schema', 'prisma/schema.prisma'], {cwd:join(instance.checkout,'packages/server'),timeout:60_000,env:environment});
    await exec(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd:join(instance.checkout,'packages/server'), timeout:60_000,
      env:environment,
    });
  } catch (error) {
    const diagnostic = (error as {stderr?:string}).stderr ?? '';
    throw new Error(`Product migration failed; existing data was not reset. ${diagnostic.replaceAll(url.toString(),'[database]').replaceAll(cluster.password,'[redacted]')}`);
  }
  const db = connect(cluster,instance.database);
  try {
    await db.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE "${instance.ownerRole}"`);
      await tx.unsafe("INSERT INTO instructions (id,key,name,text,created_at,updated_at) VALUES ($1,'response','Base response instructions',$2,now(),now()) ON CONFLICT (key) DO NOTHING", [BASE_INSTRUCTION_ID,BASE_INSTRUCTIONS]);
      await tx.unsafe("INSERT INTO instructions (id,key,name,text,created_at,updated_at) VALUES ($1,'image-description','Image description instructions',$2,now(),now()) ON CONFLICT (key) DO NOTHING", [IMAGE_INSTRUCTION_ID,IMAGE_INSTRUCTIONS]);
      await tx.unsafe(`GRANT SELECT ON topics, threads, thread_topics, artifacts, instructions, runs, attachments, artifact_attachments TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT INSERT ON threads, artifacts, runs TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT SELECT, INSERT ON incoming_items TO "${instance.runtimeRole}"`);
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
      await tx.unsafe(`GRANT UPDATE (summary_run_id, summary, expires_at) ON attachments TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (title, is_archived, updated_at) ON threads TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (payload, updated_at) ON artifacts TO "${instance.runtimeRole}"`);
      await tx.unsafe(`GRANT UPDATE (status, state, error, started_at, ended_at) ON runs TO "${instance.runtimeRole}"`);
    });
  } finally { await db.end(); }
}
