<script lang="ts">
  import {tick} from 'svelte';
  import type { ThreadView } from '@ash/shared';
  import Icon from '../../ui/Icon.svelte';
  import Status from '../../ui/Status.svelte';
  import {dialogDismiss} from '../../ui/dismiss.ts';
  import {selectField} from '../../ui/select.ts';
  import {surface,mist} from '../../ui/surface.ts';
  let {thread,api,onChanged}:{thread:ThreadView;api:<T>(path:string,body?:object)=>Promise<T>;onChanged:()=>Promise<void>}=$props();
  let busy=$state(false),error=$state(''),choice=$state('auto'),open=$state(false);
  let dialog:HTMLDialogElement,trigger:HTMLButtonElement;
  const routingState=$derived(thread.lifecycle?.modelRouting??{version:0,upgraded:false,override:'auto'});
  $effect(()=>{if(!busy)choice=routingState.override;});
  async function show(){open=true;await tick();dialog.showModal();}
  function close(){if(busy)return;open=false;}
  async function save(value:string){
    busy=true;error='';
    try{await api(`threads/${thread.id}/model-routing`,{expectedVersion:routingState.version,override:value});await onChanged();}
    catch(e){error=(e as Error).message;}
    finally{busy=false;}
  }
</script>
<button class="ash-button ash-ghost model-settings" bind:this={trigger} onclick={()=>void show()}>Model settings{routingState.override!=='auto'?' · override':''}</button>
{#if open}
<dialog bind:this={dialog} aria-label="Model settings" onoutroend={()=>{if(!open){dialog.close();trigger.focus();}}} oncancel={event=>{event.preventDefault();close();}} use:dialogDismiss={close} use:surface={{dense:true}} transition:mist={{role:'large'}}><div class="surface-content">
  <header><h2>Model settings</h2><button class="ash-button ash-ghost ash-icon ash-close" aria-label="Close model settings" disabled={busy} onclick={close}><Icon name="close"/></button></header>
  <label for="thread-model">Thread model</label>
  <select use:selectField class="ash-field" id="thread-model" bind:value={choice} disabled={busy} onchange={()=>void save(choice)}>
    <option value="auto">Automatic</option>
    <option value="strong">GPT-6.1 Sol</option>
    <option value="fast">GPT-6 Luna</option>
    <option value="private" disabled>Private · not configured</option>
  </select>
  <p>Applies to new responses. Active work and retries keep their original model.</p>
  {#if routingState.upgraded&&routingState.override==='auto'}<p>This Thread stays on Sol after an automatic upgrade.</p>{/if}
  {#if error}<div role="alert"><Status announce={false} label="Action failed">{error}</Status></div>{/if}
</div></dialog>
{/if}
<style>
  .model-settings{-webkit-app-region:no-drag}dialog{width:min(380px,calc(100vw - 48px));padding:24px;color:var(--text)}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}h2{margin:0;font-size:1.2rem;font-weight:525}label{display:block;margin-bottom:7px}select{width:100%}p{line-height:1.6;margin:12px 0 0;color:var(--muted)}[role=alert]{margin-top:12px}
</style>
