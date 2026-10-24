import { graphPreview, type ExecutionPlan, type GraphState } from './graph.ts';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const seconds = (value: number | null | undefined) => value == null ? 'Unknown' : `${(value / 1000).toFixed(1)}s`;

export function graphReport(plan: ExecutionPlan, state: GraphState, startedAt: number, environments: string[], scope: 'full' | 'partial', passed?: boolean, now = Date.now()) {
  const preview = graphPreview(plan, state, now);
  const elapsed = Math.max(1, now - startedAt);
  const live = plan.nodes.some(n => !state[n.id] || ['pending','running'].includes(state[n.id].status));
  const prefix = scope === 'full' ? 'Full verification' : 'Partial verification';
  const title = passed === undefined ? live ? `${prefix} in progress` : `${prefix}: execution finished; validating evidence` : `${prefix} ${passed ? 'passed' : 'failed'}`;
  const rows = plan.nodes.map(node => {
    const result = state[node.id], status = result?.status ?? 'pending';
    const start = result?.startedAt === undefined ? undefined : Math.max(0, result.startedAt - startedAt);
    const duration = start === undefined ? undefined : (result?.finishedAt ?? now) - result!.startedAt!;
    const left = start === undefined ? 0 : start / elapsed * 100, width = duration === undefined ? 0 : Math.max(.2, duration / elapsed * 100);
    const dependencies = node.requires.map(d => escape(plan.nodes.find(n => n.id === d.id)!.label)).join('<br>') || '—';
    return `<tr><td><strong>${escape(node.label)}</strong><small>${escape(node.kind)} · ${node.scenarios.length} scenarios${node.environment ? ' · environment owned by adapter' : ''}</small></td>
<td><span class="status ${status}">${status}</span></td><td>${seconds(duration)}</td><td>${seconds(node.estimatedMs)}</td>
<td class="track">${start === undefined ? '' : `<span class="bar ${status}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="Started ${seconds(start)} after invocation"></span>`}</td>
<td class="dependencies">${node.kind === 'cleanup' ? `<details><summary>All ${node.requires.length} prior tasks, after settlement</summary>${dependencies}</details>` : dependencies}${result?.error ? `<small>${escape(result.error)}</small>` : ''}</td></tr>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${live ? '<meta http-equiv="refresh" content="5">' : ''}<title>Ash verification timeline</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#23382b;background:#f8f9f5;margin:36px}h1{font-size:28px;margin:0}p{color:#526156;max-width:90ch}table{width:100%;border-collapse:collapse;background:white}th{text-align:left;color:#526156;font-size:12px;text-transform:uppercase;letter-spacing:.04em}td,th{padding:12px;border-bottom:1px solid #e2e8df;vertical-align:top}small{display:block;color:#6b756e;font-size:12px;margin-top:3px}.track{position:relative;min-width:200px;width:26%;background:linear-gradient(90deg,transparent 49.8%,#e2e8df 50%,transparent 50.2%)}.bar{position:absolute;top:18px;height:13px;border-radius:3px;min-width:2px}.passed{background:#dcebdc;color:#20542e}.bar.passed{background:#5c9368}.failed,.cancelled{background:#f9dfdb;color:#862d25}.bar.failed,.bar.cancelled{background:#bd6259}.running{background:#e3eafd;color:#304e96}.bar.running{background:#7391cc}.pending,.blocked{background:#eceeeb;color:#6b756e}.status{padding:3px 7px;border-radius:4px;font-size:12px}.dependencies{font-size:12px;max-width:240px;overflow-wrap:anywhere}.summary{display:flex;gap:30px;flex-wrap:wrap;margin:20px 0}.summary strong{font-size:21px;display:block}footer{margin-top:20px;color:#6b756e;font-size:12px}</style>
<h1>${title}</h1><p>Selected checks, shared preparation and cleanup use the same execution graph. Bars show actual elapsed work; waiting and blocked tasks remain visible.</p>
<div class="summary"><div><strong>${plan.selected.length}</strong>selected scenarios</div><div><strong>${plan.workers}</strong>worker slots</div><div><strong>${seconds(elapsed)}</strong>elapsed</div><div><strong>${seconds(preview.estimatedMs)}</strong>estimated remaining</div><div><strong>${environments.length}</strong>owned environments awaiting cleanup</div></div>
<table><thead><tr><th>Work</th><th>Status</th><th>Elapsed</th><th>Historical estimate</th><th>Timeline · 0 to ${seconds(elapsed)}</th><th>Prerequisites</th></tr></thead><tbody>${rows}</tbody></table>
<footer>Historical timings are approximate and use one saved passing run when available; variability is not yet modeled. Unknown weights are shown explicitly. Legacy adapters include their own environment preparation and disposal; those costs are not counted twice. ${live ? 'This view refreshes every five seconds.' : ''}</footer></html>`;
}
