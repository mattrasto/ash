import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { release, loadavg, freemem, totalmem, availableParallelism } from 'node:os';
import { assertEnvironment, atomic, childEnvironment, devRoot, fingerprint, id, exec, exists, json, stopProcess, type ProcessRef } from './io.ts';
import { manualChecks, scenarios, selectScenarios, type Suite } from '../../tests/scenarios.ts';
import { redact, type ScenarioResult } from '../../tests/support/results.ts';
import type { TestEvent } from './telemetry.ts';
import { SCHEMA_VERSION, FIXTURE_VERSION, Instance } from '../../packages/shared/src/index.ts';

async function main() {
  const started = Date.now();
  const loadAtStart = { average: loadavg(), freeMemoryBytes: freemem() };
  const { values } = parseArgs({ options: {
    profile: { type: 'string', default: 'full' }, scenario: { type: 'string' }, group: { type: 'string' },
    workers: { type: 'string', default: '2' }, timing: { type: 'string', default: 'accelerated' }, list: { type: 'boolean' },
  } });
  const workers = Number(values.workers);
  if (![1, 2].includes(workers)) throw new Error('workers must be 1 or 2');
  if (!['normal', 'accelerated'].includes(values.timing!)) throw new Error('timing must be normal or accelerated');
  const selected = selectScenarios(values.profile!, values.scenario, values.group);
  const suites = new Set(selected.map(s => s.suite));
  const groups = [...new Set(selected.map(s => s.group))];
  const partial = !!(values.scenario || values.group) || values.profile !== 'full';
  if (values.list) {
    console.log(JSON.stringify({ profile: values.profile, requested: values.scenario, requestedGroups: values.group, scope: partial ? 'partial' : 'full', groups, scenarios: selected }, null, 2));
    return;
  }
  assertEnvironment();
  const checkout = process.cwd();
  const root = await devRoot();
  const evidence = join(root, 'evidence', id());
  await mkdir(join(evidence, 'tmp'), { recursive: true, mode: 0o700 });
  const before = await fingerprint(checkout);
  const pkg = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'));
  const commands: Array<{ command: string; status: 'passed' | 'failed' | 'blocked'; durationMs?: number; error?: string }> = [];
  const events: Array<TestEvent & { observedAt: number }> = [];
  const offsets = new Map<string, number>();
  const completed = new Set<string>();
  let output = '', interrupted = false, reading: Promise<void> | undefined;
  let active: ReturnType<typeof spawn> | undefined;
  const interrupt = () => {
    interrupted = true;
    if (active?.pid) { try { process.kill(-active.pid, 'SIGTERM'); } catch { active.kill('SIGTERM'); } }
  };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const collectEvents = async () => {
    for (const file of await readdir(join(evidence, 'events')).catch(() => [])) {
      if (!file.endsWith('.jsonl')) continue;
      const contents = await readFile(join(evidence, 'events', file), 'utf8');
      const start = offsets.get(file) ?? 0, end = contents.lastIndexOf('\n') + 1;
      if (end <= start) continue;
      for (const line of contents.slice(start, end).trim().split('\n')) {
        const event = JSON.parse(line) as TestEvent;
        events.push({ ...event, observedAt: Date.now() });
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
  };
  const poll = setInterval(() => {
    if (!reading) reading = collectEvents().catch(error => { executionError = redact(String(error)); }).finally(() => { reading = undefined; });
  }, 200);
  const planned = [['typecheck'], ...(values.profile === 'full' || values.scenario || values.group ? [['build', join(evidence, 'build')]] : [])];
  for (const suite of ['boundary', 'workflow', 'desktop'] as Suite[]) {
    if (!suites.has(suite)) continue;
    const args = [`test:${suite}`];
    if (partial && suite !== 'boundary') {
      const items = selected.filter(s => s.suite === suite);
      args.push(...new Set(items.map(s => s.file)));
      if (suite === 'desktop') {
        const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        args.push('--grep', `(?:^|\\s)(?:${items.map(s => escape(s.id)).join('|')})(?::|$)`);
      }
    }
    planned.push(args);
  }
  console.log(`Verification evidence: ${evidence}`);
  if (partial) console.log(`Selected groups: ${groups.join(', ')} (${selected.length} scenarios; partial verification)`);
  let failed = false, sourceValid = false;
  let sourceError: string | undefined, executionError: string | undefined;
  try {
    for (const args of planned) {
      const command = `pnpm ${args.join(' ')}`;
      if (failed || interrupted) { commands.push({ command, status: 'blocked' }); continue; }
      const commandStarted = Date.now();
      console.log(`START ${args[0]}`);
      let commandOutput = '';
      const outcome = await new Promise<{ passed: boolean; error?: string }>(resolve => {
        active = spawn('pnpm', args, { cwd: checkout, env: {
          ...childEnvironment(join(evidence, 'tmp')), ASH_DEV_ROOT: root, ASH_TEST_EVIDENCE: evidence,
          ASH_TEST_WORKERS: String(workers), ASH_TEST_TIMING: values.timing,
        }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [active.stdout, active.stderr]) stream?.on('data', chunk => { commandOutput += chunk.toString(); });
        active.once('error', error => resolve({ passed: false, error: error.message }));
        active.once('close', (code, signal) => resolve({ passed: code === 0 && !interrupted, error: code === 0 ? undefined : `Exit ${code ?? signal}` }));
      });
      active = undefined;
      output += `\n$ ${command}\n${commandOutput}`;
      commands.push({ command, status: outcome.passed ? 'passed' : 'failed', durationMs: Date.now() - commandStarted, error: outcome.error });
      console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${args[0]} (${Math.round((Date.now() - commandStarted) / 1000)}s)`);
      failed ||= !outcome.passed;
      if (!outcome.passed) console.error(redact(commandOutput).slice(-2500));
      await writeFile(join(evidence, 'checks.log'), redact(output), { mode: 0o600 });
    }
  } catch (error) { failed = true; executionError = redact(String(error)); }
  finally {
    await reading;
    try { await collectEvents(); } catch (error) { executionError = redact(String(error)); }
    const cleanup: Array<{kind:string;id:string;status:string;error?:string}> = [];
    for (const kind of ['instances', 'processes', 'clusters', 'checkouts'] as const) {
      const directory = join(evidence, 'resources', kind);
      for (const file of await readdir(directory).catch(() => [])) {
        try {
          if (kind === 'instances') {
            const instance = Instance.parse(await json(join(directory, file)));
            if (instance.profile === 'preview' && instance.checkout === checkout) throw new Error('Refusing to dispose the persistent preview');
            const { recoverRecordedInstance } = await import('./lifecycle.ts');
            await recoverRecordedInstance(instance);
          } else if (kind === 'processes') {
            await stopProcess(await json<ProcessRef>(join(directory, file)), true);
          } else if (kind === 'clusters') {
            const resource = await json<{id:string;root:string}>(join(directory,file));
            if (!resource.root.startsWith(join(evidence,'tmp') + '/')) throw new Error('Refusing shared cluster cleanup');
            const { disposeTestCluster } = await import('./database.ts');
            await disposeTestCluster(resource.id);
          } else {
            const resource = await json<{source:string;checkout:string}>(join(directory,file));
            if (resource.source !== checkout || !resource.checkout.startsWith(join(evidence,'tmp') + '/')) throw new Error('Refusing checkout cleanup outside this verification session');
            if (await exists(resource.checkout)) {
              await exec('git',['worktree','remove','--force',resource.checkout],{cwd:resource.source});
            }
          }
          cleanup.push({kind,id:file,status:'passed'});
        } catch (error) { cleanup.push({kind,id:file,status:'failed',error:redact(String(error))}); failed = true; }
      }
    }
    await atomic(join(evidence, 'cleanup.json'), cleanup);
    clearInterval(poll);
    await reading;
    try { await collectEvents(); } catch (error) { executionError = redact(String(error)); }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    try {
      const after = await fingerprint(checkout);
      sourceValid = after.hash === before.hash && after.commit === before.commit;
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
    await atomic(join(evidence, 'report.json'), {
      version: 2, source: before, sourceValid, sourceError,
      environment: { platform: process.platform, arch: process.arch, osRelease: release(), node: process.version, electron: pkg.devDependencies.electron, playwright: pkg.devDependencies['@playwright/test'], cores: availableParallelism(), totalMemoryBytes: totalmem() },
      loadAtStart, loadAtEnd: { average: loadavg(), freeMemoryBytes: freemem() },
      profile: values.profile, requested: values.scenario, requestedGroups: values.group, suites: [...suites], groups,
      scope: partial ? 'partial' : 'full', workers, timing: values.timing,
      startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, events, cleanup,
      fixtureVersion: FIXTURE_VERSION, schemaVersion: SCHEMA_VERSION, productMigration: '202610150001_artifact_engine',
      model: 'deterministic/ash-test-v1 + mocked OpenAI Responses', liveProviderCalls: 0, commands, scenarios: results,
      agentReview: { status: 'not-recorded' }, manual: manual.map(check => ({ id: check.id, status: 'pending' })),
      passed, interrupted, executionError, completedAt: new Date().toISOString(),
    });
    const count = results.filter(r => r.status === 'passed').length;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${partial ? 'partial' : 'full'} automated verification: ${count}/${selected.length} scenarios (${Math.round((Date.now() - started) / 1000)}s). ${manual.length ? 'Manual plan available if needed.' : ''}`);
    if (sourceError) console.error(sourceError);
    if (executionError) console.error(executionError);
    if (!passed) process.exitCode = 1;
  }
}
void main().catch(error => { console.error(redact(String(error))); process.exitCode = 1; });
