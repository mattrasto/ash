<script lang="ts">
  import { onMount } from 'svelte';
  let {x,y,items,onClose}:{x:number;y:number;items:{label:string;action:()=>void;disabled?:boolean}[];onClose:()=>void}=$props();
  let menu:HTMLDivElement;
  function key(event:KeyboardEvent){
    const buttons=Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();
    }
    if(event.key==='Tab')onClose();
  }
  onMount(()=>{
    const before=document.activeElement as HTMLElement|null;
    menu.style.left=`${Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))}px`;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside=(event:PointerEvent)=>{if(!menu.contains(event.target as Node))onClose();};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);before?.focus({preventScroll:true});};
  });
</script>
<div class="menu" role="menu" aria-label="Actions" bind:this={menu} style:left={`${x}px`} style:top={`${y}px`}>
  {#each items as item}<button role="menuitem" disabled={item.disabled} onclick={()=>{try{item.action();}finally{onClose();}}}>{item.label}</button>{/each}
</div>
<style>
  .menu{position:fixed;z-index:20;min-width:180px;padding:5px;background:#fffefa;color:#35422e;border:1px solid #d6dece;border-radius:9px;box-shadow:0 6px 24px #20351d25}.menu button{display:block;width:100%;text-align:left;border:0;border-radius:5px;background:transparent;padding:9px 12px;color:inherit;font-size:12px}.menu button:hover,.menu button:focus-visible{background:var(--tint,#edf1e8);outline:none}
</style>
