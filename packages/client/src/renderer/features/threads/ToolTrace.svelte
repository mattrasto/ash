<script module lang="ts">
  // A trace moves from the pending input to its answer when the Run completes.
  const expansion = new Map<string, boolean>();
</script>
<script lang="ts">
  import { isActive, type RunView } from '@ash/shared';
  let {run,onInspect}:{run:RunView;onInspect:(id:string)=>void}=$props();
  let expanded=$state<boolean|null>(null);
  const workflow=$derived(run.state.tools);
  const open=$derived(expanded??expansion.get(run.id)??isActive(run.status));
  function setExpanded(value:boolean) {
    expanded=value; expansion.set(run.id,value);
    if(expansion.size>1000) expansion.delete(expansion.keys().next().value!);
  }
</script>
{#if workflow}
  <section class="tool-trace" aria-label="Tool activity">
    <button class="summary" aria-expanded={open} onclick={()=>setExpanded(!open)}>
      {open?'▾':'▸'} {isActive(run.status)?'Working':'Work recorded'} · {workflow.rounds.length} model {workflow.rounds.length===1?'call':'calls'} · {workflow.calls.length} tool {workflow.calls.length===1?'call':'calls'}
    </button>
    {#each workflow.availabilityIssues ?? [] as issue}<p class="issue">{issue.message}</p>{/each}
    {#if open}
      {#each workflow.rounds as round (round.requestId)}
        <div class="round"><button onclick={()=>onInspect(round.requestId)}>Model call {workflow.rounds.indexOf(round)+1} · {round.status}</button>
          {#if round.commentary && (round.status!=='completed'||workflow.calls.some(call=>call.requestId===round.requestId))}<p class="commentary"><small>Commentary</small>{round.commentary}</p>{/if}
          {#each workflow.calls.filter(call=>call.requestId===round.requestId) as call (call.id)}
            <button class="call" class:issue={['error','denied','unknown','interrupted'].includes(call.status)} onclick={()=>onInspect(call.resultArtifactId??call.callArtifactId)}>
              <span><strong>{call.call.name}</strong> · {call.status}</span>
              {#if call.action?.resources[0]}<span class="target">{call.action.resources[0].label}</span>{/if}
              {#if call.startedAt&&call.endedAt}<small>{((Date.parse(call.endedAt)-Date.parse(call.startedAt))/1000).toFixed(2)}s</small>{/if}
            </button>
          {/each}
        </div>
      {/each}
    {:else if workflow.calls.some(call=>['error','denied','unknown','interrupted'].includes(call.status))}
      <button class="issue" onclick={()=>setExpanded(true)}>Some calls need attention · Show details</button>
    {/if}
  </section>
{/if}
<style>
  .tool-trace{border:1px solid #dce3d3;border-radius:8px;margin:8px 0 12px;padding:8px;min-width:0;font-size:11px;color:#65755c;background:#f4f6ef}.tool-trace button{border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;max-width:100%;overflow-wrap:anywhere}.summary{width:100%;padding:3px}.round{border-top:1px solid #e0e6d8;margin-top:8px;padding:8px 2px}.call{display:flex;flex-direction:column;gap:3px;width:100%;padding:8px!important;border-radius:5px!important}.call:hover{background:#e9eee2}.target{font-family:ui-monospace,monospace;font-size:10px;overflow-wrap:anywhere}.commentary{white-space:pre-wrap;max-height:140px;overflow:auto;line-height:1.5}.commentary small{display:block;color:#85917c;margin-bottom:4px}.issue{color:#986d4c!important}strong{font-weight:500}button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
</style>
