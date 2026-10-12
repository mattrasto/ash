import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { release } from 'node:os';
import { assertEnvironment, atomic, childEnvironment, devRoot, fingerprint, id } from './io.ts';
import { manualChecks, scenarios, selectScenarios, type Suite } from '../../tests/scenarios.ts';
import { redact, type ScenarioResult } from '../../tests/support/results.ts';
import { SCHEMA_VERSION, FIXTURE_VERSION } from '../../packages/shared/src/index.ts';

async function main() {
  const { values } = parseArgs({ options: {
    profile: { type: 'string', default: 'full' }, scenario: { type: 'string' }, list: { type: 'boolean' },
  } });
  const selected = selectScenarios(values.profile!, values.scenario);
  const suites = new Set(selected.map(s => s.suite));
  if (values.list) {
    console.log(JSON.stringify({ profile: values.profile, requested: values.scenario, scenarios: selected }, null, 2));
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
  let output = '';
  let interrupted = false;
  let active: ReturnType<typeof spawn> | undefined;
  const interrupt = () => { interrupted = true; active?.kill('SIGTERM'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const planned = [['typecheck'], ...(values.profile === 'full' || values.scenario ? [['build', join(evidence, 'build')]] : [])];
  const suiteCommands: Record<Suite, string> = { boundary: 'test:boundary', workflow: 'test:workflow', desktop: 'test:desktop' };
  for (const suite of ['boundary', 'workflow', 'desktop'] as Suite[]) if (suites.has(suite)) planned.push([suiteCommands[suite]]);
  if (values.scenario) console.log(`Selection ${values.scenario} runs complete suites: ${[...suites].join(', ')}`);
  console.log(`Verification evidence: ${evidence}`);
  let failed = false;
  let sourceValid = false;
  let sourceError: string | undefined;
  let executionError: string | undefined;
  try {
    for (const args of planned) {
      const command = `pnpm ${args.join(' ')}`;
      if (failed || interrupted) { commands.push({ command, status: 'blocked' }); continue; }
      const started = Date.now();
      let commandOutput = '';
      const outcome = await new Promise<{ passed: boolean; error?: string }>(resolve => {
        active = spawn('pnpm', args, { cwd: checkout, env: {
          ...childEnvironment(join(evidence, 'tmp')), ASH_DEV_ROOT: root, ASH_TEST_EVIDENCE: evidence,
        }, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [active.stdout, active.stderr]) stream?.on('data', chunk => { commandOutput += chunk.toString(); });
        active.once('error', error => resolve({ passed: false, error: error.message }));
        active.once('close', (code, signal) => resolve({ passed: code === 0 && !interrupted, error: code === 0 ? undefined : `Exit ${code ?? signal}` }));
      });
      active = undefined;
      output += `\n$ ${command}\n${commandOutput}`;
      commands.push({ command, status: outcome.passed ? 'passed' : 'failed', durationMs: Date.now() - started, error: outcome.error });
      console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${args[0]} (${Math.round((Date.now() - started) / 1000)}s)`);
      failed ||= !outcome.passed;
      if (!outcome.passed) console.error(redact(commandOutput).slice(-2500));
      await writeFile(join(evidence, 'checks.log'), redact(output), { mode: 0o600 });
    }
  } catch (error) {
    failed = true;
    executionError = redact(String(error));
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
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
    const manual = manualChecks.filter(check => check.suites.some(suite => suites.has(suite)));
    if (manual.length) {
      const plan = '# Manual checks\n\nRun when native behavior or interaction design changes. Results remain pending until a human records them.\n\n'
        + manual.map(check => `## ${check.title}\n\nStart from this checkout: \`${check.command}\`\n\n${check.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n`).join('\n');
      await writeFile(join(evidence, 'manual-plan.md'), plan);
    }
    const passed = !failed && !interrupted && sourceValid && results.filter(r => r.status !== 'not-selected').every(r => r.status === 'passed');
    await atomic(join(evidence, 'report.json'), {
      version: 1, source: before, sourceValid, sourceError,
      environment: { platform: process.platform, arch: process.arch, osRelease: release(), node: process.version, electron: pkg.devDependencies.electron, playwright: pkg.devDependencies['@playwright/test'] },
      profile: values.profile, requested: values.scenario, suites: [...suites],
      scope: values.profile === 'full' && !values.scenario ? 'full' : 'partial',
      fixtureVersion: FIXTURE_VERSION, schemaVersion: SCHEMA_VERSION, productMigration: '202610120001_images',
      model: 'deterministic/ash-test-v1 + mocked OpenAI Responses', liveProviderCalls: 0, commands, scenarios: results,
      agentReview: { status: 'not-recorded' }, manual: manual.map(check => ({ id: check.id, status: 'pending' })),
      passed, interrupted, executionError, completedAt: new Date().toISOString(),
    });
    const count = results.filter(r => r.status === 'passed').length;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${values.scenario ? 'selected' : values.profile} automated verification: ${count}/${selected.length} scenarios. ${manual.length ? 'Manual plan available if needed.' : ''}`);
    if (sourceError) console.error(sourceError);
    if (executionError) console.error(executionError);
    if (!passed) process.exitCode = 1;
  }
}

void main().catch(error => { console.error(redact(String(error))); process.exitCode = 1; });
