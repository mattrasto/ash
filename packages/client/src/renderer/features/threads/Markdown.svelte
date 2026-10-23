<script lang="ts">
  import { onMount } from 'svelte';
  import { StreamingMarkdown } from './streaming.ts';
  let {text,streaming=false,onSource}:{text:string;streaming?:boolean;onSource?:(reference:string)=>boolean}=$props();
  let host:HTMLDivElement,renderer=$state<StreamingMarkdown>();
  onMount(()=>{renderer=new StreamingMarkdown(host);renderer.prime(text);return()=>renderer?.dispose();});
  let wasStreaming=false;
  $effect(()=>{renderer?.update(text,streaming||wasStreaming);wasStreaming=streaming;});
  let feedback=$state('');
  async function activate(event:MouseEvent) {
    const target=event.target as HTMLElement;
    const button=target.closest<HTMLButtonElement>('[data-copy-code]');
    if(button){
      const code=button.closest('.code-block')?.querySelector('code')?.textContent??'';
      try{await window.ashMedia.copyText(code);feedback='Code copied';}catch{feedback='Copy failed';}
    }
    const link=target.closest<HTMLAnchorElement>('a');
    if(link){event.preventDefault();if(link.dataset.sourceReference){if(!onSource?.(link.dataset.sourceReference))feedback='Source citation unavailable';return;}try{await window.ashMedia.openLink(link.href);}catch{feedback='Could not open link';}}
  }
</script>
<!-- Delegated events only handle generated buttons/anchors; raw HTML is escaped by renderMarkdown. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="markdown" bind:this={host} onclick={activate}></div>
{#if feedback}<span class="copy-feedback" role="status">{feedback}</span>{/if}
<style>
  .markdown{overflow-wrap:anywhere;line-height:1.65}.markdown :global(p){margin:0 0 .8em}.markdown :global(p:last-child){margin-bottom:0}.markdown :global(h1),.markdown :global(h2),.markdown :global(h3){font-size:1.12em;line-height:1.4;margin:1em 0 .5em}.markdown :global(ul),.markdown :global(ol){padding-left:1.5em}.markdown :global(li){margin:.25em 0}.markdown :global(blockquote){border-left:3px solid var(--divider);margin:1em 0;padding-left:1em;color:var(--text)}.markdown :global(code){font:12px/1.6 ui-monospace,SFMono-Regular,monospace;background:color-mix(in srgb,var(--control) 35%,transparent);border-radius:3px;padding:2px 4px}.markdown :global(.code-block){border:1px solid var(--divider);border-radius:8px;overflow:hidden;margin:12px 0;background:color-mix(in srgb,var(--control) 35%,transparent)}.markdown :global(.code-heading){display:flex;justify-content:space-between;align-items:center;padding:6px 12px;color:var(--text);font-size:.8rem;border-bottom:1px solid var(--divider)}.markdown :global(button){border:0;background:transparent;font-size:.8rem;color:var(--accent,var(--text));padding:4px}.markdown :global(pre){margin:0;padding:12px;overflow:auto;white-space:pre}.markdown :global(pre code){background:none;padding:0}.markdown :global(table){display:block;border-collapse:collapse;max-width:100%;overflow:auto;margin:12px 0;font-size:.9rem}.markdown :global(td),.markdown :global(th){border:1px solid var(--divider);padding:6px 10px;text-align:left}.markdown :global(hr){border:0;border-top:1px solid var(--divider)}.copy-feedback{display:block;font-size:.8rem;color:var(--text);margin-top:5px}
  .markdown :global(.stream-token){animation:reveal .3s ease-out both}.markdown :global(.stream-block){animation:block-in .2s ease-out both}@keyframes reveal{from{opacity:0;filter:blur(2px)}to{opacity:1;filter:blur(0)}}@keyframes block-in{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.markdown :global(.stream-token),.markdown :global(.stream-block){animation:none}}
</style>
