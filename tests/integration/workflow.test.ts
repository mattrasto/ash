import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import postgres from 'postgres';
import { _electron, type ElectronApplication } from 'playwright';
import { devRoot, exec, atomic, json, exists, childEnvironment, id, alive, sleep } from '../../scripts/dev/io.ts';
import { workspace, createInstance, instancePath, type Workspace } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, resetInstance, disposeInstance, runtime } from '../../scripts/dev/lifecycle.ts';
import { buildMain } from '../../scripts/dev/build.ts';
import { ServerConfig, type Instance } from '../../packages/shared/src/index.ts';
import { connect, type Cluster } from '../../scripts/dev/database.ts';

const source = process.cwd();
const require = createRequire(join(source, 'package.json'));
async function request(instance: Instance, path: string, body?: object, tokenOverride?: string) {
  const current = await runtime(instance);
  const cfg = ServerConfig.parse(await json(join(instance.root, 'server.json')));
  return fetch(`${current!.serverUrl}${path}`, {
    method: body ? 'PATCH' : 'GET', headers: { authorization: `Bearer ${tokenOverride ?? cfg.token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
  });
}
async function state(instance: Instance) { const response = await request(instance, '/api/state'); assert.equal(response.status, 200); return response.json() as Promise<{note: string; count: number; fileNote: string}>; }
async function makeWorktree(path: string) {
  await exec('git', ['worktree', 'add', '--detach', path, 'HEAD'], { cwd: source });
  const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: source });
  for (const file of new Set(stdout.split('\0').filter(p => /^(packages\/|scripts\/|tests\/|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.json$|compose.yaml$|\.npmrc$|\.gitignore$)/.test(p)))) {
    await mkdir(dirname(join(path, file)), { recursive: true }); await copyFile(join(source, file), join(path, file));
  }
  await exec('pnpm', ['install', '--offline', '--frozen-lockfile', '--prod=false'], { cwd: path, timeout: 120_000 });
}
async function desktop(instance: Instance) {
  const running = await runtime(instance);
  const entry = await buildMain(instance.checkout, join(instance.root, 'build'));
  const configPath = join(instance.root, 'test-client.json');
  await atomic(configPath, { root: instance.root, label: instance.label, instanceId: instance.id, url: running!.webUrl, windowed: true, background: true });
  const app = await _electron.launch({ executablePath: require('electron'), args: [entry], cwd: instance.checkout,
    env: { ...childEnvironment(join(instance.root, 'tmp')), ASH_CLIENT_CONFIG: configPath } as Record<string, string>, timeout: 30_000 });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try { await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({timeout:15000}); }
    catch (e) { throw new Error(`${(e as Error).message}\nRenderer errors: ${errors.join('\n')}\n${(await page.locator('body').innerText()).slice(0,2000)}`); }
    return { app, page };
  } catch (e) { await app.close(); throw e; }
}

test('parallel worktrees, desktop state, reset, credentials and lifecycle', { timeout: 240_000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'ash-workflow-'));
  const root = await devRoot(join(base, 'state'));
  const evidence = process.env.ASH_TEST_EVIDENCE ?? join(await devRoot(), 'evidence', id());
  await mkdir(evidence, { recursive: true });
  const aPath = join(base, 'feature-a'), bPath = join(base, 'feature-b');
  const instances: Array<{ws: Workspace; id: string}> = [];
  const apps: ElectronApplication[] = [];
  const foreign = createServer((_req, res) => res.end('foreign'));
  await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const foreignPort = (foreign.address() as {port: number}).port;
  let a!: Instance, b!: Instance, verify!: Instance, wa!: Workspace, wb!: Workspace;
  try {
    let setupComplete = false;
    await t.test('DEV-01 concurrent setup in real detached Git worktrees', async () => {
      await makeWorktree(aPath); await makeWorktree(bPath);
      [wa, wb] = await Promise.all([workspace(aPath, root), workspace(bPath, root)]);
      // Record intended ownership before provisioning so cleanup still runs on partial failure.
      instances.push({ws: wa, id: wa.previewId}, {ws: wb, id: wb.previewId});
      [a, b] = await Promise.all([createInstance(wa), createInstance(wb)]);
      assert.notEqual(a.id, b.id); assert.equal(a.clusterId, b.clusterId);
      verify = await createInstance(wa, 'verify'); instances.push({ws: wa, id: verify.id});
      const states = await Promise.all([a, b, verify].map(instance => startInstance(instance === b ? wb : wa, instance.id, { headless: true })));
      assert.equal(new Set(states.map(s => s.serverUrl)).size, 3);
      assert.equal(new Set(states.map(s => s.webUrl)).size, 3);
      assert.ok(states.every(s => !s.serverUrl!.endsWith(`:${foreignPort}`)));
      setupComplete = true;
    });
    assert.ok(setupComplete, 'Setup must succeed before testing dependent behavior');
    await t.test('DEV-02 and DEV-05 database and file writes do not cross instances', async () => {
      await Promise.all([request(a, '/api/state', { note: 'Feature A', fileNote: 'File A', increment: true }), request(b, '/api/state', { note: 'Feature B', fileNote: 'File B', increment: true }), request(verify, '/api/state', { note: 'Verification', increment: true })]);
      assert.deepEqual(await state(a), { note: 'Feature A', count: 1, fileNote: 'File A' });
      assert.equal((await state(b)).note, 'Feature B'); assert.equal((await state(verify)).note, 'Verification');
      assert.equal(await readFile(join(a.root, 'files/note.txt'), 'utf8'), 'File A');
      const cfg = ServerConfig.parse(await json(join(a.root, 'server.json')));
      const url = new URL(cfg.databaseUrl); url.pathname = `/${b.database}`;
      const denied = postgres(url.toString(), { max: 1, connect_timeout: 3 });
      try { await assert.rejects(denied`SELECT 1`, /permission denied for database/); } finally { await denied.end(); }
      const running = (await runtime(a))!;
      assert.equal((await fetch(`${running.serverUrl}/api/state`)).status, 401);
      assert.equal((await fetch(`${running.webUrl}/@fs${join(a.root, 'server.json')}`)).status, 403);
    });
    await t.test('DEV-04 duplicate launch reuses the supervisor and restart keeps data', async () => {
      const before = await runtime(a); const repeated = await startInstance(wa, a.id, { headless: true });
      assert.equal(repeated.supervisor.pid, before!.supervisor.pid);
      await stopInstance(wa, a.id); await startInstance(wa, a.id, { headless: true });
      assert.equal((await state(a)).note, 'Feature A');
    });
    await t.test('desktop UI edits and client state remain isolated', async () => {
      const da = await desktop(a); apps.push(da.app);
      const db = await desktop(b); apps.push(db.app);
      await da.page.getByLabel('A note for this preview').fill('Saved from the desktop');
      await da.page.getByRole('button', { name: 'Save note', exact: true }).click();
      await da.page.getByText('Saved in this preview', {exact:true}).waitFor();
      assert.equal((await state(a)).note, 'Saved from the desktop');
      assert.equal(await db.page.getByLabel('A note for this preview').inputValue(), 'Feature B');
      await da.page.getByText('File and client storage checks').click();
      await da.page.getByLabel('Compact scratchpad', {exact:false}).check();
      assert.equal(await db.page.evaluate(() => window.ashPreferences.getCompact()), false);
      const renderer = join(a.checkout, 'packages/client/src/renderer/App.svelte');
      const original = await readFile(renderer, 'utf8');
      try {
        await writeFile(renderer, original.replace('Room to build.', 'Hot reload works.'));
        await da.page.getByRole('heading', {name:'Hot reload works.'}).waitFor();
        assert.equal(await da.page.getByLabel('A note for this preview').inputValue(), 'Saved from the desktop');
        assert.equal(await db.page.getByRole('heading', {name:'Room to build.'}).count(), 1);
      } finally { await writeFile(renderer, original); }
      await da.page.getByRole('heading', {name:'Room to build.'}).waitFor();
      await da.page.screenshot({ path: join(evidence, 'feature-a.png') });
      await db.page.screenshot({ path: join(evidence, 'feature-b.png') });
      await da.app.close(); apps.splice(apps.indexOf(da.app), 1);
      await stopInstance(wa, a.id); await startInstance(wa, a.id, {headless:true});
      const reopened = await desktop(a); apps.push(reopened.app);
      assert.equal(await reopened.page.evaluate(() => window.ashPreferences.getCompact()), true);
      await reopened.app.close(); apps.splice(apps.indexOf(reopened.app), 1);
    });
    await t.test('DEV-07 reset replaces database, files and client state and rotates authentication', async () => {
      const old = ServerConfig.parse(await json(join(a.root, 'server.json')));
      a = await resetInstance(wa, a.id, 'empty'); await startInstance(wa, a.id, { headless: true });
      assert.deepEqual(await state(a), { note: '', count: 0, fileNote: '' });
      assert.equal((await request(a, '/api/state', undefined, old.token)).status, 401);
      assert.equal((await state(b)).note, 'Feature B'); assert.equal((await state(verify)).note, 'Verification');
      const fresh = await desktop(a); apps.push(fresh.app);
      assert.equal(await fresh.page.evaluate(() => window.ashPreferences.getCompact()), false);
      await fresh.page.screenshot({path: join(evidence, 'reset-empty.png')});
      await fresh.app.close(); apps.splice(apps.indexOf(fresh.app), 1);
      const original = await json(join(a.root, 'instance.json'));
      await atomic(join(a.root, 'instance.json'), {...a, root: base});
      await assert.rejects(resetInstance(wa, a.id), /ownership mismatch/);
      await atomic(join(a.root, 'instance.json'), original);
    });
    await t.test('DEV-03 and DEV-06 crash recovery leaves unrelated listeners and sibling previews alive', async () => {
      const before = (await runtime(a))!;
      process.kill(before.supervisor.pid, 'SIGKILL');
      for (let i=0; i<30 && await alive(before.supervisor); i++) await sleep(100);
      await startInstance(wa, a.id, {headless:true});
      assert.equal((await state(a)).count, 0); assert.equal((await state(b)).note, 'Feature B');
      assert.equal(await (await fetch(`http://127.0.0.1:${foreignPort}`)).text(), 'foreign');
    });
    await t.test('DEV-09 copied identity is rejected', async () => {
      const path = join(bPath, '.ash-dev/workspace.json'); const original = await json(path);
      await atomic(path, wa); await assert.rejects(workspace(bPath, root), /Copied/); await atomic(path, original);
    });
    await t.test('native launcher waits for the desktop and Stop closes its owned processes', async () => {
      await stopInstance(wa, a.id);
      const started = await startInstance(wa, a.id, {windowed:true, background:true});
      assert.equal(started.children.length, 2);
      assert.ok(await alive(started.children[1]));
      await stopInstance(wa, a.id);
      for (const child of started.children) assert.equal(await alive(child), false);
      await startInstance(wa, a.id, {headless:true});
      assert.equal((await state(b)).note, 'Feature B');
    });
    await t.test('disposal retries clean up owned roles after an interrupted database drop', async () => {
      const disposable = await createInstance(wa, 'verify'); instances.push({ws:wa,id:disposable.id});
      const cluster = await json<Cluster>(join(root, 'cluster.json'));
      const db = connect(cluster);
      try { await db.unsafe(`DROP DATABASE "${disposable.database}"`); } finally { await db.end(); }
      await disposeInstance(wa, disposable.id); instances.splice(instances.findIndex(i => i.id === disposable.id), 1);
      const check = connect(cluster);
      try { assert.equal((await check`SELECT 1 FROM pg_roles WHERE rolname IN (${disposable.ownerRole}, ${disposable.runtimeRole})`).length, 0); }
      finally { await check.end(); }
    });
    await t.test('recreating development infrastructure reconnects existing previews without reseeding', async () => {
      const cluster = await json<Cluster>(join(root, 'cluster.json'));
      const name = `ash-dev-${cluster.id}`;
      assert.equal((await exec('docker', ['container', 'inspect', '--format', '{{index .Config.Labels "dev.ash.cluster"}}', name])).stdout.trim(), cluster.id);
      await exec('docker', ['rm', '-f', name]);
      assert.equal((await createInstance(wa)).id, a.id);
      await Promise.all([startInstance(wa, a.id, {headless:true}), startInstance(wb, b.id, {headless:true}), startInstance(wa, verify.id, {headless:true})]);
      assert.equal((await state(a)).note, '');
      assert.equal((await state(b)).note, 'Feature B');
      assert.equal((await state(verify)).note, 'Verification');
    });
    await t.test('verification disposal leaves the human preview data intact', async () => {
      await disposeInstance(wa, verify.id); instances.splice(instances.findIndex(i => i.id === verify.id), 1);
      assert.equal(await exists(verify.root), false); assert.equal((await state(b)).note, 'Feature B');
    });
  } finally {
    for (const app of apps) await app.close().catch(() => {});
    const cleanupErrors: string[] = [];
    for (const owned of instances) {
      try {
        if (await exists(join(instancePath(owned.ws, owned.id), 'instance.json'))) {
          await stopInstance(owned.ws, owned.id);
          await disposeInstance(owned.ws, owned.id);
        }
      } catch (e) { cleanupErrors.push((e as Error).message); }
    }
    foreign.close();
    const clusterPath = join(root, 'cluster.json');
    if (await exists(clusterPath)) {
      const cluster = await json<Cluster>(clusterPath);
      const name = `ash-dev-${cluster.id}`;
      let containerExists = false;
      try {
        const label = (await exec('docker', ['container', 'inspect', '--format', '{{index .Config.Labels "dev.ash.cluster"}}', name])).stdout.trim();
        assert.equal(label, cluster.id); containerExists = true;
      } catch (e) { if (!/No such (object|container)/i.test((e as {stderr?:string}).stderr ?? '')) cleanupErrors.push((e as Error).message); }
      if (containerExists) {
        const db = connect(cluster);
        try {
          const rows = await db`SELECT datname FROM pg_database WHERE datname LIKE 'ash_d_%'`;
          if (rows.length) cleanupErrors.push(`${rows.length} databases remain after disposal`);
          const roles = await db`SELECT 1 FROM pg_roles WHERE rolname LIKE 'ash_r_%' OR rolname LIKE 'ash_o_%'`;
          if (roles.length) cleanupErrors.push(`${roles.length} instance roles remain after disposal`);
        } catch (e) { cleanupErrors.push((e as Error).message); }
        finally { await db.end(); }
        await exec('docker', ['rm', '-f', name]);
      }
      try {
        const label = (await exec('docker', ['volume', 'inspect', '--format', '{{index .Labels "dev.ash.cluster"}}', name])).stdout.trim();
        assert.equal(label, cluster.id); await exec('docker', ['volume', 'rm', name]);
      } catch (e) { if (!(e as {stderr?:string}).stderr?.includes('no such volume')) cleanupErrors.push((e as Error).message); }
    }
    for (const path of [aPath,bPath]) await exec('git', ['worktree', 'remove', '--force', path], {cwd:source}).catch(e => cleanupErrors.push(e.message));
    await atomic(join(evidence,'workflow.json'), { evidence, cleanupErrors, completedAt: new Date().toISOString() });
    if (!cleanupErrors.length) await rm(base, {recursive:true,force:true});
    assert.deepEqual(cleanupErrors, [], 'All owned test resources must be disposed');
    console.log(`Workflow evidence: ${evidence}`);
  }
});
