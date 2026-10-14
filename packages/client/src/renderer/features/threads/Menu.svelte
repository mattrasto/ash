<script module lang="ts">
  export interface MenuItem {
    label:string; action?:()=>void; disabled?:boolean; checked?:boolean;
    submenu?:{items:MenuItem[];onOpen:()=>void;status?:string;error?:string};
  }
</script>
<script lang="ts">
  import { onMount, tick } from 'svelte';
  let {x,y,items,onClose,fallbackFocus}:{x:number;y:number;items:MenuItem[];onClose:()=>void;fallbackFocus?:()=>void}=$props();
  let menu:HTMLDivElement,child= $state<HTMLDivElement>(),open=$state(-1);
  const enabled=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([aria-disabled="true"])'));
  function parentButton(){return menu.children[open] as HTMLButtonElement;}
  async function show(index:number,focus=false){
    if(items[index].disabled||!items[index].submenu)return;
    if(open!==index){open=index;items[index].submenu!.onOpen();}
    await tick();placeChild();if(focus&&child)(enabled(child)[0]??child).focus();
  }
  function placeChild(){
    if(!child||open<0)return;
    const rect=parentButton().getBoundingClientRect(),bounds=menu.getBoundingClientRect();
    child.style.left=`${Math.max(8,Math.min(bounds.right+child.offsetWidth<=innerWidth-8?bounds.right-1:bounds.left-child.offsetWidth+1,innerWidth-child.offsetWidth-8))}px`;
    child.style.top=`${Math.max(8,Math.min(rect.top,innerHeight-child.offsetHeight-8))}px`;
  }
  $effect(()=>{if(open>=0&&items[open]?.submenu){void tick().then(()=>{placeChild();if(child&&document.activeElement===child)enabled(child)[0]?.focus();});}});
  function hideChild(){const button=parentButton();open=-1;button?.focus();}
  function activate(item:MenuItem){if(item.disabled)return;try{item.action?.();}finally{if(item.checked===undefined)onClose();}}
  function key(event:KeyboardEvent){
    const inChild=!!child?.contains(document.activeElement),root=inChild?child!:menu;
    const buttons=enabled(root),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(open>=0)hideChild();else onClose();}
    if(event.key==='ArrowLeft'&&inChild){event.preventDefault();hideChild();}
    if(event.key==='ArrowRight'&&!inChild){const at=Array.from(menu.children).indexOf(document.activeElement as Element);if(at>=0&&items[at].submenu){event.preventDefault();void show(at,true);}}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();
    }
    if(event.key==='Tab')onClose();
  }
  onMount(()=>{
    const before=document.activeElement as HTMLElement|null;
    menu.style.left=`${Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))}px`;
    enabled(menu)[0]?.focus();
    const outside=(event:PointerEvent)=>{if(!menu.contains(event.target as Node)&&!child?.contains(event.target as Node))onClose();};
    const resize=()=>onClose();
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',resize);if(before?.isConnected&&!before.closest('[inert]'))before.focus({preventScroll:true});else fallbackFocus?.();};
  });
</script>
<div class="menu" role="menu" aria-label="Actions" bind:this={menu} style:left={`${x}px`} style:top={`${y}px`}>
  {#each items as item,index}<button role="menuitem" tabindex="-1" aria-disabled={!!item.disabled} aria-haspopup={item.submenu?'menu':undefined} aria-expanded={item.submenu?open===index:undefined} onpointerenter={()=>{if(item.submenu)void show(index);else open=-1;}} onclick={()=>item.submenu?void show(index,true):activate(item)}><span>{item.label}</span>{#if item.submenu}<span aria-hidden="true">›</span>{/if}</button>{/each}
</div>
{#if open>=0 && items[open]?.submenu}
  {@const submenu=items[open].submenu!}
  <div class="menu submenu" role="menu" aria-label={items[open].label} tabindex="-1" bind:this={child}>
    {#if submenu.status}<p class="hint" role="status">{submenu.status}</p>{/if}
    {#if submenu.error}<p class="error" role="alert">{submenu.error}</p>{/if}
    {#each submenu.items as item}<button role="menuitemcheckbox" tabindex="-1" aria-checked={!!item.checked} aria-disabled={!!item.disabled} onclick={()=>activate(item)}><span class="check" class:checked={item.checked} aria-hidden="true">{item.checked?'✓':''}</span><span>{item.label}</span></button>{/each}
  </div>
{/if}
<style>
  .menu{position:fixed;z-index:20;min-width:180px;max-width:min(280px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:5px;background:#fffefa;color:#35422e;border:1px solid #d6dece;border-radius:9px;box-shadow:0 6px 24px #20351d25}.menu button{display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;text-align:left;border:0;border-radius:5px;background:transparent;padding:9px 12px;color:inherit;font-size:12px}.menu button span{overflow-wrap:anywhere}.menu button:hover,.menu button:focus-visible{background:var(--tint,#edf1e8);outline:none}.menu button[aria-disabled=true]{opacity:.5;cursor:default}.submenu{z-index:21;min-width:210px}.submenu button{justify-content:flex-start;gap:10px}.check{width:14px;height:14px;flex-shrink:0;border:1px solid #a9b99b;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px}.check.checked{background:#536f43;color:white;border-color:#536f43}.hint,.error{margin:5px 7px;padding:5px;font-size:11px;line-height:1.5;overflow-wrap:anywhere}.hint{color:#79856d}.error{color:#934d3c}
</style>
