import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { connect, databaseUrl, ensureCluster } from '../../scripts/dev/database.ts';
import { initializeProduct, migrateProduct } from '../../scripts/dev/product-database.ts';
import { createInstance, type Workspace } from '../../scripts/dev/workspace.ts';
import { disposeInstance, resetInstance } from '../../scripts/dev/lifecycle.ts';
import { childEnvironment, exec, id } from '../../scripts/dev/io.ts';
import type { Instance } from '../../packages/shared/src/index.ts';

// Only call in a disposable source checkout: the real migration CLI reads these files.
export async function checkMigrationReuse(ws: Workspace, preview: Instance) {
  const cluster = await ensureCluster(ws.devRoot, ws.checkout);
  let instance = await createInstance(ws, 'test', 'empty');
  const db = connect(cluster, instance.database);
  const root = join(ws.checkout, 'packages/server/prisma');
  const schemaPath = join(root, 'schema.prisma'), schema = await readFile(schemaPath, 'utf8');
  const priorPath = join(root, 'migrations/202610090000_dev_bootstrap/migration.sql'), prior = await readFile(priorPath, 'utf8');
  const pending = join(root, 'migrations/209901010001_verification_probe');
  const broken = join(root, 'migrations/209901010002_verification_failure');
  const reuse = () => migrateProduct(instance, cluster, { reuseCurrent: true });
  try {
    const [bootstrap] = await db`SELECT applied_steps_count FROM _prisma_migrations WHERE migration_name='202610090000_dev_bootstrap'`;
    assert.equal(bootstrap.applied_steps_count, 1, 'Fresh databases execute the real bootstrap migration');
    await assert.rejects(initializeProduct(instance, cluster), /empty public schema/, 'Fresh initialization cannot overwrite existing state');
    await assert.rejects(initializeProduct({...instance, ownerRole: preview.ownerRole}, cluster), /Database ownership mismatch/);
    assert.equal(await migrateProduct(preview, cluster, { reuseCurrent: true }), 'deployed', 'Previews always use the migration CLI');
    assert.equal(await migrateProduct(instance, cluster), 'deployed', 'Explicit migration checks still deploy');
    await db`UPDATE dev_scratch SET note='Migration survivor', count=7`;
    await db`UPDATE instructions SET text='Customized response guidance' WHERE key='response'`;
    await db.unsafe(`REVOKE SELECT ON threads FROM "${instance.runtimeRole}"`);
    assert.equal(await reuse(), 'current');
    assert.equal((await db`SELECT has_table_privilege(${instance.runtimeRole}, 'threads', 'SELECT') AS allowed`)[0].allowed, true, 'Runtime grants are reapplied');
    assert.equal((await db`SELECT text FROM instructions WHERE key='response'`)[0].text, 'Customized response guidance');
    assert.deepEqual((await db`SELECT note,count FROM dev_scratch`)[0], { note: 'Migration survivor', count: 7 });
    assert.equal(await reuse(), 'current', 'Repeated reuse still checks current database history');
    const [latest] = await db`SELECT id,finished_at FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`;
    await db`UPDATE _prisma_migrations SET finished_at=NULL WHERE id=${latest.id}`;
    try { await assert.rejects(reuse(), /failed migrations|P3009/, 'Unchanged source still rechecks unfinished database history'); }
    finally { await db`UPDATE _prisma_migrations SET finished_at=${latest.finished_at} WHERE id=${latest.id}`; }

    await writeFile(schemaPath, schema + '\nmodel InvalidMigrationProbe {\n');
    await assert.rejects(reuse(), /Product migration failed/, 'Changed schema input cannot bypass CLI validation');
    await writeFile(schemaPath, schema);
    await writeFile(priorPath, prior + '\n-- Changed migration checksum probe\n');
    assert.equal(await reuse(), 'deployed', 'Changed SQL cannot reuse a prior deployment');
    assert.equal(await reuse(), 'deployed', 'A successful CLI invocation cannot hide a checksum mismatch');
    await writeFile(priorPath, prior);

    await mkdir(pending);
    await writeFile(join(pending, 'migration.sql'), 'CREATE TABLE verification_migration_probe (id integer PRIMARY KEY);\n');
    assert.equal(await reuse(), 'deployed', 'Pending migrations execute');
    assert.equal((await db`SELECT to_regclass('public.verification_migration_probe') AS name`)[0].name, 'verification_migration_probe');
    assert.equal(await reuse(), 'current');
    await db`UPDATE dev_meta SET generation='wrong-generation'`;
    await assert.rejects(reuse(), /Database identity mismatch/);
    await db`UPDATE dev_meta SET generation=${instance.generation}`;

    await mkdir(broken);
    await writeFile(join(broken, 'migration.sql'), 'SELECT * FROM nonexistent_verification_relation;\n');
    const failedId = id();
    try { await assert.rejects(createInstance(ws, 'test', 'empty', failedId), /Product migration failed/, 'Fresh migration failures cannot finish provisioning'); }
    finally { await disposeInstance(ws, failedId); }
    await assert.rejects(reuse(), /Product migration failed/);
    await writeFile(join(broken, 'migration.sql'), 'SELECT 1;\n');
    await assert.rejects(reuse(), /failed migrations|P3009/, 'A corrected file cannot conceal an unresolved failed migration');
    const url = new URL(databaseUrl(cluster, instance.database));
    url.searchParams.set('options', `-c role=${instance.ownerRole}`);
    const require = createRequire(join(ws.checkout, 'packages/server/package.json'));
    await exec(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'resolve', '--rolled-back', '209901010002_verification_failure', '--schema', 'prisma/schema.prisma'], {
      cwd: join(ws.checkout, 'packages/server'), timeout: 60_000,
      env: { ...childEnvironment(join(instance.root, 'tmp')), ASH_MIGRATION_DATABASE_URL: url.toString() },
    });
    assert.equal(await reuse(), 'deployed');
    assert.equal(await reuse(), 'deployed', 'Rolled-back history conservatively stays on the CLI path');
    await rm(pending, { recursive: true });
    assert.equal(await reuse(), 'deployed', 'Missing local migration history cannot reuse a deployment');
    await rm(broken, { recursive: true });
    await db.end();
    instance = await resetInstance(ws, instance.id, 'empty');
    assert.equal(await reuse(), 'current', 'Reset establishes a new receipt after fresh provisioning');
  } finally {
    await writeFile(schemaPath, schema);
    await writeFile(priorPath, prior);
    await rm(pending, { recursive: true, force: true });
    await rm(broken, { recursive: true, force: true });
    await db.end();
    await disposeInstance(ws, instance.id);
  }
}
