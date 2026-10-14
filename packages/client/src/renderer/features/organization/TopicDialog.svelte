<script module lang="ts">
  import type { TopicView } from '@ash/shared';
  export type TopicAction = {kind:'create'} | {kind:'rename'|'delete';topic:TopicView};
</script>
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  type Api = <T>(path:string,body?:object)=>Promise<T>;
  let {action,api,onClose,onChanged,onCreated}:{action:TopicAction;api:Api;onClose:()=>void;onChanged:()=>Promise<void>;onCreated:(id:string)=>void}=$props();
  let dialog:HTMLDialogElement;
  let name=$state(untrack(()=>'topic' in action?action.topic.name:''));
  let target=$state<TopicView|null>(untrack(()=>'topic' in action?action.topic:null));
  let busy=$state(false),error=$state('');
  let command:{id:string;name:string}|null=null;
  const title=$derived(action.kind==='create'?'New Topic':action.kind==='rename'?'Rename Topic':'Delete Topic');
  async function reload() {
    const topics=await api<TopicView[]>('topics');
    if(target)target=topics.find(topic=>topic.id===target!.id)??target;
  }
  async function save() {
    if(busy)return;
    busy=true;error='';
    try {
      if(action.kind==='create'){
        if(command?.name!==name.trim())command={id:crypto.randomUUID(),name:name.trim()};
        const created=await api<TopicView>('topics',command);await onChanged();onCreated(created.id);
      }else if(target)await api(`topics/${target.id}`,{expectedUpdatedAt:target.updatedAt,...(action.kind==='delete'?{deleted:true}:{name:name.trim()})});
      if(action.kind!=='create')await onChanged();
      onClose();
    }catch(e){error=(e as Error).message;await reload().catch(()=>{});}finally{busy=false;}
  }
  onMount(()=>{
    const before=document.activeElement as HTMLElement|null;dialog.showModal();dialog.querySelector<HTMLInputElement>('input')?.focus();
    return()=>{if(before?.isConnected)before.focus({preventScroll:true});else document.querySelector<HTMLButtonElement>('[aria-label="New Topic"]')?.focus({preventScroll:true});};
  });
</script>
<dialog bind:this={dialog} aria-label={title} oncancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header><h2>{title}</h2><button class="close" aria-label={`Close ${title}`} disabled={busy} onclick={onClose}>×</button></header>
  <div class="body">
    {#if error}<p class="error" role="alert">{error}</p>{#if target}<p class="hint">Current Topic name: {target.name}</p>{/if}{/if}
    {#if action.kind==='delete'}
      <p>Delete “{target?.name}”?</p><p class="hint">Threads, images and captured context will remain.</p>
    {:else}
      <form id="topic-form" onsubmit={event=>{event.preventDefault();void save();}}><label for="topic-name">Topic name</label><input id="topic-name" bind:value={name} maxlength="160" disabled={busy} placeholder="e.g. Insurance"/></form>
    {/if}
  </div>
  <footer><button disabled={busy} onclick={onClose}>Cancel</button>{#if action.kind==='delete'}<button class="danger" disabled={busy} onclick={()=>void save()}>Delete Topic</button>{:else}<button class="primary" form="topic-form" disabled={busy||!name.trim()}>{action.kind==='create'?'Create Topic':'Save name'}</button>{/if}</footer>
</dialog>
<style>
  dialog{border:1px solid #cdd6c4;border-radius:14px;background:#f7f8f2;color:#35422e;width:min(440px,calc(100vw - 40px));max-height:calc(100vh - 48px);padding:0;overflow:hidden;box-shadow:0 20px 70px #23301e40}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#25302077;backdrop-filter:blur(3px)}header{display:flex;justify-content:space-between;align-items:center;padding:20px 22px 10px;flex-shrink:0}h2{font:23px Georgia,serif;margin:0}.body{padding:12px 22px 22px;overflow:auto;min-height:0}button{border:1px solid #cbd5bf;background:#f6f8ef;color:#536947;border-radius:6px;padding:8px 12px;font-size:12px}.close{font-size:24px;background:transparent;border:0;padding:0 4px}.primary{background:#536f43;color:white;border-color:#536f43}.danger{color:#934d3c;border-color:#d3b4a8;background:#f8eeea}footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;background:#f0f3e9;border-top:1px solid #dfe5d6;flex-shrink:0}label{font-size:12px;display:block;margin-bottom:8px}input{width:100%;border:1px solid #cbd5bf;border-radius:6px;background:#fffefa;color:#35422e;padding:10px;font:inherit;font-size:13px}.hint{font-size:12px;line-height:1.6;color:#79856d}.error{color:#8d4938;background:#f7e8e0;padding:12px;border-radius:6px;font-size:12px}
</style>
