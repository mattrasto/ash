<script lang="ts">
  import { isActive,messageText,type ArtifactView,type MessagePayload,type RunView,type AttachmentView } from '@ash/shared';
  import Markdown from './Markdown.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import Gallery from '../images/Gallery.svelte';
  import ToolTrace from './ToolTrace.svelte';
  import { citationResult } from './citations.ts';
  let {artifact,run,outcomes,images,blocked,onInspect,onRetry,onOpen}:{artifact:ArtifactView;run?:RunView;outcomes:RunView[];images:AttachmentView[];blocked:boolean;onInspect:(id:string)=>void;onRetry:(run:RunView)=>void;onOpen:(images:AttachmentView[],index:number)=>void}=$props();
  const payload=$derived(artifact.payload as MessagePayload),text=$derived(messageText(payload));
  const running=$derived(!!run&&isActive(run.status));
  const duration=$derived(run?.startedAt&&run.endedAt?`${((Date.parse(run.endedAt)-Date.parse(run.startedAt))/1000).toFixed(1)}s`:null);
  let feedback=$state(''),details=$state(false),menu=$state<{x:number;y:number}|null>(null);
  async function copy(){try{await window.ashMedia.copyText(text);feedback='Copied';}catch{feedback='Could not copy';}}
  function context(event:MouseEvent){if((event.target as HTMLElement).closest('button,a')||window.getSelection()?.toString())return;event.preventDefault();menu={x:event.clientX,y:event.clientY};}
</script>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class:user={payload.speaker==='user'} class:running data-testid="message" data-artifact-id={artifact.id} aria-label={payload.speaker==='user'?'User message':'Ash response'} oncontextmenu={context}>
  {#if images.length}<Gallery {images} {onOpen}/>{/if}
  {#if run?.state.tools}<ToolTrace {run} {onInspect}/>{/if}
  <div class="message-content" class:formatted={payload.speaker==='ash'}>{#if payload.speaker==='ash'}<Markdown {text} streaming={running} onSource={reference=>{const result=citationResult(run?.state.tools?.calls ?? [],reference);if(result){onInspect(result);return true;}return false;}}/>{#if !text}<span class:waiting={running}>{running?'●':run?.status==='completed'?'(Empty response)':''}</span>{/if}{:else}{text}{/if}</div>
  <div class="message-footer">
    {#if run}<span class="status" class:quiet={run.status==='completed'} data-testid="run-status">{run.status==='running'?'running':run.status}</span>{/if}
    {#if run&&!running}<button class="metadata" aria-expanded={details} aria-label="Response details" onclick={()=>details=!details}>{run.state.model?.model??'Response'}{#if duration} · {duration}{/if}{#if run.state.model?.usage} · {run.state.model.usage.inputTokens} → {run.state.model.usage.outputTokens} tok{/if}</button>{/if}
    <div class="actions"><span class="feedback" role="status">{feedback}</span><button class="icon" data-tooltip={images.length?'Copy text':'Copy message'} aria-label={images.length?'Copy text':'Copy message'} disabled={!text} onclick={copy}><Icon name="copy" size={15}/></button><button class="icon" data-tooltip="Inspect Artifact" aria-label={`Inspect ${payload.speaker==='user'?'user message':'Ash response'}`} onclick={()=>onInspect(artifact.id)}><Icon name="inspect" size={15}/></button>{#if run&&!running}<button class="icon" data-tooltip="Retry response" aria-label="Retry response" disabled={blocked} onclick={()=>onRetry(run!)}><Icon name="retry" size={15}/></button>{/if}</div>
  </div>
  {#if details&&run}<div class="details"><span>{new Date(artifact.createdAt).toLocaleString()}</span><span>Outcome: {run.status}</span>{#if run.state.model?.usage}<span>{run.state.model.usage.cachedInputTokens} cached input · {run.state.model.usage.reasoningTokens} reasoning tokens</span>{/if}<button onclick={()=>onInspect(artifact.id)}>View captured context and Artifact chain</button></div>{/if}
  {#if run?.error}<p class="failure">{run.error.message}</p>{/if}
  {#each outcomes as outcome (outcome.id)}{#if outcome.state.tools}<ToolTrace run={outcome} {onInspect}/>{/if}<div class="outcome"><span class:waiting={isActive(outcome.status)} data-testid="run-status">{outcome.status}</span>{#if outcome.error}<span>{outcome.error.message}</span>{/if}{#if !isActive(outcome.status)}<button disabled={blocked} onclick={()=>onRetry(outcome)}>Retry response</button>{/if}<button onclick={()=>onInspect(outcome.state.request_artifact_id)}>Inspect Run</button></div>{/each}
</article>
{#if menu}<Menu x={menu.x} y={menu.y} onClose={()=>menu=null} items={[{label:images.length?'Copy text':'Copy message',action:()=>void copy(),disabled:!text},{label:'Inspect Artifact',action:()=>onInspect(artifact.id)},...(run&&!running?[{label:'Retry response',action:()=>onRetry(run!),disabled:blocked}]:[])]}/>{/if}
<style>
  article{position:relative;padding:18px 20px 8px;margin:16px 0 24px;border:1px solid #e0e5d9;border-radius:12px;background:#fffefa;animation:enter .2s ease-out}.user{background:#eef1e8;border-color:#e3e7db;max-width:90%;width:fit-content;min-width:160px;margin-left:auto}.message-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font-size:14px}.formatted{white-space:normal}.message-footer{display:flex;align-items:center;gap:8px;min-height:27px;margin-top:5px}.actions{display:flex;align-items:center;margin-left:auto;opacity:0;transition:opacity .12s}article:hover .actions,article:focus-within .actions{opacity:1}.icon{display:inline-flex;border:0;background:transparent;color:#809072;border-radius:4px;padding:5px}.icon:hover{background:#e6ebdf}.status{font-size:10px;color:#8c795f}.status.quiet{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.metadata{border:0;background:transparent;color:#86917e;font-size:10px;padding:3px 0;text-align:left}.metadata:hover{color:var(--accent)}.details{display:flex;flex-direction:column;gap:6px;border-top:1px solid #e2e6db;padding:12px 0 5px;color:#7d8c71;font-size:11px;animation:enter .16s ease-out}.details button,.outcome button{border:0;background:transparent;color:var(--accent);font-size:11px;text-align:left;padding:4px 0}.failure,.outcome{font-size:11px;line-height:1.6;color:#986d4c}.outcome{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.feedback{font-size:10px;color:#7d8c71}.waiting{animation:pulse 1.3s infinite;color:#8a9e79}@keyframes pulse{50%{opacity:.3}}@keyframes enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){article,.details,.waiting{animation:none}.actions{transition:none}}@media(hover:none){.actions{opacity:1}}
</style>
