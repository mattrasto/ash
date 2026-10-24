import { scenarios, testGroups, type Scenario } from '../../tests/scenarios.ts';

export const MAX_WORKERS = 12;
export function validateWorkerCount(workers: number) {
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) throw new Error(`workers must be an integer from 1 to ${MAX_WORKERS}`);
  return workers;
}

export type NodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled';
export interface GraphNode {
  id: string;
  kind: 'prepare' | 'check' | 'cleanup';
  label: string;
  requires: Array<{ id: string; when: 'passed' | 'settled'; reason: string }>;
  slots: number;
  scenarios: string[];
  adapter?: 'boundary-suite' | 'legacy-bundle' | 'node-case' | 'playwright-batch';
  command?: string[];
  environment?: { ownership: 'adapter'; isolation: 'fresh-instance'; presets: string[] };
  estimatedMs: number | null;
}
export interface ExecutionPlan { version: 1; workers: number; nodes: GraphNode[]; selected: string[]; timing: string }
export interface NodeResult { status: NodeStatus; startedAt?: number; finishedAt?: number; durationMs?: number; error?: string }
export type GraphState = Record<string, NodeResult>;
const terminal = (status: NodeStatus) => !['pending', 'running'].includes(status);

// Existing file journeys are honest opaque nodes. Only reviewed, dispatched cases can split them.
export function executionPlan(selected: Scenario[], workers: number, timing: string, costs = new Map<string, number>()): ExecutionPlan {
  const nodes: GraphNode[] = [];
  const add = (node: Omit<GraphNode, 'estimatedMs'>) => nodes.push({ ...node, estimatedMs: costs.get(node.id) ?? null });
  const needs = (id: string, reason: string) => ({ id, when: 'passed' as const, reason });
  add({ id: 'types', kind: 'check', label: 'Types and Svelte contracts', requires: [], slots: workers, scenarios: [], command: ['typecheck'] });
  if (selected.some(s => s.suite !== 'boundary')) add({ id: 'build', kind: 'prepare', label: 'Shared isolated build', requires: [needs('types', 'Valid source contracts')], slots: workers, scenarios: [], command: ['build', '$BUILD'] });
  const units = new Map<string, Scenario[]>();
  for (const item of selected) {
    const key = item.suite === 'boundary' ? 'boundary' : `${item.suite}:${item.file}`;
    const items = units.get(key) ?? [];items.push(item);units.set(key, items);
  }
  for (const [key, items] of units) {
    const suite = items[0].suite;
    // Run an existing file journey once when several of its groups are selected.
    // This combines executors without adding scenarios to the selected scope.
    const id = suite === 'workflow' ? `workflow:${[...new Set(items.map(s => s.group))].sort().join('+')}` : key;
    const exclusive = suite === 'boundary' || items.some(s => testGroups.find(g => g.id === s.group)?.exclusive);
    const command = [`test:${suite}`];
    if (suite !== 'boundary') command.push(items[0].file);
    if (suite === 'desktop') {
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      command.push('--grep', `(?:^|\\s)(?:${items.map(s => escape(s.id)).join('|')})(?::|$)`);
    }
    add({ id, kind: 'check', label: items.map(s => testGroups.find(g => g.id === s.group)?.purpose ?? s.group).filter((v, i, a) => a.indexOf(v) === i).join(', '),
      requires: [needs(suite === 'boundary' ? 'types' : 'build', suite === 'boundary' ? 'Valid source contracts' : 'Compiled application')],
      slots: exclusive ? workers : 1, scenarios: items.map(s => s.id), command,
      adapter: suite === 'boundary' ? 'boundary-suite' : suite === 'desktop' ? 'playwright-batch' : items.length === 1 ? 'node-case' : 'legacy-bundle',
      ...(suite === 'boundary' ? {} : { environment: { ownership: 'adapter' as const, isolation: 'fresh-instance' as const, presets: [...new Set(items.flatMap(s => s.preset ? [s.preset.name] : []))] } }),
    });
  }
  add({ id: 'cleanup', kind: 'cleanup', label: 'Recover owned resources', requires: nodes.map(n => ({ id: n.id, when: 'settled', reason: 'Finalize after all consumers, including failure and cancellation' })), slots: workers, scenarios: [] });
  const plan: ExecutionPlan = { version: 1, workers, nodes, selected: selected.map(s => s.id), timing };
  validatePlan(plan);
  return plan;
}

export function validatePlan(plan: ExecutionPlan) {
  validateWorkerCount(plan.workers);
  const byId = new Map<string, GraphNode>();
  const checks = new Set<string>();
  for (const node of plan.nodes) {
    if (byId.has(node.id)) throw new Error(`Duplicate graph node: ${node.id}`);
    if (!Number.isInteger(node.slots) || node.slots < 1 || node.slots > plan.workers) throw new Error(`Invalid resource claim: ${node.id}`);
    if (node.estimatedMs !== null && (!Number.isFinite(node.estimatedMs) || node.estimatedMs < 0)) throw new Error(`Invalid duration: ${node.id}`);
    if (node.kind !== 'cleanup' && node.requires.some(d => d.when !== 'passed')) throw new Error(`Only cleanup can depend on settled work: ${node.id}`);
    for (const id of node.scenarios) {
      if (checks.has(id) || !scenarios.some(s => s.id === id)) throw new Error(`Duplicate or unknown graph scenario: ${id}`);
      checks.add(id);
    }
    byId.set(node.id, node);
  }
  if (checks.size !== plan.selected.length || plan.selected.some(id => !checks.has(id))) throw new Error('Graph does not account for selected scenarios');
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Graph dependency cycle: ${id}`);
    if (done.has(id)) return;
    const node = byId.get(id);if (!node) throw new Error(`Missing graph prerequisite: ${id}`);
    visiting.add(id);for (const dependency of node.requires) visit(dependency.id);visiting.delete(id);done.add(id);
  };
  for (const node of plan.nodes) visit(node.id);
}

function priorities(plan: ExecutionPlan) {
  const scores = new Map<string, number>();
  const score = (id: string): number => {
    if (scores.has(id)) return scores.get(id)!;
    const node = plan.nodes.find(n => n.id === id)!;
    const value = (node.estimatedMs ?? (node.kind === 'cleanup' ? 0 : 30_000)) + Math.max(0, ...plan.nodes.filter(n => n.requires.some(d => d.id === id)).map(n => score(n.id)));
    scores.set(id, value);return value;
  };
  for (const node of plan.nodes) score(node.id);
  return (a: GraphNode, b: GraphNode) => score(b.id) - score(a.id) || a.id.localeCompare(b.id, 'en');
}

export function graphPreview(plan: ExecutionPlan, state: GraphState = {}, now = Date.now()) {
  const sort = priorities(plan), remaining = plan.nodes.filter(n => !state[n.id] || !terminal(state[n.id].status));
  const unknown = remaining.filter(n => n.estimatedMs === null).map(n => n.id);
  const finished = new Set(plan.nodes.filter(n => state[n.id] && terminal(state[n.id].status)).map(n => n.id));
  const active = remaining.filter(n => state[n.id]?.status === 'running').map(n => ({ node: n, end: Math.max(1, (n.estimatedMs ?? 30_000) - (now - state[n.id].startedAt!)) }));
  const pending = remaining.filter(n => state[n.id]?.status !== 'running');
  const timeline: Array<{ id: string; startMs: number; endMs: number; estimated: boolean }> = active.map(a => ({ id: a.node.id, startMs: 0, endMs: a.end, estimated: a.node.estimatedMs !== null }));
  let at = 0;
  while (pending.length || active.length) {
    let slots = plan.workers - active.reduce((n, a) => n + a.node.slots, 0);
    const ready = pending.filter(n => n.requires.every(d => finished.has(d.id))).sort(sort);
    for (const node of ready) if (node.slots <= slots) {
      const end = at + (node.estimatedMs ?? (node.kind === 'cleanup' ? 0 : 30_000));
      active.push({ node, end });pending.splice(pending.indexOf(node), 1);slots -= node.slots;
      timeline.push({ id: node.id, startMs: at, endMs: end, estimated: node.estimatedMs !== null });
    }
    if (!active.length) throw new Error('Graph projection cannot make progress');
    at = Math.min(...active.map(a => a.end));
    for (const item of active.filter(a => a.end <= at)) { finished.add(item.node.id);active.splice(active.indexOf(item), 1); }
  }
  return { estimatedMs: unknown.length ? null : at, unknown, timeline, note: 'Historical estimates; host load and execution order may differ. Unknown nodes use a scheduling hint, not a promised duration.' };
}

export async function runGraph(plan: ExecutionPlan, execute: (node: GraphNode) => Promise<void>, signal: AbortSignal,
  changed: (state: GraphState, node: GraphNode) => Promise<void> | void = () => {}) {
  validatePlan(plan);
  const state: GraphState = Object.fromEntries(plan.nodes.map(n => [n.id, { status: 'pending' }]));
  const active = new Map<string, Promise<void>>(), sort = priorities(plan);
  let observationError: Error | undefined;
  const notify = async (node: GraphNode) => { try { await changed(state, node); } catch (error) { observationError = error instanceof Error ? error : new Error(String(error)); } };
  while (Object.values(state).some(s => !terminal(s.status))) {
    let advanced = false;
    for (const node of plan.nodes.filter(n => state[n.id].status === 'pending' && n.kind !== 'cleanup')) {
      const failed = node.requires.find(d => terminal(state[d.id].status) && state[d.id].status !== 'passed');
      if (signal.aborted || observationError || failed) {
        state[node.id] = { status: signal.aborted ? 'cancelled' : 'blocked', error: signal.aborted ? 'Verification interrupted' : observationError ? 'Progress recording failed' : `Prerequisite ${failed!.id} did not pass` };
        advanced = true;
        await notify(node);
      }
    }
    let slots = plan.workers - plan.nodes.filter(n => state[n.id].status === 'running').reduce((n, a) => n + a.slots, 0);
    const ready = plan.nodes.filter(n => state[n.id].status === 'pending' && n.requires.every(d => d.when === 'settled' ? terminal(state[d.id].status) : state[d.id].status === 'passed')).sort(sort);
    for (const node of ready) if (node.slots <= slots && (!signal.aborted || node.kind === 'cleanup')) {
      slots -= node.slots;state[node.id] = { status: 'running', startedAt: Date.now() };
      await notify(node);
      const work = (async () => {
        try {
          if ((signal.aborted || observationError) && node.kind !== 'cleanup') throw new Error('Interrupted before execution');
          await execute(node);state[node.id].status = 'passed';
        } catch (error) { state[node.id].status = signal.aborted && node.kind !== 'cleanup' ? 'cancelled' : 'failed';state[node.id].error = String(error); }
        state[node.id].finishedAt = Date.now();state[node.id].durationMs = state[node.id].finishedAt! - state[node.id].startedAt!;
        await notify(node);
      })().finally(() => { active.delete(node.id); });
      active.set(node.id, work);
    }
    if (active.size) await Promise.race(active.values());
    else if (Object.values(state).some(s => !terminal(s.status)) && !advanced) throw new Error('Graph scheduler cannot make progress');
  }
  await Promise.all(active.values());
  if (observationError) throw new Error(`Graph progress recording failed: ${observationError}`);
  return state;
}

export function timingCosts(report: any, plan: ExecutionPlan) {
  if (report?.version !== 2 || report.passed !== true || report.sourceValid !== true) throw new Error('Timing reference requires a passing verification report');
  if (report.timing !== plan.timing || report.environment?.platform !== process.platform || report.environment?.arch !== process.arch) throw new Error('Timing reference platform/architecture/timing profile does not match');
  const costs = new Map<string, number>();
  for (const node of plan.nodes) {
    const previous = report.graph?.plan?.nodes?.find((n: GraphNode) => n.id === node.id);
    const result = report.graph?.state?.[node.id];
    if (previous && result?.status === 'passed' && Number.isFinite(result.durationMs) && JSON.stringify([...previous.scenarios].sort()) === JSON.stringify([...node.scenarios].sort())) costs.set(node.id, result.durationMs);
    else if (node.id === 'boundary') continue; // Only an exact dispatched scope supplies a boundary duration.
    else if (node.id === 'types' || node.id === 'build') {
      const prefix = `pnpm ${node.id === 'types' ? 'typecheck' : 'build'}`;
      const command = report.commands?.find((c: any) => c.status === 'passed' && (c.command === prefix || c.command.startsWith(prefix + ' ')));
      if (Number.isFinite(command?.durationMs)) costs.set(node.id, command.durationMs);
    } else if (node.scenarios.length && report.scenarios && report.events) {
      const items = node.scenarios.map(id => report.scenarios.find((s: any) => s.id === id));
      if (items.some((s: any) => !s || s.status !== 'passed')) continue;
      const bodies = items.reduce((n: number, s: any) => n + s.attempts.reduce((m: number, a: any) => m + a.durationMs, 0), 0);
      if (node.id.startsWith('desktop:')) { costs.set(node.id,bodies);continue; }
      const processes = new Set(report.events.filter((e: any) => e.kind === 'scenario' && node.scenarios.includes(e.name)).map((e: any) => e.processId));
      if (processes.size === 1) {
        const events = report.events.filter((e: any) => processes.has(e.processId));
        const allBodies = events.filter((e: any) => e.kind === 'scenario' && e.status !== 'started').reduce((n: number, e: any) => n + (e.durationMs ?? 0), 0);
        const preparation = Math.max(0, Math.max(...events.map((e: any) => e.at)) - Math.min(...events.map((e: any) => e.at)) - allBodies);
        costs.set(node.id, bodies + preparation);
      }
    }
  }
  return costs;
}
