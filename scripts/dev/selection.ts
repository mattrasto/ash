import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { exec } from './io.ts';
import { validateWorkerCount } from './graph.ts';
import { scenarios, testGroups, impactComponents } from '../../tests/scenarios.ts';

export async function changedFiles(checkout: string, base: string) {
  const revision = (await exec('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { cwd: checkout })).stdout.trim();
  const diff = (await exec('git', ['diff', '--name-status', '-z', '--find-renames', revision, '--'], { cwd: checkout })).stdout.split('\0');
  const changes: Array<{ status: string; before?: string; after?: string }> = [];
  for (let n = 0; n < diff.length && diff[n];) {
    const status = diff[n++], first = diff[n++];
    if (/^[RC]/.test(status)) changes.push({ status, before: first, after: diff[n++] });
    else changes.push({ status, ...(status !== 'A' ? { before: first } : {}), ...(status !== 'D' ? { after: first } : {}) });
  }
  for (const path of (await exec('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: checkout })).stdout.split('\0').filter(Boolean)) changes.push({ status: 'A', after: path });
  return { revision, changes };
}
const production = (path: string) => path.startsWith('packages/') && /\.(ts|svelte)$/.test(path) && !/\.test\.ts$/.test(path);
function imports(path: string, source: string) {
  const text = path.endsWith('.svelte') ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n') : source;
  return ts.preProcessFile(text, true, true).importedFiles.map(value => value.fileName).filter(value => value.startsWith('.')).map(value => posix.normalize(posix.join(posix.dirname(path), value)));
}
function resolveImport(path: string, files: Set<string>) { return [path, path.replace(/\.js$/, '.ts'), `${path}.ts`, `${path}.svelte`, `${path}/index.ts`].find(value => files.has(value)); }

// Iteration uses the reviewed selection; intentional final gates retain full scope.
export async function affectedPlan(checkout: string, base: string, reference?: string) {
  const { revision, changes } = await changedFiles(checkout, base);
  const currentPaths = (await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: checkout })).stdout.split('\0').filter(Boolean);
  const oldPaths = (await exec('git', ['ls-tree', '-r', '--name-only', '-z', revision, '--', 'packages'], { cwd: checkout })).stdout.split('\0').filter(Boolean);
  const allPaths = new Set([...currentPaths, ...oldPaths]);
  const sources = new Map<string, string>();
  for (const path of new Set(currentPaths.filter(production))) {
    try { sources.set(path, await readFile(join(checkout, path), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const dependencies = new Map([...sources].map(([path, source]) => [path, imports(path, source).map(value => resolveImport(value, allPaths)).filter((value): value is string => !!value)]));
  const reasons = new Map<string, Set<string>>(), fallback = new Set<string>(), warnings: string[] = [];
  const add = (id: string, reason: string) => { if (!scenarios.some(s => s.id === id)) { fallback.add(`Unknown scenario ${id}`); return; } const set = reasons.get(id) ?? new Set(); set.add(reason); reasons.set(id, set); };
  const owners = new Map<string, string>();
  for (const component of impactComponents) {
    for (const path of component.files) {
      if (owners.has(path)) fallback.add(`Ambiguous ownership: ${path}`);
      owners.set(path, component.id);
      if (!sources.has(path)) fallback.add(`Stale ${component.id} mapping: ${path}`);
    }
    for (const path of component.consumers) if (!sources.has(path)) fallback.add(`Missing ${component.id} consumer: ${path}`);
    for (const id of component.scenarios) if (!scenarios.some(s => s.id === id)) fallback.add(`Unknown ${component.id} scenario: ${id}`);
    const linkedConsumers = new Set<string>();
    for (const [path, targets] of dependencies) for (const target of targets) {
      if (component.files.includes(target)) linkedConsumers.add(path);
      if (component.files.includes(target) && !component.files.includes(path) && !component.consumers.includes(path)) fallback.add(`Undeclared ${component.id} consumer: ${path}`);
    }
    for (const path of component.consumers) if (sources.has(path) && !linkedConsumers.has(path)) fallback.add(`Stale ${component.id} consumer link: ${path}`);
  }
  for (const change of changes) for (const path of new Set([change.before, change.after].filter((p): p is string => !!p))) {
    if (/^(docs\/|specs\/|README\.md$)/.test(path)) continue;
    const test = scenarios.filter(s => s.file === path || s.suite === 'boundary' && /^tests\/boundary\/.*\.test\.ts$/.test(path));
    if (test.length) { for (const item of test) add(item.id, `Changed test file: ${path}`); continue; }
    const component = impactComponents.find(c => c.files.includes(path));
    if (component) {
      for (const id of component.scenarios) add(id, `${path} → ${component.id}: ${component.contract}`);
      if (change.before && change.after && production(path)) {
        const previous = (await exec('git', ['show', `${revision}:${change.before}`], { cwd: checkout })).stdout;
        const oldImports = new Set(imports(change.before, previous).map(value => resolveImport(value, allPaths) ?? value));
        const nextImports = imports(change.after, sources.get(change.after) ?? '').map(value => resolveImport(value, allPaths) ?? value);
        for (const dependency of nextImports) if (!oldImports.has(dependency) && !component.files.includes(dependency)) fallback.add(`Review new dependency: ${path} → ${dependency}`);
      }
      continue;
    }
    fallback.add(`${/^(scripts\/|tests\/(support|helpers|fixtures|baselines)\/|packages\/shared\/|packages\/server\/prisma\/|package\.json$|pnpm-lock\.yaml$|tsconfig\.json$|compose\.yaml$)/.test(path) ? 'Shared change' : 'Unmapped change'}: ${path}`);
  }
  const direct = scenarios.filter(s => reasons.has(s.id));
  const groups = new Set(direct.map(s => s.group));
  const expanded = scenarios.filter(s => groups.has(s.group));
  for (const component of impactComponents) {
    if (!component.scenarios.some(id => reasons.has(id))) continue;
    const relatedGroups = new Set(scenarios.filter(s => component.scenarios.includes(s.id)).map(s => s.group));
    const count = scenarios.filter(s => relatedGroups.has(s.group)).length;
    if (count > component.reviewAbove) warnings.push(`${component.id} expands to ${count} scenarios; reviewed budget is ${component.reviewAbove}`);
  }
  const predicted = fallback.size ? [] : expanded;
  const decision = fallback.size || warnings.length ? 'deferred' : predicted.length ? 'ready' : 'not-needed';
  return { mode: 'shadow' as const, base: revision, changes, fallback: [...fallback], warnings, decision,
    iterationScenarios: decision === 'ready' ? predicted.map(s => s.id) : [],
    direct: direct.map(s => ({ id: s.id, reasons: [...reasons.get(s.id)!] })),
    addedByGroup: expanded.filter(s => !reasons.has(s.id)).map(s => ({ id: s.id, group: s.group, requiredBy: direct.filter(d => d.group === s.group).map(d => d.id) })),
    predictedGroups: [...new Set(predicted.map(s => s.group))], predictedScenarios: predicted.map(s => s.id),
    expansionRatio: direct.length ? expanded.length / direct.length : null,
    execution: 'Uncertain iteration is deferred; explicit final full verification remains required',
    referenceCost: reference ? await estimateCost(reference, predicted.map(s => s.id)) : null,
  };
}

async function estimateCost(path: string, ids: string[]) {
  const report = JSON.parse(await readFile(path, 'utf8'));
  if (report.version !== 2 || report.passed !== true || report.sourceValid !== true || !Array.isArray(report.scenarios) || !Array.isArray(report.events) || !Array.isArray(report.commands)) throw new Error('Reference cost requires a passing verification report with timing events');
  validateWorkerCount(report.workers);
  const costs = new Map<string, number>();
  for (const group of testGroups) {
    const items = report.scenarios.filter((s: any) => group.scenarios.includes(s.id));
    if (items.length !== group.scenarios.length || items.some((s: any) => s.status !== 'passed')) continue;
    if (group.suite === 'desktop') costs.set(group.id, items.reduce((n: number, s: any) => n + s.attempts.reduce((m: number, a: any) => m + a.durationMs, 0), 0));
    else if (group.suite === 'workflow') {
      const processes = new Set(report.events.filter((e: any) => e.kind === 'scenario' && group.scenarios.includes(e.name)).map((e: any) => e.processId));
      const events = report.events.filter((e: any) => processes.has(e.processId));
      if (events.length) costs.set(group.id, Math.max(...events.map((e: any) => e.at)) - Math.min(...events.map((e: any) => e.at)));
    }
  }
  const picked = testGroups.filter(g => g.scenarios.some(id => ids.includes(id)));
  const command = (name: string) => report.commands.filter((c: any) => c.status === 'passed').find((c: any) => c.command === `pnpm ${name}` || c.command.startsWith(`pnpm ${name} `))?.durationMs;
  const missingGroups = picked.filter(g => g.suite !== 'boundary' && !costs.has(g.id)).map(g => g.id);
  const schedule = (values: number[]) => { const lanes = Array<number>(report.workers).fill(0);for (const cost of values) { const lane = lanes.indexOf(Math.min(...lanes));lanes[lane] += cost; }return Math.max(...lanes); };
  const workflow = picked.filter(g => g.suite === 'workflow' && !g.exclusive);
  const exclusive = picked.filter(g => g.exclusive).reduce((n, g) => n + (costs.get(g.id) ?? 0), 0);
  const desktop = new Map<string, number>();
  for (const group of picked.filter(g => g.suite === 'desktop')) desktop.set(group.file, (desktop.get(group.file) ?? 0) + (costs.get(group.id) ?? 0));
  const prerequisites = ids.length ? (command('typecheck') ?? 0) + (command('build') ?? 0) : 0;
  const boundary = picked.some(g => g.suite === 'boundary') ? command('test:boundary') ?? 0 : 0;
  return { source: report.source, workers: report.workers, missingGroups,
    estimatedMs: missingGroups.length ? null : prerequisites + boundary + schedule(workflow.map(g => costs.get(g.id) ?? 0)) + exclusive + schedule([...desktop.values()]),
    groupCosts: Object.fromEntries(picked.map(g => [g.id, costs.get(g.id) ?? (g.suite === 'boundary' ? boundary : null)])),
    note: 'Approximation from one historical run, including recorded setup and cleanup. Host load and scheduling may differ.',
  };
}
