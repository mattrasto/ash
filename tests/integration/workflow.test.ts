import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import postgres from 'postgres';
import type { ElectronApplication } from 'playwright';
import { devRoot, exec, atomic, json, exists, id, alive, sleep } from '../../scripts/dev/io.ts';
import { workspace, createInstance, instancePath, type Workspace } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, resetInstance, disposeInstance, recoverRecordedInstance, runtime } from '../../scripts/dev/lifecycle.ts';
import { desktop, request } from '../support/desktop.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { ServerConfig, type Instance, type PreviewInfo } from '../../packages/shared/src/index.ts';
import { connect, ensureCluster, type Cluster } from '../../scripts/dev/database.ts';
import { makeWorktree } from '../helpers/worktree.ts';

const source = process.cwd();
async function state(instance: Instance) { const response = await request(instance, '/api/state'); assert.equal(response.status, 200); return response.json() as Promise<{note: string; count: number; fileNote: string}>; }
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
    await scenarioStep(t, 'workflow-setup', async () => {
      await makeWorktree(source,aPath); await makeWorktree(source,bPath);
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
    await scenarioStep(t, 'workflow-isolation', async () => {
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
    await scenarioStep(t, 'workflow-restart', async () => {
      const before = await runtime(a); const repeated = await startInstance(wa, a.id, { headless: true });
      assert.equal(repeated.supervisor.pid, before!.supervisor.pid);
      await stopInstance(wa, a.id); await startInstance(wa, a.id, { headless: true });
      assert.equal((await runtime(a))!.webUrl,before!.webUrl);
      assert.equal((await state(a)).note, 'Feature A');
    });
    await scenarioStep(t, 'workflow-port', async () => {
      const url=(await runtime(a))!.webUrl!;
      await stopInstance(wa,a.id);
      const blocker=createServer((_req,res)=>res.end('unrelated listener'));
      await new Promise<void>((resolve,reject)=>{blocker.once('error',reject);blocker.listen(Number(new URL(url).port),'127.0.0.1',resolve);});
      try {
        await assert.rejects(startInstance(wa,a.id,{headless:true}),/Preview port .* is in use/);
        assert.equal(await (await fetch(url)).text(),'unrelated listener');
      } finally { await new Promise<void>((resolve,reject)=>blocker.close(error=>error?reject(error):resolve())); }
      await startInstance(wa,a.id,{headless:true});
      assert.equal((await runtime(a))!.webUrl,url);
    });
    await scenarioStep(t, 'workflow-desktop', async () => {
      const da = await desktop(a); apps.push(da.app);
      const db = await desktop(b); apps.push(db.app);
      await da.page.getByLabel('Message',{exact:true}).fill('Saved from the desktop');
      await da.page.getByRole('button',{name:'Send message',exact:true}).click();
      await da.page.getByTestId('run-status').filter({hasText:'completed'}).waitFor();
      assert.equal(await db.page.getByTestId('message').count(),0);
      await da.page.getByLabel('Message',{exact:true}).fill('An unsent draft');
      await da.page.getByRole('button',{name:'Hide sidebar',exact:true}).click();
      assert.equal(await db.page.getByRole('button',{name:'Hide sidebar',exact:true}).count(),1);
      const renderer = join(a.checkout, 'packages/client/src/renderer/features/threads/Chat.svelte');
      const original = await readFile(renderer, 'utf8');
      const changedPlaceholder = 'Workflow hot reload check';
      try {
        await writeFile(renderer, original.replace('placeholder="Message Ash…"', `placeholder="${changedPlaceholder}"`));
        await da.page.getByPlaceholder(changedPlaceholder,{exact:true}).waitFor();
        assert.equal(await da.page.getByLabel('Message',{exact:true}).inputValue(),'An unsent draft');
        assert.equal(await db.page.getByPlaceholder('Message Ash…',{exact:true}).count(),1);
      } finally { await writeFile(renderer, original); }
      await da.page.getByPlaceholder('Message Ash…',{exact:true}).waitFor();
      await da.page.screenshot({ path: join(evidence, 'feature-a.png') });
      await db.page.screenshot({ path: join(evidence, 'feature-b.png') });
      await da.app.close(); apps.splice(apps.indexOf(da.app), 1);
      await stopInstance(wa, a.id); await startInstance(wa, a.id, {headless:true});
      const reopened = await desktop(a); apps.push(reopened.app);
      await reopened.page.getByRole('button',{name:'Show sidebar',exact:true}).waitFor();
      assert.equal(await reopened.page.getByLabel('Message',{exact:true}).inputValue(),'An unsent draft');
      assert.equal(await reopened.page.getByTestId('message').count(),2);
      await reopened.app.close(); apps.splice(apps.indexOf(reopened.app), 1);
    });
    await scenarioStep(t, 'workflow-reset', async () => {
      const old = ServerConfig.parse(await json(join(a.root, 'server.json')));
      a = await resetInstance(wa, a.id, 'empty'); await startInstance(wa, a.id, { headless: true });
      assert.deepEqual(await state(a), { note: '', count: 0, fileNote: '' });
      assert.equal((await request(a, '/api/state', undefined, old.token)).status, 401);
      assert.equal((await state(b)).note, 'Feature B'); assert.equal((await state(verify)).note, 'Verification');
      const fresh = await desktop(a); apps.push(fresh.app);
      await fresh.page.getByRole('button',{name:'Hide sidebar',exact:true}).waitFor();
      assert.equal(await fresh.page.getByLabel('Message',{exact:true}).inputValue(),'');
      assert.equal(await fresh.page.getByTestId('message').count(),0);
      await fresh.page.screenshot({path: join(evidence, 'reset-empty.png')});
      await fresh.app.close(); apps.splice(apps.indexOf(fresh.app), 1);
      const original = await json(join(a.root, 'instance.json'));
      await atomic(join(a.root, 'instance.json'), {...a, root: base});
      await assert.rejects(resetInstance(wa, a.id), /ownership mismatch/);
      await atomic(join(a.root, 'instance.json'), original);
    });
    await scenarioStep(t, 'workflow-crash', async () => {
      const before = (await runtime(a))!;
      process.kill(before.supervisor.pid, 'SIGKILL');
      for (let i=0; i<30 && await alive(before.supervisor); i++) await sleep(100);
      await startInstance(wa, a.id, {headless:true});
      assert.equal((await state(a)).count, 0); assert.equal((await state(b)).note, 'Feature B');
      assert.equal(await (await fetch(`http://127.0.0.1:${foreignPort}`)).text(), 'foreign');
    });
    await scenarioStep(t, 'workflow-identity', async () => {
      const path = join(bPath, '.ash-dev/workspace.json'); const original = await json(path);
      await atomic(path, wa); await assert.rejects(workspace(bPath, root), /Copied/); await atomic(path, original);
      const info = async () => (await (await request(b, '/api/info')).json()) as PreviewInfo;
      const detached = await info();
      assert.equal(detached.source!.branch, null); assert.ok(detached.source!.revision);
      assert.equal(detached.checkout, bPath);
      const branch = `codex/identity-${b.id}`;
      let currentBranch = branch;
      const waitForBranch = async (expected: string | null) => {
        let current = await info();
        for (let i = 0; i < 30 && current.source?.branch !== expected; i++) { await sleep(250); current = await info(); }
        assert.equal(current.source!.branch, expected);
        assert.equal(current.workspaceId, detached.workspaceId); assert.equal(current.instanceId, detached.instanceId);
      };
      await exec('git', ['switch', '-c', branch], { cwd: bPath });
      try {
        await waitForBranch(branch);
        await exec('git', ['branch', '-m', `${branch}-renamed`], { cwd: bPath }); currentBranch = `${branch}-renamed`;
        await waitForBranch(currentBranch);
        assert.deepEqual(await json(path), original);
      } finally {
        await exec('git', ['switch', '--detach'], { cwd: bPath });
        await exec('git', ['branch', '-D', currentBranch], { cwd: bPath });
      }
      await waitForBranch(null);
    });
    await scenarioStep(t, 'workflow-native', async () => {
      await stopInstance(wa, a.id);
      const started = await startInstance(wa, a.id, {windowed:true, background:true});
      assert.equal(started.children.length, 2);
      assert.ok(await alive(started.children[1]));
      await stopInstance(wa, a.id);
      for (const child of started.children) assert.equal(await alive(child), false);
      await startInstance(wa, a.id, {headless:true});
      assert.equal((await state(b)).note, 'Feature B');
    });
    await scenarioStep(t, 'workflow-disposal', async () => {
      const disposable = await createInstance(wa, 'verify'); instances.push({ws:wa,id:disposable.id});
      const cluster = await json<Cluster>(join(root, 'cluster.json'));
      const db = connect(cluster);
      try { await db.unsafe(`DROP DATABASE "${disposable.database}"`); } finally { await db.end(); }
      await disposeInstance(wa, disposable.id); instances.splice(instances.findIndex(i => i.id === disposable.id), 1);
      const check = connect(cluster);
      try { assert.equal((await check`SELECT 1 FROM pg_roles WHERE rolname IN (${disposable.ownerRole}, ${disposable.runtimeRole})`).length, 0); }
      finally { await check.end(); }
      const racing = await createInstance(wa, 'verify'); instances.push({ws:wa,id:racing.id});
      const disposing = disposeInstance(wa,racing.id);
      const lock = join(root,'locks',`instance-${racing.id}`,'owner.json');
      for(let n=0;n<100&&!await exists(lock);n++)await sleep(5);
      await Promise.all([disposing,recoverRecordedInstance(racing)]);
      assert.equal(await exists(racing.root),false,'Verifier recovery cooperates with fixture disposal');
    });
    await scenarioStep(t, 'workflow-config', async () => {
      await Promise.all([stopInstance(wa, a.id), stopInstance(wb, b.id), stopInstance(wa, verify.id)]);
      const path = join(aPath, 'compose.yaml');
      const original = await readFile(path, 'utf8');
      const before = await ensureCluster(root, aPath);
      const reused = await ensureCluster(root, aPath);
      assert.equal(reused.containerId, before.containerId);
      try {
        await writeFile(path, original.replace('      dev.ash.cluster:', '      dev.ash.configuration-test: changed\n      dev.ash.cluster:'));
        const updated = await ensureCluster(root, aPath);
        const name = `ash-dev-${updated.id}`;
        const actual = (await exec('docker', ['container', 'inspect', '--format', '{{index .Config.Labels "dev.ash.configuration-test"}}', name])).stdout.trim();
        assert.equal(actual, 'changed');
        assert.notEqual(updated.composeHash, before.composeHash);
      } finally {
        await writeFile(path, original);
        await ensureCluster(root, aPath);
      }
    });
    await scenarioStep(t, 'workflow-recreate', async () => {
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
    await scenarioStep(t, 'workflow-cleanup', async () => {
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
