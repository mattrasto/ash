<script module lang="ts">
  import type { TopicView } from '@ash/shared';
  export type TopicAction = {kind:'create'} | {kind:'rename'|'delete';topic:TopicView};
</script>
<script lang="ts">
  import {dialogDismiss} from '../../ui/dismiss.ts';
  import Icon from "../../ui/Icon.svelte";
  import Status from "../../ui/Status.svelte";
  import {surface,mist} from '../../ui/surface.ts';
  import {scrollArea} from '../../ui/scroll.ts';
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
<dialog bind:this={dialog} aria-label={title} oncancel={event=>{event.preventDefault();if(!busy)onClose();}} use:dialogDismiss={()=>{if(!busy)onClose();}} use:surface={{dense:true}} transition:mist><div class="surface-content">
  <header><h2>{title}</h2><button class="ash-button ash-ghost ash-icon close ash-close" aria-label={`Close ${title}`} disabled={busy} onclick={onClose}><Icon name="close"/></button></header>
  <div use:scrollArea class="body">
    {#if error}<div class="error" role="alert"><Status announce={false} label="Action failed">{error}</Status></div>{#if target}<p class="hint">Current Topic name: {target.name}</p>{/if}{/if}
    {#if action.kind==='delete'}
      <p>Delete “{target?.name}”?</p><p class="hint">Threads, images and captured context will remain.</p>
    {:else}
      <form id="topic-form" onsubmit={event=>{event.preventDefault();void save();}}><label for="topic-name">Topic name</label><input id="topic-name" bind:value={name} maxlength="160" disabled={busy} placeholder="e.g. Insurance" class="ash-field"/></form>
    {/if}
  </div>
  <footer><button disabled={busy} onclick={onClose} class="ash-button">Cancel</button>{#if action.kind==='delete'}<button class="ash-button ash-danger danger" disabled={busy} onclick={()=>void save()}>Delete Topic</button>{:else}<button class="ash-button ash-primary primary" form="topic-form" disabled={busy||!name.trim()}>{action.kind==='create'?'Create Topic':'Save name'}</button>{/if}</footer>
</div></dialog>
<style>
  dialog{border:1px solid var(--divider);border-radius:14px;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);width:min(440px,calc(100vw - 40px));max-height:calc(100vh - 48px);padding:0;overflow:hidden;box-shadow:0 20px 70px color-mix(in srgb,var(--shadow) 25%,transparent)}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#25302077;backdrop-filter:blur(3px)}header{display:flex;justify-content:space-between;align-items:center;padding:20px 22px 10px;flex-shrink:0}h2{font:525 1.4rem/1.25 var(--font);margin:0}.body{padding:12px 22px 22px;overflow:auto;min-height:0}button{border:1px solid var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);border-radius:6px;padding:8px 12px;font-size:.9rem}.close{font-size:24px;background:transparent;border:0;padding:0 4px}.primary{background:color-mix(in srgb,var(--control) 35%,transparent);color:white;border-color:var(--divider)}.danger{color:var(--danger);border-color:var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent)}footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;background:color-mix(in srgb,var(--control) 35%,transparent);border-top:1px solid var(--divider);flex-shrink:0}label{font-size:.9rem;display:block;margin-bottom:8px}input{width:100%;border:1px solid var(--divider);border-radius:6px;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);padding:10px;font:inherit;font-size:1rem}.hint{font-size:.9rem;line-height:1.6;color:var(--muted)}.error{color:var(--danger);background:color-mix(in srgb,var(--control) 35%,transparent);padding:12px;border-radius:6px;font-size:.9rem}
</style>
