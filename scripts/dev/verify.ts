import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { release, loadavg, freemem, totalmem, availableParallelism, homedir } from 'node:os';
import { assertEnvironment, atomic, childEnvironment, devRoot, fingerprint, id, exec, exists, json, stopProcess, type ProcessRef } from './io.ts';
import { manualChecks, scenarios, selectScenarios } from '../../tests/scenarios.ts';
import { redact, type ScenarioResult } from '../../tests/support/results.ts';
import type { TestEvent } from './telemetry.ts';
import { SCHEMA_VERSION, FIXTURE_VERSION, Instance } from '../../packages/shared/src/index.ts';
import { executionPlan, graphPreview, runGraph, timingCosts, validateWorkerCount, type GraphNode, type GraphState } from './graph.ts';
import { graphReport } from './graph-report.ts';

interface CleanupRecord { kind: string; id: string; status: string; error?: string; instanceId?: string }

async function main() {
  const started = Date.now();
  const loadAtStart = { average: loadavg(), freeMemoryBytes: freemem() };
  const { values } = parseArgs({ options: {
    profile: { type: 'string', default: 'full' }, scenario: { type: 'string' }, group: { type: 'string' },
    workers: { type: 'string', default: '6' }, timing: { type: 'string', default: 'accelerated' }, list: { type: 'boolean' },
    affected: { type: 'string' }, reference: { type: 'string' }, iterate: { type: 'boolean' },
  } });
  const workers = validateWorkerCount(Number(values.workers));
  if (!['normal', 'accelerated'].includes(values.timing!)) throw new Error('timing must be normal or accelerated');
  let selected = selectScenarios(values.profile!, values.scenario, values.group);
  const explicit = !!(values.scenario || values.group) || values.profile !== 'full';
  if (values.affected !== undefined && (explicit || !values.affected)) throw new Error('--affected requires a base revision and full verification without scenario/group filters');
  if (values.iterate && !values.affected) throw new Error('--iterate requires --affected');
  const checkout = process.cwd();
  // Freeze before calculating impact so a concurrent source edit cannot leave a stale selection valid.
  const before = values.list ? undefined : await fingerprint(checkout);
  const prediction = values.affected ? await (await import('./selection.ts')).affectedPlan(checkout, values.affected) : undefined;
  const selection = prediction ? {...prediction,mode:values.iterate ? 'iteration' : 'shadow'} : undefined;
  if (values.iterate) selected = scenarios.filter(s => selection!.iterationScenarios.includes(s.id));
  if (values.iterate && selection!.decision !== 'ready' && !values.list) {
    console.log(JSON.stringify({ decision: selection!.decision, passed: null, scope: 'partial', scenarios: [], reasons: [...selection!.fallback, ...selection!.warnings], selection }, null, 2));
    if (selection!.decision === 'deferred') process.exitCode = 2;
    return;
  }
  const suites = new Set(selected.map(s => s.suite));
  const groups = [...new Set(selected.map(s => s.group))];
  const partial = explicit || !!values.iterate;
  const root = values.list ? resolve(process.env.ASH_DEV_ROOT ?? join(homedir(), '.ash-dev')) : await devRoot();
  let plan = executionPlan(selected, workers, values.timing!);
  let timingReference: string | undefined = values.reference;
  if (!timingReference) timingReference = (await json<{path:string}>(join(root, 'verification-reference.json')).catch(() => undefined))?.path;
  let timingWarning: string | undefined;
  let timingContext: { samples: number; variability: string; source: unknown; workers: number; measuredAt: string } | undefined;
  if (timingReference) {
    try {
      const reference = await json<any>(timingReference);
      plan = executionPlan(selected, workers, values.timing!, timingCosts(reference, plan));
      timingContext = {samples:1,variability:'Not estimated from one report',source:reference.source,workers:reference.workers,measuredAt:reference.completedAt};
    }
    catch (error) { if (values.reference) throw error;timingWarning = redact(String(error)); }
  }
  const preview = graphPreview(plan);
  const planningMs = Date.now() - started;
  if (values.list) {
    console.log(JSON.stringify({ profile: values.profile, requested: values.scenario, requestedGroups: values.group, scope: partial ? 'partial' : 'full', groups, scenarios: selected, selection, graph: { plan: selected.length ? plan : null, preview: selected.length ? preview : null, timingReference, timingWarning, timingContext, planningMs } }, null, 2));
    return;
  }
  assertEnvironment();
  const evidence = join(root, 'evidence', id());
  await mkdir(join(evidence, 'tmp'), { recursive: true, mode: 0o700 });
  await atomic(join(evidence, 'plan.json'), { plan, preview, timingReference, timingWarning, timingContext, planningMs });
  if (selection) {
    await atomic(join(evidence, 'selection.json'), selection);
    console.log(values.iterate ? `Affected selection: ${selected.length}/${scenarios.length} scenarios.` : `Full gate: ${selected.length}/${scenarios.length} scenarios; affected prediction ${selection.decision === 'ready' ? selection.predictedScenarios.length + ' scenarios' : selection.decision}.`);
    if (selection.fallback.length) console.log(`Selection uncertainty: ${selection.fallback.join('; ')}`);
    for (const warning of selection.warnings) console.log(`Selection review: ${warning}`);
  }
  const pkg = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'));
  const commands: Array<{ command: string; status: 'passed' | 'failed' | 'blocked'; durationMs?: number; error?: string }> = [];
  const events: Array<TestEvent & { observedAt: number }> = [];
  const offsets = new Map<string, number>();
  const completed = new Set<string>();
  const environments = new Set<string>();
  const releasedEnvironments = new Set<string>();
  const releaseEnvironment = (instanceId: string) => { releasedEnvironments.add(instanceId); environments.delete(instanceId); };
  const acknowledgeCleanup = (records: CleanupRecord[]) => {
    for (const record of records) if (record.status === 'passed' && record.instanceId) releaseEnvironment(record.instanceId);
  };
  let output = '', interrupted = false, reading: Promise<void> | undefined;
  let graphState: GraphState = {}, progressWriting = Promise.resolve();
  const publishProgress = () => {
    const snapshot = { state: structuredClone(graphState), preview: graphPreview(plan, graphState), environments: [...environments], at: Date.now() };
    const html = graphReport(plan, snapshot.state, started, snapshot.environments, partial ? 'partial' : 'full');
    progressWriting = progressWriting.then(async () => {
      await atomic(join(evidence, 'progress.json'), snapshot);
      await writeFile(join(evidence, 'timeline.html'), html, {mode:0o600});
    });
    return progressWriting;
  };
  const active = new Map<string, ReturnType<typeof spawn>>();
  const controller = new AbortController();
  const interrupt = () => {
    interrupted = true;
    controller.abort();
    for (const child of active.values()) if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
    const force = setTimeout(() => {
      for (const child of active.values()) if (child.pid && child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }, 3000);force.unref();
  };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const collectEvents = async () => {
    let received = false;
    for (const file of await readdir(join(evidence, 'events')).catch(() => [])) {
      if (!file.endsWith('.jsonl')) continue;
      const contents = await readFile(join(evidence, 'events', file), 'utf8');
      const start = offsets.get(file) ?? 0, end = contents.lastIndexOf('\n') + 1;
      if (end <= start) continue;
      for (const line of contents.slice(start, end).trim().split('\n')) {
        const event = JSON.parse(line) as TestEvent;
        received = true;
        events.push({ ...event, observedAt: Date.now() });
        if (event.name === 'environment.owned' && event.context && !releasedEnvironments.has(event.context)) environments.add(event.context);
        if (event.name === 'instance.cleanup' && event.status === 'passed' && event.context) releaseEnvironment(event.context);
        if (event.kind === 'scenario') {
          if (event.status === 'started') {
            const item = selected.find(s => s.id === event.name);
            console.log(`RUN ${item?.group ?? event.name}: ${event.name}`);
          } else {
            completed.add(event.name);
            console.log(`${event.status === 'passed' ? 'PASS' : 'FAIL'} ${event.name} (${((event.durationMs ?? 0) / 1000).toFixed(1)}s) [${completed.size}/${selected.length}]`);
          }
        } else if (event.status === 'started') {
          console.log(`PHASE ${event.name} (${event.context ?? ''})`);
        }
      }
      offsets.set(file, end);
    }
    if (received) await publishProgress();
  };
  const poll = setInterval(() => {
    if (!reading) reading = collectEvents().catch(error => { executionError = redact(String(error)); }).finally(() => { reading = undefined; });
  }, 200);
  console.log(`Verification evidence: ${evidence}`);
  if (partial) console.log(`Selected groups: ${groups.join(', ')} (${selected.length} scenarios; partial verification)`);
  console.log(`Execution graph: ${plan.nodes.length} nodes; ${workers} worker slots; expected ${preview.estimatedMs === null ? 'time unknown (' + preview.unknown.length + ' untimed nodes)' : Math.round(preview.estimatedMs / 1000) + 's'}`);
  let failed = false, sourceValid = false;
  let sourceError: string | undefined, executionError: string | undefined;
  let cleanup: CleanupRecord[] = [], cleanupPerformed = false;
  const execute = async (node: GraphNode) => {
    if (node.kind === 'cleanup') {
      cleanup = await recoverResources(evidence, checkout);cleanupPerformed = true;
      acknowledgeCleanup(cleanup);
      await atomic(join(evidence, 'cleanup.json'), cleanup);
      if (cleanup.some(c => c.status !== 'passed')) throw new Error('Owned resource cleanup failed');
      return;
    }
    const args = node.command!.map(arg => arg === '$BUILD' ? join(evidence, 'build') : arg);
    const command = `pnpm ${args.join(' ')}`, commandStarted = Date.now();
    let commandOutput = '';
    const outcome = await new Promise<{ passed: boolean; error?: string }>(resolve => {
      const child = spawn('pnpm', args, { cwd: checkout, env: {
        ...childEnvironment(join(evidence, 'tmp')), ASH_DEV_ROOT: root, ASH_TEST_EVIDENCE: evidence,
        ASH_TEST_WORKERS: '1', ASH_TEST_TIMING: values.timing, ASH_TEST_NODE_ID: node.id,
        ASH_TEST_CASES: JSON.stringify(node.scenarios),
      }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      active.set(node.id, child);
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { commandOutput += chunk.toString(); });
      child.once('error', error => resolve({ passed: false, error: error.message }));
      child.once('close', (code, signal) => resolve({ passed: code === 0 && !interrupted, error: code === 0 ? undefined : `Exit ${code ?? signal}` }));
    });
    active.delete(node.id);
    output += `\n$ ${command}\n${commandOutput}`;
    commands.push({ command, status: outcome.passed ? 'passed' : 'failed', durationMs: Date.now() - commandStarted, error: outcome.error });
    if (!outcome.passed) console.error(redact(commandOutput).slice(-2500));
    await writeFile(join(evidence, 'checks.log'), redact(output), { mode: 0o600 });
    if (!outcome.passed) throw new Error(`${command}: ${outcome.error}`);
  };
  try {
    graphState = await runGraph(plan, execute, controller.signal, (state, node) => {
      graphState = structuredClone(state);
      const status = state[node.id];
      console.log(`${status.status === 'running' ? 'START' : status.status.toUpperCase()} ${node.id}${status.durationMs === undefined ? '' : ' (' + Math.round(status.durationMs / 1000) + 's)'}`);
      const remaining = graphPreview(plan, graphState).estimatedMs;
      if (remaining !== null && status.status !== 'running') console.log(`ESTIMATE ${Math.ceil(remaining / 1000)}s remaining`);
      return publishProgress();
    });
    failed = Object.values(graphState).some(s => s.status !== 'passed');
  } catch (error) { failed = true; executionError = redact(String(error)); }
  finally {
    await reading;
    try { await collectEvents(); } catch (error) { executionError = redact(String(error)); }
    if (!cleanupPerformed) cleanup = await recoverResources(evidence, checkout);
    acknowledgeCleanup(cleanup);
    if (cleanup.some(c => c.status !== 'passed')) failed = true;
    await atomic(join(evidence, 'cleanup.json'), cleanup);
    await writeFile(join(evidence, 'checks.log'), redact(output), { mode: 0o600 });
    clearInterval(poll);
    await reading;
    try { await collectEvents(); } catch (error) { executionError = redact(String(error)); }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await publishProgress();
    try {
      const after = await fingerprint(checkout);
      sourceValid = after.hash === before!.hash && after.commit === before!.commit;
      if (!sourceValid) sourceError = 'Source changed during verification; rerun on the final revision';
    } catch (error) { sourceError = redact(String(error)); }
    const results = await Promise.all(scenarios.map(async item => {
      if (!selected.includes(item)) return { ...item, status: 'not-selected', attempts: [] };
      try {
        const result: ScenarioResult = JSON.parse(await readFile(join(evidence, 'results', `${item.id}.json`), 'utf8'));
        if (result.id !== item.id || !Array.isArray(result.attempts) || !result.attempts.length) throw new Error('Invalid scenario result');
        const status = result.attempts.every(a => a.status === 'passed') ? 'passed'
          : result.attempts.some(a => a.status === 'failed') ? 'failed'
          : result.attempts.every(a => a.status === 'skipped') ? 'skipped' : 'blocked';
        return { ...item, ...result, status };
      } catch (error) {
        return { ...item, status: 'blocked', attempts: [], reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'No result; suite did not complete this scenario' : redact(String(error)) };
      }
    }));
    const unexpected = (await readdir(join(evidence, 'results')).catch(() => [])).filter(file => file.endsWith('.json') && !selected.some(item => file === `${item.id}.json`));
    if (unexpected.length) executionError = `Unselected scenario results: ${unexpected.join(', ')}`;
    const manual = manualChecks.filter(check => check.suites.some(suite => suites.has(suite)));
    if (manual.length) {
      const plan = '# Manual checks\n\nRun when native behavior or interaction design changes. Results remain pending until a human records them.\n\n'
        + manual.map(check => `## ${check.title}\n\nStart from this checkout: \`${check.command}\`\n\n${check.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n`).join('\n');
      await writeFile(join(evidence, 'manual-plan.md'), plan);
    }
    const passed = !failed && !interrupted && !executionError && sourceValid && results.filter(r => r.status !== 'not-selected').every(r => r.status === 'passed');
    await writeFile(join(evidence, 'timeline.html'), graphReport(plan, graphState, started, [...environments], partial ? 'partial' : 'full', passed), {mode:0o600});
    await atomic(join(evidence, 'report.json'), {
      version: 2, source: before, sourceValid, sourceError,
      environment: { platform: process.platform, arch: process.arch, osRelease: release(), node: process.version, electron: pkg.devDependencies.electron, playwright: pkg.devDependencies['@playwright/test'], cores: availableParallelism(), totalMemoryBytes: totalmem() },
      loadAtStart, loadAtEnd: { average: loadavg(), freeMemoryBytes: freemem() },
      profile: values.profile, requested: values.scenario, requestedGroups: values.group, suites: [...suites], groups,
      scope: partial ? 'partial' : 'full', workers, timing: values.timing, selection,
      graph: { plan, state: graphState, preview, timingReference, timingWarning, timingContext, planningMs,
        prediction: { estimatedMs: preview.estimatedMs, observedMs: Date.now()-started, errorMs: preview.estimatedMs === null ? null : Date.now()-started-preview.estimatedMs } },
      startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, events, cleanup,
      fixtureVersion: FIXTURE_VERSION, schemaVersion: SCHEMA_VERSION, productMigration: '202610150001_artifact_engine',
      model: 'deterministic/ash-test-v1 + mocked OpenAI Responses', liveProviderCalls: 0, commands, scenarios: results,
      agentReview: { status: 'not-recorded' }, manual: manual.map(check => ({ id: check.id, status: 'pending' })),
      passed, interrupted, executionError, completedAt: new Date().toISOString(),
    });
    if (passed && (!partial || !await exists(join(root, 'verification-reference.json')))) await atomic(join(root, 'verification-reference.json'), {path:join(evidence,'report.json')});
    const count = results.filter(r => r.status === 'passed').length;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${partial ? 'partial' : 'full'} automated verification: ${count}/${selected.length} scenarios (${Math.round((Date.now() - started) / 1000)}s). ${manual.length ? 'Manual plan available if needed.' : ''}`);
    if (sourceError) console.error(sourceError);
    if (executionError) console.error(executionError);
    if (!passed) process.exitCode = 1;
  }
}
async function recoverResources(evidence: string, checkout: string) {
  const cleanup: CleanupRecord[] = [];
  for (const kind of ['instances', 'processes', 'clusters', 'checkouts'] as const) {
    const directory = join(evidence, 'resources', kind);
    for (const file of await readdir(directory).catch(() => [])) {
      let instanceId: string | undefined;
      try {
        if (kind === 'instances') {
          const instance = Instance.parse(await json(join(directory, file)));
          instanceId = instance.id;
          if (instance.profile === 'preview' && instance.checkout === checkout) throw new Error('Refusing to dispose the persistent preview');
          const { recoverRecordedInstance } = await import('./lifecycle.ts');await recoverRecordedInstance(instance);
        } else if (kind === 'processes') await stopProcess(await json<ProcessRef>(join(directory, file)), true);
        else if (kind === 'clusters') {
          const resource = await json<{id:string;root:string}>(join(directory,file));
          if (!resource.root.startsWith(join(evidence,'tmp') + '/')) throw new Error('Refusing shared cluster cleanup');
          const { disposeTestCluster } = await import('./database.ts');await disposeTestCluster(resource.id);
        } else {
          const resource = await json<{source:string;checkout:string}>(join(directory,file));
          if (resource.source !== checkout || !resource.checkout.startsWith(join(evidence,'tmp') + '/')) throw new Error('Refusing checkout cleanup outside this verification session');
          if (await exists(resource.checkout)) await exec('git',['worktree','remove','--force',resource.checkout],{cwd:resource.source});
        }
        cleanup.push({kind,id:file,status:'passed',...(instanceId ? {instanceId} : {})});
      } catch (error) { cleanup.push({kind,id:file,status:'failed',error:redact(String(error))}); }
    }
  }
  return cleanup;
}
void main().catch(error => { console.error(redact(String(error))); process.exitCode = 1; });
