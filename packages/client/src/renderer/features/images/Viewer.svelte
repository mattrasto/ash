<script lang="ts">
  import {dialogDismiss} from '../../ui/dismiss.ts';
  import {replaceContent} from "../../ui/replacement.ts";
  import {surface,mist} from '../../ui/surface.ts';
  import {scrollArea} from '../../ui/scroll.ts';
  import { onMount, tick, untrack } from 'svelte';
  import { isActive,isVideoAttachment,formatVideoDuration, type AttachmentView } from '@ash/shared';
  import Menu from '../threads/Menu.svelte';
  import Icon from '../threads/Icon.svelte';
  let {images,startIndex=0,startSeconds=0,onClose,onRetry}:{images:AttachmentView[];startIndex?:number;startSeconds?:number;onClose:()=>void;onRetry:(image:AttachmentView)=>Promise<void>}=$props();
  let index=$state(untrack(()=>startIndex)),seekSeconds=$state(untrack(()=>startSeconds));
  let dialog:HTMLDialogElement,strip=$state<HTMLDivElement>();
  let menu=$state<{x:number;y:number}|null>(null);
  let zoom=$state(false),feedback=$state(''),busy=$state(false),broken=$state(false);
  const current=$derived(images[index]);
  let video=$state<HTMLVideoElement>();
  let transcriptOpen=$state(false);
  let mediaFrame:HTMLDivElement;
  function navigate(next:number){void replaceContent(mediaFrame,()=>navigateValue(next),{resize:false});}
  function navigateValue(next:number){video?.pause();seekSeconds=0;transcriptOpen=false;index=Math.max(0,Math.min(images.length-1,next));zoom=false;feedback='';broken=false;}
  function key(event:KeyboardEvent){if(menu||(event.target as HTMLElement).closest('input,textarea,summary,video'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(index+(event.key==='ArrowRight'?1:-1));}}
  async function action(kind:'copy'|'save') {
    if(busy)return;busy=true;feedback=kind==='copy'?'Copying image…':'Opening save dialog…';
    try{const result=await window.ashMedia.imageAction(current.id,kind);feedback=result==='cancelled'?'':kind==='copy'?'Image copied':isVideoAttachment(current)?'Video saved':'Image saved';}
    catch{feedback=kind==='copy'?'Could not copy image.':'Could not save image.';}finally{busy=false;}
  }
  async function copyDescription(){try{await window.ashMedia.copyText(current.summary??'');feedback='Description copied';}catch{feedback='Could not copy description.';}}
  async function copyTranscript(){if(!isVideoAttachment(current))return;try{await window.ashMedia.copyText((current.understanding?.transcript??[]).map(s=>'['+formatVideoDuration(s.start)+'] '+s.text).join('\n'));feedback='Transcript copied';}catch{feedback='Could not copy transcript.';}}
  async function retry(){busy=true;try{await onRetry(current);feedback='Description retry started';}catch(e){feedback=(e as Error).message;}finally{busy=false;}}
  onMount(()=>{const before=document.activeElement as HTMLElement|null;dialog.showModal();return()=>{video?.pause();before?.focus();};});
  $effect(()=>{index;void tick().then(()=>strip?.querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'center'}));});
</script>
<dialog class="viewer" bind:this={dialog} oncancel={(event)=>{event.preventDefault();onClose();}} onkeydown={key} aria-label={`${isVideoAttachment(current)?'Video':'Image'} viewer: ${current.filename}`} use:dialogDismiss={onClose} use:surface={{dense:true}} transition:mist={{role:"large"}}><div class="surface-content">
  <header><div><strong>{current.filename}</strong><span>{index+1} / {images.length} · {current.metadata.original.width} × {current.metadata.original.height}{#if isVideoAttachment(current)} · {formatVideoDuration(current.metadata.durationSeconds)}{/if}</span></div><button class="ash-button ash-ghost ash-icon close ash-close" aria-label={isVideoAttachment(current)?'Close video viewer':'Close image viewer'} data-tooltip="Close" data-tooltip-below onclick={onClose}><Icon name="close"/></button></header>
  <div bind:this={mediaFrame} class="stage" class:zoom>
    {#if broken}<p>The saved attachment is unavailable.</p>{:else if isVideoAttachment(current)}{#key current.id}<!-- svelte-ignore a11y_media_has_caption --><video bind:this={video} src={`/api/attachments/${current.id}/playback`} controls autoplay playsinline onloadedmetadata={()=>{if(video)video.currentTime=Math.min(seekSeconds,video.duration||0);}} onerror={()=>broken=true} oncontextmenu={event=>{event.preventDefault();menu={x:event.clientX,y:event.clientY};}}></video>{/key}{:else}<button class="ash-button ash-ghost image" oncontextmenu={event=>{event.preventDefault();menu={x:event.clientX,y:event.clientY};}} aria-label={zoom?'Fit image':'View at original size'} onclick={()=>zoom=!zoom}><img src={`/api/attachments/${current.id}/original`} alt={current.summary??current.filename} onerror={()=>broken=true}/></button>{/if}
    {#if images.length>1}<button class="ash-button ash-ghost nav previous" aria-label="Previous attachment" disabled={index===0} onclick={()=>navigate(index-1)}>‹</button><button class="ash-button ash-ghost nav next" aria-label="Next attachment" disabled={index===images.length-1} onclick={()=>navigate(index+1)}>›</button>{/if}
  </div>
  <footer>
    {#if images.length>1}<div class="filmstrip" bind:this={strip}>{#each images as image,i (image.id)}<button class:selected={i===index} aria-label={`View attachment ${i+1}`} onclick={()=>navigate(i)} class="ash-button"><img src={`/api/attachments/${image.id}/thumbnail`} alt={image.filename}/></button>{/each}</div>{/if}
    <div class="actions">{#if !isVideoAttachment(current)}<button aria-label="Copy image" data-tooltip="Copy image" disabled={busy||broken} onclick={()=>action('copy')} class="ash-button"><Icon name="copy"/></button>{/if}<button aria-label={isVideoAttachment(current)?'Save video':'Save image'} data-tooltip={isVideoAttachment(current)?'Save video':'Save image'} disabled={busy||broken} onclick={()=>action('save')} class="ash-button"><Icon name="save"/></button></div>
    <details><summary>{isVideoAttachment(current)?'Video description':'Image description'}{#if current.summaryRun && isActive(current.summaryRun.status)} · generating…{/if}</summary><button aria-label="Copy description" data-tooltip="Copy description" data-tooltip-below data-tooltip-start disabled={!current.summary} onclick={copyDescription} class="ash-button"><Icon name="copy" size={15}/></button><p>{current.summary??'A description is not available yet. You can still send and view this image.'}</p>{#if current.summaryRun}<span class="muted">{current.summaryRun.status} · generated description may omit details</span>{#if !isActive(current.summaryRun.status)&&current.summaryRun.status!=='completed'}<button aria-label="Retry description" data-tooltip="Retry description" data-tooltip-below data-tooltip-start disabled={busy} onclick={retry} class="ash-button"><Icon name="retry" size={15}/></button>{/if}{/if}</details>
    {#if isVideoAttachment(current)}<details class="transcript-details" bind:open={transcriptOpen}><summary>Video transcript{#if current.summaryRun&&isActive(current.summaryRun.status)} · generating…{/if}</summary>
      {#if current.understanding?.transcript.length}<button aria-label="Copy transcript" data-tooltip="Copy transcript" disabled={busy} onclick={copyTranscript} class="ash-button"><Icon name="copy" size={15}/></button><p class="muted">Machine transcript · approximate timestamps</p><ol class="transcript-list">{#each current.understanding.transcript as segment}<li><button class="ash-button ash-ghost timestamp" aria-label={`Seek to ${formatVideoDuration(segment.start)}`} onclick={()=>{if(video)video.currentTime=segment.start;}}>{formatVideoDuration(segment.start)}</button><p>{segment.text}</p></li>{/each}</ol>
      {:else}<p>{!current.metadata.hasAudio?'This video has no audio.':current.summaryRun&&isActive(current.summaryRun.status)?'Transcribing narration…':current.understanding&&current.summaryRun?.status==='completed'?'No intelligible speech was transcribed.':'Transcript unavailable. Retry video analysis to generate it.'}</p>{/if}
      {#if current.summaryRun&&!isActive(current.summaryRun.status)&&current.summaryRun.status!=='completed'}<button disabled={busy} onclick={retry} class="ash-button">Retry video analysis</button>{/if}
    </details>{/if}
    <div class="feedback" role="status">{feedback}</div>
  </footer>
{#if menu}<Menu x={menu.x} y={menu.y} onClose={()=>menu=null} items={[...(isVideoAttachment(current)?[]:[{label:'Copy image',disabled:busy||broken,action:()=>void action('copy')}]),{label:isVideoAttachment(current)?'Save video':'Save image',disabled:busy||broken,action:()=>void action('save')},...(isVideoAttachment(current)?[]:[{label:'Copy description',disabled:!current.summary,action:()=>void copyDescription()}])]}/>{/if}
</div></dialog>
<style>
  .transcript-list{list-style:none;padding:0;max-width:760px;margin:8px auto;text-align:left}.transcript-list li{display:flex;gap:12px;align-items:baseline;padding:5px 0}.transcript-list p{margin:0;flex:1;white-space:pre-wrap}.transcript-list .timestamp{font-variant-numeric:tabular-nums;flex-shrink:0;margin:0;padding:3px 6px;color:var(--muted)}
  .stage video{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}

  .viewer{background:var(--text);color:var(--muted);border:1px solid var(--divider);border-radius:14px;width:calc(100vw - 64px);max-width:1250px;height:calc(100vh - 64px);max-height:1000px;padding:0;overflow:hidden;animation:none}.viewer[open]{display:flex;flex-direction:column}.viewer::backdrop{background:#1d241bcc;backdrop-filter:blur(7px)}header{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;flex-shrink:0}header div{display:grid;gap:5px;min-width:0}header strong{font-size:1rem;overflow-wrap:anywhere}header span,.muted{font-size:.8rem;color:var(--muted)}button{color:inherit;background:var(--text);border:1px solid var(--divider);border-radius:5px;padding:7px 10px;font-size:.8rem}.close{display:inline-flex;background:transparent;border:0;padding:0 10px}.stage{position:relative;flex:1;min-height:100px;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--text)}.image{display:block;width:100%;height:100%;padding:0;border:0;background:transparent;cursor:zoom-in}.image img{display:block;width:100%;height:100%;object-fit:contain}.zoom{display:block}.zoom .image{width:max-content;height:max-content;min-width:100%;min-height:100%;cursor:zoom-out}.zoom .image img{width:auto;height:auto;margin:auto}.nav{position:fixed;top:45%;font-size:26px;background:var(--text);border-color:color-mix(in srgb,var(--text) 40%,transparent)}.previous{left:40px}.next{right:40px}footer{padding:30px 20px 3px;max-height:35%;overflow:auto;flex-shrink:0}.actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.filmstrip{display:flex;justify-content:safe center;gap:7px;overflow-x:auto;margin-bottom:28px}.filmstrip button{width:50px;height:45px;flex-shrink:0;padding:2px;border:2px solid transparent;background:transparent}.filmstrip .selected{border-color:var(--divider)}.filmstrip img{width:100%;height:100%;object-fit:cover;border-radius:2px}details{font-size:.8rem;line-height:1.6;margin:12px 0 0}summary{cursor:pointer;color:var(--muted)}details p{max-width:760px;margin:8px auto;overflow-wrap:anywhere}details button{margin:8px 0 0;display:inline-flex}.feedback{font-size:.8rem;min-height:22px;text-align:center;margin-top:7px;color:var(--muted)}
@keyframes viewer-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){.viewer{animation:none}}
</style>
