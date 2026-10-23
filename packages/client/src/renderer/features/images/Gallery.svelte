<script lang="ts">
  import { isActive,isVideoAttachment,formatVideoDuration,type AttachmentView } from '@ash/shared';
  import Menu from '../threads/Menu.svelte';
  let {images,onOpen}:{images:AttachmentView[];onOpen:(images:AttachmentView[],index:number)=>void}=$props();
  let hovered=$state<string|null>(null),feedback=$state('');
  let menu=$state<{image:AttachmentView;index:number;x:number;y:number}|null>(null);
  const described=$derived(images.find(image=>image.id===hovered));
  async function action(image:AttachmentView,kind:'copy'|'save'|'description'){
    try{if(kind==='description'){await window.ashMedia.copyText(image.summary??'');feedback='Description copied';}
    else{const result=await window.ashMedia.imageAction(image.id,kind);feedback=result==='cancelled'?'':kind==='copy'?'Image copied':'Image saved';}}
    catch{feedback='Could not complete the image action.';}
  }
  let broken=$state<Record<string,boolean>>({});
</script>
<div class="image-gallery">
<!-- Hover descriptions are also available on keyboard focus and in the viewer. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="gallery" onmouseleave={()=>hovered=null} class:accordion={images.length>=3} class:scrollable={images.length>5} style={`--image-count:${images.length}`}>
  {#each images as image,index (image.id)}
    <button class="ash-button tile" type="button" aria-label={`Open ${image.filename}`} title={image.filename} onmouseenter={()=>hovered=image.id} onfocus={()=>hovered=image.id} onblur={()=>hovered=null} oncontextmenu={event=>{event.preventDefault();menu={image,index,x:event.clientX,y:event.clientY};}} onclick={()=>onOpen(images,index)}>
      {#if broken[image.id]}<span>Image unavailable</span>{:else}<img src={`/api/attachments/${image.id}/thumbnail`} alt={image.summary??image.filename} width={image.metadata.thumbnail.width} height={image.metadata.thumbnail.height} onerror={()=>broken[image.id]=true} />{/if}
      <span class="image-name">{image.filename}</span>
      {#if isVideoAttachment(image)}<span class="play-badge" aria-hidden="true">▶</span><span class="duration-badge">{formatVideoDuration(image.metadata.durationSeconds)}</span>{/if}
    </button>
  {/each}
</div>
<div class="description" class:shown={!!described}><div><p>{described&&isVideoAttachment(described)?(described.summaryRun&&isActive(described.summaryRun.status)?'Analyzing video…':described.understanding?'Video ready':'Video analysis unavailable'):described?.summary??(described?.summaryRun&&isActive(described.summaryRun.status)?'Describing image…':described?'Description unavailable':'')}</p></div></div>
</div>
{#if feedback}<span class="feedback" role="status">{feedback}</span>{/if}
{#if menu}{@const target=menu}<Menu x={target.x} y={target.y} onClose={()=>menu=null} items={[{label:isVideoAttachment(target.image)?'Open video':'Open image',action:()=>onOpen(images,target.index)},...(isVideoAttachment(target.image)?[]:[{label:'Copy image',action:()=>void action(target.image,'copy')}]),{label:isVideoAttachment(target.image)?'Save video':'Save image',action:()=>void action(target.image,'save')},...(isVideoAttachment(target.image)?[]:[{label:'Copy description',disabled:!target.image.summary,action:()=>void action(target.image,'description')}])]}/>{/if}
<style>
  .play-badge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;padding:9px 11px;background:var(--text);color:white}.duration-badge{position:absolute;right:6px;bottom:6px;background:var(--text);color:white;padding:3px 5px;border-radius:4px;font-size:.8rem}
  .image-gallery{width:fit-content;max-width:100%}.gallery{display:flex;align-items:flex-start;gap:8px;margin:8px 0;max-width:100%}.tile{position:relative;border:1px solid var(--divider);border-radius:9px;padding:0;background:color-mix(in srgb,var(--control) 35%,transparent);overflow:hidden;max-width:100%;min-width:0;flex:0 1 auto;color:var(--text)}.tile img{display:block;max-width:100%;width:auto;height:auto;max-height:240px;object-fit:contain}.image-name{position:absolute;bottom:0;left:0;right:0;padding:20px 9px 7px;background:linear-gradient(transparent,var(--text));color:white;font-size:.8rem;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;transition:opacity .15s}.tile:hover .image-name,.tile:focus-visible .image-name{opacity:1}.accordion{width:min(calc(var(--image-count)*110px),550px);height:205px;gap:0;isolation:isolate}.accordion .tile{flex:1;min-width:48px;height:100%;transition:flex-grow 190ms cubic-bezier(.2,.85,.2,1)}.accordion .tile+.tile{margin-left:-8px}.accordion .tile img{width:100%;height:100%;object-fit:cover;max-height:none}.accordion .tile:hover,.accordion .tile:focus-visible{flex-grow:4;z-index:2}@media(prefers-reduced-motion:reduce){.accordion .tile,.image-name{transition:none}}
  .scrollable{overflow-x:auto;scrollbar-width:thin}.scrollable .tile{flex:0 0 110px}.scrollable .tile:hover,.scrollable .tile:focus-visible{flex-grow:0}
  .description{contain:inline-size;display:grid;grid-template-rows:0fr;transition:grid-template-rows 110ms cubic-bezier(.2,.7,.2,1),opacity 90ms linear;opacity:0}.description.shown{grid-template-rows:1fr;opacity:1;transition-duration:170ms,90ms;transition-delay:0ms,20ms}.description>div{overflow:hidden;min-height:0}.description p{margin:0 0 10px;font-size:.8rem;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.feedback{font-size:.8rem;color:var(--muted)}@media(prefers-reduced-motion:reduce){.description{transition:none}}
</style>
