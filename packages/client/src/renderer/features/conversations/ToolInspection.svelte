<script lang="ts">
  import type { ArtifactView, RunView } from '@ash/shared';
  let {run,artifacts,selectedId='',onInspect}:{run:RunView;artifacts:ArtifactView[];selectedId?:string;onInspect:(id:string)=>void}=$props();
  const selectedRequestId=$derived(run.state.tools?.calls.find(call=>call.callArtifactId===selectedId||call.resultArtifactId===selectedId)?.requestId
    ??run.state.tools?.rounds.find(round=>round.requestId===selectedId||round.outputId===selectedId)?.requestId
    ??run.state.tools?.rounds.at(-1)?.requestId);
</script>
{#if run.state.tools}
  <section aria-label="Execution steps">
    <h3>Execution steps</h3>
    {#each run.state.tools.rounds as round,index (round.requestId)}
      {@const request=artifacts.find(artifact=>artifact.id===round.requestId)?.payload}
      <details open={round.requestId===selectedRequestId}>
        <summary>Model call {index+1} · {round.status}</summary>
        <button onclick={()=>onInspect(round.requestId)}>Inspect captured request</button>
        {#if request?.type==='model_request'&&request.tools}<details><summary>Supplied tools, scope and continuation results</summary><pre>{JSON.stringify(request.tools,null,2)}</pre></details>{/if}
        {#if round.outputId}<button onclick={()=>onInspect(round.outputId!)}>Inspect output</button>{/if}
        {#if round.model}<pre>{JSON.stringify(round.model,null,2)}</pre>{/if}
        {#each run.state.tools.calls.filter(call=>call.requestId===round.requestId) as call (call.id)}
          <details open={call.callArtifactId===selectedId||call.resultArtifactId===selectedId}><summary>{call.call.name} · {call.status}</summary>
            <p>Call {call.call.callId}</p><pre>{call.call.arguments}</pre>
            <p>Started: {call.startedAt??'Not started'}<br>Ended: {call.endedAt??'Not settled'}</p>
            <details><summary>Access checks</summary><pre>{JSON.stringify({action:call.action,authorization:call.authorization,checks:call.checks},null,2)}</pre></details>
            {#if call.resultArtifactId}
              {@const payload=artifacts.find(artifact=>artifact.id===call.resultArtifactId)?.payload}
              {#if payload?.type==='tool_result'}
                {#each payload.result.content as content}{#if content.type==='text'}<pre>{content.text}</pre>{:else}<pre>{JSON.stringify(content,null,2)}</pre>{/if}{/each}
                {#if payload.result.status!=='success'}<p>{payload.result.error.code}: {payload.result.error.message}</p>{/if}
                {#each payload.result.omissions as omission}<p>{omission}</p>{/each}
                {#each payload.result.references as ref}<details><summary>{ref.label}</summary><pre>{JSON.stringify(ref,null,2)}</pre></details>{/each}
              {/if}
              <button onclick={()=>onInspect(call.resultArtifactId!)}>Inspect saved result</button>
            {/if}
          </details>
        {/each}
      </details>
    {/each}
  </section>
{/if}
<style>
  section{border-top:1px solid #dbe2d1;padding-top:18px;margin-top:20px}h3{font-size:12px;color:#596b4d}details{margin-top:10px}summary{cursor:pointer;overflow-wrap:anywhere}button{display:block;border:0;background:transparent;color:var(--accent);font-size:11px;padding:5px 0;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.6 ui-monospace,monospace;max-height:420px;overflow:auto}p{overflow-wrap:anywhere}
</style>
