<script lang="ts">
  import type { AttachmentView } from '@ash/shared';
  let {images,onOpen}:{images:AttachmentView[];onOpen:(images:AttachmentView[],index:number)=>void}=$props();
  let broken=$state<Record<string,boolean>>({});
</script>
<div class="gallery" class:accordion={images.length>=3} style={`--image-count:${images.length}`}>
  {#each images as image,index (image.id)}
    <button class="tile" type="button" aria-label={`Open ${image.filename}`} title={image.filename} onclick={()=>onOpen(images,index)}>
      {#if broken[image.id]}<span>Image unavailable</span>{:else}<img src={`/api/attachments/${image.id}/thumbnail`} alt={image.summary??image.filename} width={image.metadata.thumbnail.width} height={image.metadata.thumbnail.height} onerror={()=>broken[image.id]=true} />{/if}
      <span class="image-name">{image.filename}</span>
    </button>
  {/each}
</div>
<style>
  .gallery{display:flex;align-items:flex-start;gap:8px;margin:8px 0;max-width:100%}.tile{position:relative;border:1px solid #d7ddcf;border-radius:9px;padding:0;background:#e8ece2;overflow:hidden;max-width:100%;min-width:0;flex:0 1 auto;color:#65705f}.tile img{display:block;max-width:100%;width:auto;height:auto;max-height:240px;object-fit:contain}.tile:hover{box-shadow:0 5px 18px #26352224}.image-name{position:absolute;bottom:0;left:0;right:0;padding:20px 9px 7px;background:linear-gradient(transparent,#19231fcc);color:white;font-size:10px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;transition:opacity .15s}.tile:hover .image-name,.tile:focus-visible .image-name{opacity:1}.accordion{width:calc(var(--image-count)*110px);height:205px;gap:0;isolation:isolate}.accordion .tile{flex:1;min-width:48px;height:100%;transition:flex-grow .3s cubic-bezier(.2,.85,.2,1)}.accordion .tile+.tile{margin-left:-8px}.accordion .tile img{width:100%;height:100%;object-fit:cover;max-height:none}.accordion .tile:hover,.accordion .tile:focus-visible{flex-grow:4;z-index:2}@media(prefers-reduced-motion:reduce){.accordion .tile,.image-name{transition:none}}
</style>
