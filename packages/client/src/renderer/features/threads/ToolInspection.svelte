<script lang="ts">
  import {VideoFrame,type ArtifactView,type RunView} from '@ash/shared';
  let {run,artifacts,selectedId='',onInspect,onVideo}:{run:RunView;artifacts:ArtifactView[];selectedId?:string;onInspect:(id:string)=>void;onVideo?:(id:string,seconds:number)=>void}=$props();
  const selectedRequestId=$derived(run.state.tools?.calls.find(call=>call.callArtifactId===selectedId||call.resultArtifactId===selectedId)?.requestId
    ??run.state.tools?.rounds.find(round=>round.requestId===selectedId||round.outputId===selectedId)?.requestId
    ??run.state.tools?.rounds.at(-1)?.requestId);
  let expansion=$state<Record<string,boolean>>({});
  let selection='';
  // Refreshes preserve manual choices; selecting another Artifact restores its default expansion.
  $effect(()=>{
    const current=`${run.id}:${selectedId}`;
    if(selection!==current){selection=current;expansion={};}
  });
</script>
{#if run.state.tools}
  <section aria-label="Execution steps">
    <h3>Execution steps</h3>
    {#each run.state.tools.rounds as round,index (round.requestId)}
      {@const request=artifacts.find(artifact=>artifact.id===round.requestId)?.payload}
      <details open={expansion[round.requestId]??round.requestId===selectedRequestId} ontoggle={event=>expansion[round.requestId]=event.currentTarget.open}>
        <summary>{request?.type==='coding_request'?'Coding evidence':'Model call '+(index+1)} · {round.status}</summary>
        <button onclick={()=>onInspect(round.requestId)} class="ash-button">Inspect captured request</button>
        {#if request?.type==='model_request'&&request.tools}<details><summary>Supplied tools, scope and continuation results</summary><pre>{JSON.stringify(request.tools,null,2)}</pre></details>{/if}
        {#if round.outputId}<button onclick={()=>onInspect(round.outputId!)} class="ash-button">Inspect output</button>{/if}
        {#if round.model}<pre>{JSON.stringify(round.model,null,2)}</pre>{/if}
        {#each run.state.tools.calls.filter(call=>call.requestId===round.requestId) as call (call.id)}
          <details open={expansion[call.id]??(call.callArtifactId===selectedId||call.resultArtifactId===selectedId)} ontoggle={event=>expansion[call.id]=event.currentTarget.open}><summary>{call.call.name} · {call.status}</summary>
            <p>Call {call.call.callId}</p><pre>{call.call.arguments}</pre>
            <p>Started: {call.startedAt??'Not started'}<br>Ended: {call.endedAt??'Not settled'}</p>
            <details><summary>Access checks</summary><pre>{JSON.stringify({action:call.action,authorization:call.authorization,checks:call.checks},null,2)}</pre></details>
            {#if call.resultArtifactId}
              {@const payload=artifacts.find(artifact=>artifact.id===call.resultArtifactId)?.payload}
              {#if payload?.type==='tool_result'}
                {#each payload.result.content as content}{#if content.type==='text'}<pre>{content.text}</pre>{:else}<pre>{JSON.stringify(content,null,2)}</pre>{/if}{/each}
                {#if payload.result.status!=='success'}<p>{payload.result.error.code}: {payload.result.error.message}</p>{/if}
                {#each payload.result.omissions as omission}<p>{omission}</p>{/each}
                {#each payload.result.references as ref}<details><summary>{ref.label}</summary>{#if ref.kind==='video-frame'}{@const frame=VideoFrame.safeParse(ref.location.frame)}{#if frame.success}<img src={`/api/attachments/${ref.id}/frame/${call.resultArtifactId}/${frame.data.image.hash}`} alt={ref.label}/>{/if}{/if}{#if (ref.kind==='video'||ref.kind==='video-frame')&&typeof ref.location.attachmentId==='string'&&typeof ref.location.startSeconds==='number'}<button onclick={()=>onVideo?.(ref.location.attachmentId as string,ref.location.startSeconds as number)} class="ash-button">Open video at this moment</button>{/if}<pre>{JSON.stringify(ref,null,2)}</pre></details>{/each}
              {/if}
              <button onclick={()=>onInspect(call.resultArtifactId!)} class="ash-button">Inspect saved result</button>
            {/if}
          </details>
        {/each}
      </details>
    {/each}
  </section>
{/if}
<style>
  img{display:block;max-width:100%;max-height:260px;object-fit:contain;margin:10px auto}
  section{border-top:1px solid var(--divider);padding-top:18px;margin-top:20px}h3{font-size:.9rem;color:var(--text)}details{margin-top:10px}summary{cursor:pointer;overflow-wrap:anywhere}button{display:block;border:0;background:transparent;color:var(--accent);font-size:.8rem;padding:5px 0;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.6 ui-monospace,monospace;max-height:420px;overflow:auto}p{overflow-wrap:anywhere}
</style>
