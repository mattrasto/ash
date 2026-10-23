<script module lang="ts">
  // A trace moves from the pending input to its answer when the Run completes.
  const expansion = new Map<string, boolean>();
</script>
<script lang="ts">
  import Icon from '../../ui/Icon.svelte';
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
    <button class="ash-button summary" aria-expanded={open} onclick={()=>setExpanded(!open)}>
      {open?'▾':'▸'} {isActive(run.status)?'Working':'Work recorded'} · {workflow.rounds.length} model {workflow.rounds.length===1?'call':'calls'} · {workflow.calls.length} tool {workflow.calls.length===1?'call':'calls'}
    </button>
    {#each workflow.availabilityIssues ?? [] as issue}<p class="issue"><Icon name="warning" size={14}/> {issue.message}</p>{/each}
    {#if open}
      {#each workflow.rounds as round (round.requestId)}
        <div class="round"><button onclick={()=>onInspect(round.requestId)} class="ash-button">Model call {workflow.rounds.indexOf(round)+1} · {round.status}</button>
          {#if round.commentary && (round.status!=='completed'||workflow.calls.some(call=>call.requestId===round.requestId))}<p class="commentary"><small>Commentary</small>{round.commentary}</p>{/if}
          {#each workflow.calls.filter(call=>call.requestId===round.requestId) as call (call.id)}
            <button class="ash-button call"  onclick={()=>onInspect(call.resultArtifactId??call.callArtifactId)}>
              <span><strong>{call.call.name}</strong> · <span class:ash-danger={call.status==='error'} class:ash-warning={call.status==='unknown'}>{#if call.status==='error'||call.status==='unknown'}<Icon name={call.status==='error'?'danger':'warning'} size={14}/>{/if}{call.status}</span></span>
              {#if call.action?.resources[0]}<span class="target">{call.action.resources[0].label}</span>{/if}
              {#if call.startedAt&&call.endedAt}<small>{((Date.parse(call.endedAt)-Date.parse(call.startedAt))/1000).toFixed(2)}s</small>{/if}
            </button>
          {/each}
        </div>
      {/each}
    {:else if workflow.calls.some(call=>['error','denied','unknown','interrupted'].includes(call.status))}
      <button class="ash-button issue" onclick={()=>setExpanded(true)}>Some calls need attention · Show details</button>
    {/if}
  </section>
{/if}
<style>
  .tool-trace{border:1px solid var(--divider);border-radius:8px;margin:8px 0 12px;padding:8px;min-width:0;font-size:.8rem;color:var(--text);background:color-mix(in srgb,var(--control) 35%,transparent)}.tool-trace button{border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;max-width:100%;overflow-wrap:anywhere}.summary{width:100%;padding:3px}.round{border-top:1px solid var(--divider);margin-top:8px;padding:8px 2px}.call{display:flex;flex-direction:column;gap:3px;width:100%;padding:8px!important;border-radius:5px!important}.target{font-family:ui-monospace,monospace;font-size:.8rem;overflow-wrap:anywhere}.commentary{white-space:pre-wrap;max-height:140px;overflow:auto;line-height:1.5}.commentary small{display:block;color:var(--muted);margin-bottom:4px}.issue{color:var(--warning)!important}strong{font-weight:525}
</style>
