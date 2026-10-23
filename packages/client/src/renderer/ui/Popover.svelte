<script lang="ts">
  import type {Snippet} from 'svelte';
  import {surface,mist} from './surface.ts';
  import {popup} from './popup.ts';
  import {scrollArea} from './scroll.ts';
  let {anchor,onClose,children,width,maxHeight}:{anchor:HTMLElement;onClose:()=>void;children:Snippet;width?:number;maxHeight?:number}=$props();
  let measuredWidth=$state(0);
  $effect(()=>{
    const update=()=>measuredWidth=Math.min(width??anchor.getBoundingClientRect().width,innerWidth-16);
    const observer=new ResizeObserver(update);observer.observe(anchor);window.addEventListener('resize',update);update();
    return()=>{observer.disconnect();window.removeEventListener('resize',update);};
  });
</script>

<div class="ash-select-popup" style:width={`${measuredWidth}px`} style:max-width="calc(100vw - 16px)" style:max-height={maxHeight?`min(${maxHeight}px, calc(100vh - 16px))`:undefined} use:surface={{material:'popup'}} use:popup={{anchor,onClose}} transition:mist={{role:'popup'}}>
  <div class="surface-content" use:scrollArea>{@render children()}</div>
</div>
