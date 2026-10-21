<script lang="ts">
  import { policyText, permissionForReview } from '@ash/shared';
  import type { DecisionView, RunView, SavePermission, ToolJson } from '@ash/shared';
  type Api = <T>(path: string, body?: object) => Promise<T>;
  let { decision, api, onChanged, onThread, onRule, runs = [] }: {
    decision: DecisionView; api: Api; onChanged: () => Promise<void>;
    onThread?: (id: string) => void; onRule?: (rule: SavePermission) => void; runs?: RunView[];
  } = $props();
  const controlId = $props.id();
  let text = $state(''), comment = $state(''), busy = $state(false), error = $state(''), custom = $state(''), showSnooze = $state(false);
  let submission = $state<{ id: string; value: unknown; comment: string } | null>(null);
  const open = $derived(['pending', 'snoozed'].includes(decision.status));
  const work = $derived(runs.length ? runs.filter(run => run.state.decisions?.some(d => d.decisionId === decision.id)) : decision.work ?? []);
  const workStatus = (run: RunView | { status: string }) => {
    if ('state' in run && decision.request.kind === 'permission') {
      const dependency = run.state.decisions?.find(d => d.decisionId === decision.id), call = run.state.tools?.calls.find(c => c.id === dependency?.stepKey);
      if (call?.status === 'denied') return 'blocked'; if (call?.status === 'error') return 'failed';
      if (call?.status === 'unknown') return 'outcome unknown'; if (call?.status === 'completed') return 'completed';
    }
    return run.status;
  };
  const savedLabel = $derived.by(() => {
    const answer = decision.resolution?.kind === 'answer' ? decision.resolution.value : null;
    if (answer && typeof answer === 'object' && 'skipped' in answer) return 'Skipped';
    if (typeof answer !== 'string') return JSON.stringify(answer);
    if (decision.request.kind === 'permission') return ({ approve: 'Approved for this action', decline: 'Declined', exception: 'Exception granted for this action', 'not-applicable': 'Concern does not apply' } as Record<string, string>)[answer] ?? answer;
    return decision.request.options.find(option => option.id === answer)?.label ?? answer;
  });
  const names: Record<string, string> = { 'filesystem.read': 'Read file', 'filesystem.list': 'List folder', 'filesystem.glob': 'Find files', 'filesystem.search': 'Search file contents', startLine: 'Starting line', maxLines: 'Maximum lines', maxResults: 'Maximum results' };
  const label = (key: string) => names[key] ?? (key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').replace(/^./, c => c.toUpperCase()));
  const operation = $derived(decision.request.action?.operation ?? '');
  const actionTitle = $derived(names[operation] ?? label(operation.split('.').at(-1) ?? operation));
  const effectNames: Record<string, string> = { read: 'Read data', write: 'Change data', delete: 'Delete data', send: 'Send messages', publish: 'Publish public content', control: 'Control computer' };
  const consequences = $derived((decision.request.action?.effects ?? [])
    .filter(effect => effect !== (names[operation] ? 'read' : operation.split('.').at(-1)))
    .map(effect => effectNames[effect] ?? label(effect)));
  function display(value: ToolJson): string {
    if (value === null) return 'None';
    if (Array.isArray(value)) return value.map(display).join('\n');
    if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${label(key)}: ${display(item)}`).join('\n');
    return String(value);
  }
  const actionDetails = $derived.by(() => {
    const args = decision.request.arguments;
    const entries: [string, ToolJson][] = args && typeof args === 'object' && !Array.isArray(args) ? Object.entries(args) : args === undefined ? [] : [['Details', args]];
    for (const entry of Object.entries(decision.request.action?.facts ?? {})) if (!entries.some(([key, value]) => key === entry[0] && JSON.stringify(value) === JSON.stringify(entry[1]))) entries.push(entry);
    return entries.filter(([key, value]) => !(['path', 'resourceId', 'appId', 'recipient'].includes(key)
      && decision.request.action?.resources.some(resource => value === resource.id || value === resource.label)));
  });
  async function answer(value: unknown) {
    if (busy) return; busy = true; error = '';
    // Retry the same response with its original ID; a different choice is a new submission.
    if (!submission || JSON.stringify(submission.value) !== JSON.stringify(value) || submission.comment !== comment) submission = { id: crypto.randomUUID(), value, comment };
    try { await api(`decisions/${decision.id}/answer`, { submissionId: submission.id, value: submission.value, ...(submission.comment ? { comment: submission.comment } : {}) }); await onChanged(); submission = null; }
    catch (e) { error = (e as Error).message; } finally { busy = false; }
  }
  async function snooze(until: string | null) {
    busy = true; error = '';
    try { await api(`decisions/${decision.id}/snooze`, { until }); showSnooze = false; await onChanged(); }
    catch (e) { error = (e as Error).message; } finally { busy = false; }
  }
  async function stopWork(id: string) {
    busy = true; error = '';
    try { await api(`runs/${id}/cancel`, {}); await onChanged(); } catch (e) { error = (e as Error).message; } finally { busy = false; }
  }
  async function cancel() {
    busy = true; error = '';
    try { await api(`decisions/${decision.id}/cancel`, {}); await onChanged(); } catch (e) { error = (e as Error).message; } finally { busy = false; }
  }
</script>

<article class="decision-card" data-testid="decision-card">
  <div class="meta"><span>{decision.request.kind === 'permission' ? 'Permission request' : 'Question'}</span><time datetime={decision.createdAt} title={new Date(decision.createdAt).toLocaleString()}>{new Date(decision.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>
  <h3>{decision.request.question}</h3><p class="reason">{decision.request.reason}</p>
  {#if decision.request.action}
    <section class="action" aria-label="Action to approve"><h4>{actionTitle}</h4>
      {#each decision.request.action.resources as resource}<p class="target">{resource.label || resource.id}{#if resource.label && resource.id !== resource.label}<span>{resource.id}</span>{/if}</p>{/each}
      {#if actionDetails.length || consequences.length}<dl>{#each actionDetails as [key, value]}<div><dt>{label(key)}</dt><dd>{display(value)}</dd></div>{/each}{#if consequences.length}<div><dt>Also</dt><dd>{consequences.join(', ')}</dd></div>{/if}</dl>{/if}
    </section>
  {/if}
  {#if decision.dueAt}<p class="due">Due {new Date(decision.dueAt).toLocaleString()}</p>{/if}
  {#if open}
    {#if decision.request.proposal && onRule}<details class="proposal"><summary>Suggested permission</summary><p>{policyText(decision.request.proposal.policy)}</p><button disabled={busy} onclick={() => onRule!(permissionForReview(decision.request.proposal!))}>Review permission</button></details>{/if}
    <form onsubmit={event => { event.preventDefault(); void answer(text); }}>
      {#if decision.request.form === 'text'}<label for={`answer-${controlId}`}>Answer</label><textarea id={`answer-${controlId}`} bind:value={text} maxlength="4000" disabled={busy}></textarea>{/if}
      <details class="comment"><summary>Add comment</summary><label for={`comment-${controlId}`} class="sr-only">Optional comment</label><textarea id={`comment-${controlId}`} bind:value={comment} maxlength="4000" disabled={busy}></textarea></details>
      <div class="choices">
        {#if decision.request.form === 'text'}<button class="primary" disabled={busy || !text.trim()}>Submit answer</button>
        {:else}{#each decision.request.options as option}<button type="button" class:primary={decision.request.kind === 'permission' && ['approve', 'exception'].includes(option.id)} disabled={busy} onclick={() => answer(option.id)}>{option.label}</button>{/each}{/if}
      </div>
    </form>
  {:else if decision.resolution?.kind === 'answer'}<div class="answer"><strong>{savedLabel}</strong>{#if decision.resolution.comment}<p>{decision.resolution.comment}</p>{/if}</div>
  {:else if decision.resolution?.kind === 'cancellation'}<p class="answer">Cancelled: {decision.resolution.reason}</p>{/if}
  <div class="footer">
    <div class="work">{#each work as run}<span>Work: {workStatus(run)}</span>{#if run.status === 'waiting'}<button class="quiet" disabled={busy} onclick={() => stopWork(run.id)}>Stop work</button>{/if}{/each}</div>
    <div class="secondary">
      {#if decision.threadId && onThread}<button class="quiet" onclick={() => onThread!(decision.threadId!)}>Open Thread</button>{/if}
      {#if open}
        {#if decision.status === 'snoozed'}<span class="until">Until {new Date(decision.snoozedUntil!).toLocaleString()}</span><button class="quiet" disabled={busy} onclick={() => snooze(null)}>Wake now</button>{/if}
        <button class="quiet" aria-expanded={showSnooze} disabled={busy} onclick={() => showSnooze = !showSnooze}>Snooze…</button>
        <button class="quiet" disabled={busy} onclick={decision.request.kind === 'question' ? () => answer({ skipped: true }) : cancel}>{decision.request.kind === 'question' ? 'Skip' : 'Cancel request'}</button>
      {/if}
    </div>
  </div>
  {#if open && showSnooze}<div class="snooze" role="group" aria-label="Snooze decision">
    <div><button disabled={busy} onclick={() => snooze(new Date(Date.now() + 3600000).toISOString())}>Snooze 1 hour</button><button disabled={busy} onclick={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); void snooze(tomorrow.toISOString()); }}>Tomorrow</button></div>
    <div><label for={`snooze-${controlId}`}>Custom time</label><input id={`snooze-${controlId}`} type="datetime-local" bind:value={custom} disabled={busy}/><button disabled={busy || !custom || new Date(custom).getTime() <= Date.now()} onclick={() => snooze(new Date(custom).toISOString())}>Set time</button></div>
  </div>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</article>

<style>
  .decision-card{border-bottom:1px solid #d6dfcc;padding:20px 0 24px;color:#495741;font-size:13px;overflow-wrap:anywhere}h3{font-size:17px;line-height:1.5;margin:10px 0 6px;font-weight:500}p{line-height:1.6}.reason{color:#65745b;margin:0 0 18px}.meta{display:flex;justify-content:space-between;gap:8px;color:#65745b;font-size:11px}.action{border-left:2px solid #c3d1b8;padding:2px 0 2px 14px;margin:18px 0}h4{font-size:12px;margin:0 0 8px;font-weight:600}.target{margin:6px 0;white-space:pre-wrap}.target span{display:block;color:#65745b;font-size:11px}dl{font-size:12px;margin:12px 0 0}dl div{display:flex;gap:18px;margin:6px 0}dt{min-width:110px;color:#65745b}dd{margin:0;white-space:pre-wrap}.answer{margin:18px 0}.answer strong{font-weight:500}.answer p{margin:6px 0;color:#65745b}
  button{border:1px solid #c7d1be;background:#f6f8ef;color:#495741;border-radius:5px;padding:8px 11px;font:inherit;font-size:12px;cursor:pointer}button:hover{background:#e6ecdf}button:disabled{opacity:.5;cursor:default}.primary{background:#536f43;color:white;border-color:#536f43}.primary:hover{background:#425d32}.quiet{border:0;background:transparent;padding:6px 0}.choices{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.comment,.proposal{font-size:12px;color:#65745b;margin:12px 0}summary{cursor:pointer;min-height:24px;line-height:24px}.comment textarea{min-height:60px}label{font-size:12px}textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #c7d1be;border-radius:5px;background:#fffefa;min-height:80px;padding:10px;font:inherit;margin:8px 0;resize:vertical}
  .footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.work,.secondary{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:11px;color:#65745b}.work:empty{display:none}.snooze{border-top:1px solid #dfe5d6;padding-top:16px;margin-top:16px}.snooze div{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.due,.until{font-size:11px;color:#65745b}input{font:inherit;padding:7px;border:1px solid #c7d1be;border-radius:5px;background:#fffefa;color:inherit;max-width:190px}[role=alert]{color:#963d30}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
</style>
