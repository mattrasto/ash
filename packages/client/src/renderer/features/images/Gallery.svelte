<script lang="ts">
  import { isActive,type AttachmentView } from '@ash/shared';
  import Menu from '../conversations/Menu.svelte';
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
<!-- Hover descriptions are also available on keyboard focus and in the viewer. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="gallery" onmouseleave={()=>hovered=null} class:accordion={images.length>=3} style={`--image-count:${images.length}`}>
  {#each images as image,index (image.id)}
    <button class="tile" type="button" aria-label={`Open ${image.filename}`} title={image.filename} onmouseenter={()=>hovered=image.id} onfocus={()=>hovered=image.id} onblur={()=>hovered=null} oncontextmenu={event=>{event.preventDefault();menu={image,index,x:event.clientX,y:event.clientY};}} onclick={()=>onOpen(images,index)}>
      {#if broken[image.id]}<span>Image unavailable</span>{:else}<img src={`/api/attachments/${image.id}/thumbnail`} alt={image.summary??image.filename} width={image.metadata.thumbnail.width} height={image.metadata.thumbnail.height} onerror={()=>broken[image.id]=true} />{/if}
      <span class="image-name">{image.filename}</span>
    </button>
  {/each}
</div>
<div class="description" class:shown={!!described}><div><p>{described?.summary??(described?.summaryRun&&isActive(described.summaryRun.status)?'Describing image…':described?'Description unavailable':'')}</p></div></div>
{#if feedback}<span class="feedback" role="status">{feedback}</span>{/if}
{#if menu}{@const target=menu}<Menu x={target.x} y={target.y} onClose={()=>menu=null} items={[{label:'Open image',action:()=>onOpen(images,target.index)},{label:'Copy image',action:()=>void action(target.image,'copy')},{label:'Save image',action:()=>void action(target.image,'save')},{label:'Copy description',disabled:!target.image.summary,action:()=>void action(target.image,'description')}]}/>{/if}
<style>
  .gallery{display:flex;align-items:flex-start;gap:8px;margin:8px 0;max-width:100%}.tile{position:relative;border:1px solid #d7ddcf;border-radius:9px;padding:0;background:#e8ece2;overflow:hidden;max-width:100%;min-width:0;flex:0 1 auto;color:#65705f}.tile img{display:block;max-width:100%;width:auto;height:auto;max-height:240px;object-fit:contain}.tile:hover{box-shadow:0 5px 18px #26352224}.image-name{position:absolute;bottom:0;left:0;right:0;padding:20px 9px 7px;background:linear-gradient(transparent,#19231fcc);color:white;font-size:10px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;transition:opacity .15s}.tile:hover .image-name,.tile:focus-visible .image-name{opacity:1}.accordion{width:calc(var(--image-count)*110px);height:205px;gap:0;isolation:isolate}.accordion .tile{flex:1;min-width:48px;height:100%;transition:flex-grow .3s cubic-bezier(.2,.85,.2,1)}.accordion .tile+.tile{margin-left:-8px}.accordion .tile img{width:100%;height:100%;object-fit:cover;max-height:none}.accordion .tile:hover,.accordion .tile:focus-visible{flex-grow:4;z-index:2}@media(prefers-reduced-motion:reduce){.accordion .tile,.image-name{transition:none}}
  .description{display:grid;grid-template-rows:0fr;transition:grid-template-rows .18s ease,opacity .18s;opacity:0}.description.shown{grid-template-rows:1fr;opacity:1}.description>div{overflow:hidden;min-height:0}.description p{margin:0 0 10px;font-size:11px;line-height:1.5;color:#87927c;max-width:600px;overflow-wrap:anywhere}.feedback{font-size:10px;color:#7b8b6f}@media(prefers-reduced-motion:reduce){.description{transition:none}}
</style>
