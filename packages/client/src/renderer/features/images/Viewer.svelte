<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { isActive, type AttachmentView } from '@ash/shared';
  import Menu from '../conversations/Menu.svelte';
  import Icon from '../conversations/Icon.svelte';
  let {images,startIndex=0,onClose,onRetry}:{images:AttachmentView[];startIndex?:number;onClose:()=>void;onRetry:(image:AttachmentView)=>Promise<void>}=$props();
  let index=$state(untrack(()=>startIndex));
  let dialog:HTMLDialogElement,strip=$state<HTMLDivElement>();
  let menu=$state<{x:number;y:number}|null>(null);
  let zoom=$state(false),feedback=$state(''),busy=$state(false),broken=$state(false);
  const current=$derived(images[index]);
  function navigate(next:number){index=Math.max(0,Math.min(images.length-1,next));zoom=false;feedback='';broken=false;}
  function key(event:KeyboardEvent){if(menu||(event.target as HTMLElement).closest('input,textarea,summary'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(index+(event.key==='ArrowRight'?1:-1));}}
  async function action(kind:'copy'|'save') {
    if(busy)return;busy=true;feedback=kind==='copy'?'Copying image…':'Opening save dialog…';
    try{const result=await window.ashMedia.imageAction(current.id,kind);feedback=result==='cancelled'?'':kind==='copy'?'Image copied':'Image saved';}
    catch{feedback=kind==='copy'?'Could not copy image.':'Could not save image.';}finally{busy=false;}
  }
  async function copyDescription(){try{await window.ashMedia.copyText(current.summary??'');feedback='Description copied';}catch{feedback='Could not copy description.';}}
  async function retry(){busy=true;try{await onRetry(current);feedback='Description retry started';}catch(e){feedback=(e as Error).message;}finally{busy=false;}}
  onMount(()=>{const before=document.activeElement as HTMLElement|null;dialog.showModal();return()=>before?.focus();});
  $effect(()=>{index;void tick().then(()=>strip?.querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'center'}));});
</script>
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog class="viewer" onclick={event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}} bind:this={dialog} oncancel={(event)=>{event.preventDefault();onClose();}} onkeydown={key} aria-label={`Image viewer: ${current.filename}`}>
  <header><div><strong>{current.filename}</strong><span>{index+1} / {images.length} · {current.metadata.original.width} × {current.metadata.original.height}</span></div><button class="close" aria-label="Close image viewer" data-tooltip="Close" data-tooltip-below onclick={onClose}><Icon name="close" size={22}/></button></header>
  <div class="stage" class:zoom>
    {#if broken}<p>The saved image is unavailable.</p>{:else}<button class="image" oncontextmenu={event=>{event.preventDefault();menu={x:event.clientX,y:event.clientY};}} aria-label={zoom?'Fit image':'View at original size'} onclick={()=>zoom=!zoom}><img src={`/api/attachments/${current.id}/original`} alt={current.summary??current.filename} onerror={()=>broken=true}/></button>{/if}
    {#if images.length>1}<button class="nav previous" aria-label="Previous image" disabled={index===0} onclick={()=>navigate(index-1)}>‹</button><button class="nav next" aria-label="Next image" disabled={index===images.length-1} onclick={()=>navigate(index+1)}>›</button>{/if}
  </div>
  <footer>
    {#if images.length>1}<div class="filmstrip" bind:this={strip}>{#each images as image,i (image.id)}<button class:selected={i===index} aria-label={`View image ${i+1}`} onclick={()=>navigate(i)}><img src={`/api/attachments/${image.id}/thumbnail`} alt={image.filename}/></button>{/each}</div>{/if}
    <div class="actions"><button aria-label="Copy image" data-tooltip="Copy image" disabled={busy||broken} onclick={()=>action('copy')}><Icon name="copy"/></button><button aria-label="Save image" data-tooltip="Save image" disabled={busy||broken} onclick={()=>action('save')}><Icon name="save"/></button></div>
    <details><summary>Image description{#if current.summaryRun && isActive(current.summaryRun.status)} · generating…{/if}</summary><button aria-label="Copy description" data-tooltip="Copy description" data-tooltip-below data-tooltip-start disabled={!current.summary} onclick={copyDescription}><Icon name="copy" size={15}/></button><p>{current.summary??'A description is not available yet. You can still send and view this image.'}</p>{#if current.summaryRun}<span class="muted">{current.summaryRun.status} · generated description may omit details</span>{#if !isActive(current.summaryRun.status)&&current.summaryRun.status!=='completed'}<button aria-label="Retry description" data-tooltip="Retry description" data-tooltip-below data-tooltip-start disabled={busy} onclick={retry}><Icon name="retry" size={15}/></button>{/if}{/if}</details>
    <div class="feedback" role="status">{feedback}</div>
  </footer>
{#if menu}<Menu x={menu.x} y={menu.y} onClose={()=>menu=null} items={[{label:'Copy image',disabled:busy||broken,action:()=>void action('copy')},{label:'Save image',disabled:busy||broken,action:()=>void action('save')},{label:'Copy description',disabled:!current.summary,action:()=>void copyDescription()}]}/>{/if}
</dialog>
<style>
  .viewer{--accent:#96b292;background:#222923;color:#f3f4ef;border:1px solid #586452;border-radius:14px;width:calc(100vw - 64px);max-width:1250px;height:calc(100vh - 64px);max-height:1000px;padding:0;overflow:hidden;animation:viewer-in .18s ease-out}.viewer[open]{display:flex;flex-direction:column}.viewer::backdrop{background:#1d241bcc;backdrop-filter:blur(7px)}header{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;flex-shrink:0}header div{display:grid;gap:5px;min-width:0}header strong{font-size:13px;overflow-wrap:anywhere}header span,.muted{font-size:10px;color:#b5bead}button{color:inherit;background:#374232;border:1px solid #53634a;border-radius:5px;padding:7px 10px;font-size:11px}.close{display:inline-flex;background:transparent;border:0;padding:0 10px}.stage{position:relative;flex:1;min-height:100px;display:flex;align-items:center;justify-content:center;overflow:auto;background:#192019}.image{display:block;width:100%;height:100%;padding:0;border:0;background:transparent;cursor:zoom-in}.image img{display:block;width:100%;height:100%;object-fit:contain}.zoom{display:block}.zoom .image{width:max-content;height:max-content;min-width:100%;min-height:100%;cursor:zoom-out}.zoom .image img{width:auto;height:auto;margin:auto}.nav{position:fixed;top:45%;font-size:26px;background:#263024d9;border-color:#6d7b6266}.previous{left:40px}.next{right:40px}footer{padding:30px 20px 3px;max-height:35%;overflow:auto;flex-shrink:0}.actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.filmstrip{display:flex;justify-content:safe center;gap:7px;overflow-x:auto;margin-bottom:28px}.filmstrip button{width:50px;height:45px;flex-shrink:0;padding:2px;border:2px solid transparent;background:transparent}.filmstrip .selected{border-color:#b5cca5}.filmstrip img{width:100%;height:100%;object-fit:cover;border-radius:2px}details{font-size:11px;line-height:1.6;margin:12px 0 0}summary{cursor:pointer;color:#c4d2b9}details p{max-width:760px;margin:8px auto;overflow-wrap:anywhere}details button{margin:8px 0 0;display:inline-flex}.feedback{font-size:11px;min-height:22px;text-align:center;margin-top:7px;color:#c4d2b9}
@keyframes viewer-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){.viewer{animation:none}}
</style>
