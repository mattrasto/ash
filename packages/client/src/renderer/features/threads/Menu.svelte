<script module lang="ts">
  export interface MenuItem {
    label:string; action?:()=>void; disabled?:boolean; checked?:boolean;
    submenu?:{items:MenuItem[];onOpen:()=>void;status?:string;error?:string};
  }
</script>
<script lang="ts">
  import Status from "../../ui/Status.svelte";
  import { onMount, tick } from 'svelte';
  import {surface,mist} from '../../ui/surface.ts';
  import {popup} from '../../ui/popup.ts';
  import Icon from '../../ui/Icon.svelte';
  let {x,y,anchor,resolveAnchor,items,onClose,fallbackFocus}:{x:number;y:number;anchor?:HTMLElement;resolveAnchor?:()=>HTMLElement|undefined;items:MenuItem[];onClose:()=>void;fallbackFocus?:()=>void}=$props();
  let menu=$state<HTMLDivElement>(null!),child= $state<HTMLDivElement>(),open=$state(-1);
  const enabled=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([aria-disabled="true"])'));
  function parentButton(){return menu.querySelector(':scope > .surface-content')!.children[open] as HTMLButtonElement;}
  async function show(index:number,focus=false){
    if(items[index].disabled||!items[index].submenu)return;
    if(open!==index){open=index;items[index].submenu!.onOpen();}
    await tick();if(focus&&child)(enabled(child)[0]??child).focus();
  }
  $effect(()=>{if(open>=0&&items[open]?.submenu){void tick().then(()=>{if(child&&document.activeElement===child)enabled(child)[0]?.focus();});}});
  function hideChild(){const button=parentButton();open=-1;button?.focus();}
  function activate(item:MenuItem){if(item.disabled)return;try{if(item.checked===undefined)returnFocus();item.action?.();}finally{if(item.checked===undefined)onClose();}}
  let beforeFocus:HTMLElement|null=null;
  function returnFocus(){const dialog=document.querySelector('dialog[open]');if(dialog&&beforeFocus&&!dialog.contains(beforeFocus))return;if(beforeFocus?.isConnected&&!beforeFocus.closest('[inert]'))beforeFocus.focus({preventScroll:true});else fallbackFocus?.();}
  let typed='',typedAt=0;
  function key(event:KeyboardEvent){
    if(menu.inert)return;
    const inChild=!!child?.contains(document.activeElement),root=inChild?child!:menu;
    const buttons=enabled(root),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(open>=0)hideChild();else{returnFocus();onClose();}}
    if(event.key==='ArrowLeft'&&inChild){event.preventDefault();hideChild();}
    if(event.key==='ArrowRight'&&!inChild){const at=Array.from(menu.querySelector(':scope > .surface-content')!.children).indexOf(document.activeElement as Element);if(at>=0&&items[at].submenu){event.preventDefault();void show(at,true);}}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();
    }
    if(event.key==='Tab'){returnFocus();onClose();}
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){const now=performance.now();typed=now-typedAt<700?typed+event.key:event.key;typedAt=now;const next=buttons.slice(index+1).concat(buttons.slice(0,index+1)).find(button=>button.textContent?.trim().toLowerCase().startsWith(typed.toLowerCase()));if(next){event.preventDefault();next.focus();next.scrollIntoView({block:'nearest'});}}
  }
  onMount(()=>{
    beforeFocus=document.activeElement as HTMLElement|null;
    menu.style.left=`${Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))}px`;
    enabled(menu)[0]?.focus();
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);};
  });
</script>
<div use:surface={{material:"popup"}} use:popup={{anchor,resolveAnchor,point:anchor?undefined:{x,y},onClose,chain:()=>child?[child]:[]}} transition:mist={{role:"popup"}} class="menu" role="menu" aria-label="Actions" bind:this={menu} style:left={`${x}px`} style:top={`${y}px`}><div class="surface-content">
  {#each items as item,index}<button role="menuitem" tabindex="-1" aria-disabled={!!item.disabled} aria-haspopup={item.submenu?'menu':undefined} aria-expanded={item.submenu?open===index:undefined} onpointermove={event=>{if(!event.movementX&&!event.movementY)return;if(item.submenu)void show(index);else open=-1;}} onclick={()=>item.submenu?void show(index,true):activate(item)} class="ash-menu-row"><span>{item.label}</span>{#if item.submenu}<span aria-hidden="true">›</span>{/if}</button>{/each}
</div></div>
{#if open>=0 && items[open]?.submenu}
  {@const submenu=items[open].submenu!}
  <div use:surface={{material:"popup"}} use:popup={{anchor:parentButton(),parent:menu,onClose:()=>open=-1,chain:()=>[menu]}} transition:mist={{role:"popup"}} class="menu submenu" role="menu" aria-label={items[open].label} tabindex="-1" bind:this={child}><div class="surface-content">
    {#if submenu.status}<p class="hint" role="status">{submenu.status}</p>{/if}
    {#if submenu.error}<div class="error" role="alert"><Status announce={false} label="Action failed">{submenu.error}</Status></div>{/if}
    {#each submenu.items as item}<button role="menuitemcheckbox" tabindex="-1" aria-checked={!!item.checked} aria-disabled={!!item.disabled} onclick={()=>activate(item)} class="ash-menu-row"><span class="check" class:checked={item.checked} aria-hidden="true" style:opacity={item.checked?1:0}><Icon name="check" size={14}/></span><span>{item.label}</span></button>{/each}
  </div></div>
{/if}
<style>
  .menu{position:fixed;z-index:20;min-width:180px;max-width:min(280px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:5px;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);border:1px solid var(--divider);border-radius:9px;box-shadow:0 6px 24px color-mix(in srgb,var(--shadow) 15%,transparent)}.menu button{display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;text-align:left;border:0;border-radius:5px;background:transparent;padding:9px 12px;color:inherit;font-size:.9rem}.menu button span{overflow-wrap:anywhere}.menu button[aria-disabled=true]{opacity:.5;cursor:default}.submenu{z-index:21;min-width:210px}.submenu button{justify-content:flex-start;gap:10px}.check{transition:opacity 100ms linear;width:14px;height:14px;flex-shrink:0;border:1px solid var(--divider);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:.8rem}.check.checked{background:color-mix(in srgb,var(--control) 35%,transparent);color:white;border-color:var(--divider)}.hint,.error{margin:5px 7px;padding:5px;font-size:.8rem;line-height:1.5;overflow-wrap:anywhere}.hint{color:var(--muted)}.error{color:var(--danger)}
</style>
