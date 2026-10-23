<script lang="ts">
  import {dialogDismiss} from '../../ui/dismiss.ts';
  import Icon from "../../ui/Icon.svelte";
  import Status from "../../ui/Status.svelte";
  import {replaceContent} from "../../ui/replacement.ts";
  import {selectField} from '../../ui/select.ts';
  import {surface,mist} from '../../ui/surface.ts';
  import {scrollArea} from '../../ui/scroll.ts';
  import { onMount,tick } from 'svelte';
  import type { OwnedInstruction, ThreadView, TopicView, SavePermission } from '@ash/shared';
  import PermissionsEditor from '../permissions/Editor.svelte';
  type Api = <T>(path:string,body?:object)=>Promise<T>;
  let {api,thread,threads,initialOwner='global:response',initialTab='instructions',initialRule,captureMic=true,onCaptureMic,onChanged,onClose}:{api:Api;thread:ThreadView|null;threads:ThreadView[];initialOwner?:string;initialTab?:'instructions'|'permissions';initialRule?:SavePermission;captureMic?:boolean;onCaptureMic?:(value:boolean)=>void;onChanged:()=>Promise<void>;onClose:()=>void}=$props();
  let dialog:HTMLDialogElement;
  let editorFrame:HTMLDivElement;
  let topics=$state<TopicView[]>([]);
  let ownerKey=$state('global:response'),saved=$state<OwnedInstruction|null>(null),text=$state('');
  let busy=$state(false),loading=$state(true),error=$state(''),notice=$state(''),conflict=$state(false);
  let pendingMove=$state<(()=>void)|null>(null);
  let tab=$state<'instructions'|'permissions'>('instructions'),permissionDraft=$state(false),permissionBusy=$state(false);
  let permissionEditor:{saveBeforeLeaving:()=>Promise<boolean>;discardDraft:()=>void}|undefined=$state();
  const dirty=$derived(!!saved && text !== (saved.document?.text??''));
  const working=$derived(busy||permissionBusy);
  const scope=$derived(ownerKey.split(':')[0]);
  const selectedTopic=$derived(topics.find(topic=>ownerKey===`topic:${topic.id}`));
  const selectedThread=$derived(threads.find(item=>ownerKey===`thread:${item.id}`));
  const title=$derived(scope==='topic'?selectedTopic?.name??'Topic':scope==='thread'?selectedThread?.title??'Thread':saved?.document?.name??'Global guidance');
  const purpose=$derived(scope==='topic'?'Guides autonomous placement of incoming items. Topic membership remains manual.':scope==='thread'?'Applies to this thread. Thread guidance takes priority over global response guidance.':ownerKey==='global:response'?'Applies to chat responses. Individual threads can add more specific guidance.':ownerKey==='global:engine-filter'?'Assesses incoming relevance; dropped sources remain inspectable.':ownerKey==='global:engine-route'?'Chooses an existing or new Thread autonomously and records assumptions.':ownerKey==='global:engine-assess'?'Chooses useful work, source visibility and response visibility separately.':ownerKey==='global:thread-visibility'?'Assesses how long a Thread remains useful. Pinning and visibility protection apply separately.':ownerKey==='global:thread-naming'?'Names Threads on the independent Fibonacci message schedule. Manual names remain yours.':ownerKey==='global:video-caption'?'Applies to background video captions and narration.':ownerKey==='global:video-understanding'?'Applies to video understanding tools.':'Applies only when describing uploaded images.');
  async function loadValue(key:string) {
    loading=true;error='';notice='';conflict=false;
    try {const value=await api<OwnedInstruction>(`instructions/${key.replace(':','/')}`);ownerKey=key;saved=value;text=value.document?.text??'';}
    catch(e){error=(e as Error).message;}
    finally{loading=false;}
  }
  async function load(key:string){await replaceContent(editorFrame,()=>loadValue(key),{resize:false});}
  function move(action:()=>void) {if(working||loading)return;if(dirty||permissionDraft)pendingMove=action;else action();}
  async function saveMove(){if(working)return;if(tab==='instructions'){await save(true);return;}if(await permissionEditor?.saveBeforeLeaving()){const next=pendingMove;pendingMove=null;next?.();}}
  function tabKey(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'instructions':event.key==='End'?'permissions':tab==='instructions'?'permissions':'instructions';move(()=>{tab=next;void tick().then(()=>document.getElementById(`settings-${next}`)?.focus());});}
  async function save(continueAfter=false) {
    if(!saved||busy)return false;
    busy=true;error='';notice='';
    try {
      saved=await api<OwnedInstruction>('instructions',{owner:saved.owner,text,expected:saved.document?{id:saved.document.id,updatedAt:saved.document.updatedAt}:null});
      text=saved.document?.text??'';notice='Instructions saved';conflict=false;
      if(continueAfter){const next=pendingMove;pendingMove=null;next?.();}
      return true;
    }catch(e){error=(e as Error).message;conflict=true;return false;}
    finally{busy=false;}
  }
  async function compareSaved() {
    busy=true;error='';
    try {saved=await api<OwnedInstruction>(`instructions/${ownerKey.replace(':','/')}`);notice='Saved text refreshed below. Your draft is preserved; compare before saving.';}
    catch(e){error=(e as Error).message;}finally{busy=false;}
  }
  function discardMove(){if(working)return;if(tab==='permissions')permissionEditor?.discardDraft();else text=saved?.document?.text??'';permissionDraft=false;const next=pendingMove;pendingMove=null;next?.();}
  onMount(()=>{
    tab=initialTab;const before=document.activeElement as HTMLElement|null;dialog.showModal();
    void (async()=>{try{topics=await api<TopicView[]>('topics');await load(initialOwner);}catch(e){error=(e as Error).message;loading=false;}})();
    return()=>before?.focus({preventScroll:true});
  });
</script>

<dialog bind:this={dialog} aria-label="Settings" oncancel={event=>{event.preventDefault();move(onClose);}} use:dialogDismiss={()=>move(onClose)} use:surface={{dense:true}} transition:mist={{role:"large"}}><div class="surface-content">
  <header><div><h2>Settings</h2></div><button class="ash-button ash-ghost ash-icon close ash-close" aria-label="Close Settings" disabled={working||loading} onclick={()=>move(onClose)}><Icon name="close"/></button></header>
  <div class="tabs" role="tablist" aria-label="Settings views">{#each ['instructions','permissions'] as name}<button role="tab" id={`settings-${name}`} aria-controls="settings-content" aria-selected={tab===name} tabindex={tab===name?0:-1} disabled={working||loading||!!pendingMove} onkeydown={tabKey} onclick={()=>move(()=>tab=name as typeof tab)} class="ash-button">{name==='instructions'?'Instructions':'Permissions'}</button>{/each}</div>
  <div use:scrollArea class="body">
    <div bind:this={editorFrame} role="tabpanel" id="settings-content" aria-labelledby={`settings-${tab}`}>
    {#if tab==='permissions'}<PermissionsEditor bind:this={permissionEditor} bind:busy={permissionBusy} {api} {initialRule} {onChanged} onDraftChange={value=>permissionDraft=value}/>{:else}
    {#if error}<div class="error" role="alert"><Status announce={false} label="Action failed">{error}</Status></div>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      <label for="instruction-owner">Instruction owner</label>
      <select use:selectField id="instruction-owner" value={ownerKey} disabled={loading||busy||!!pendingMove} onchange={event=>{const key=event.currentTarget.value;event.currentTarget.value=ownerKey;move(()=>void load(key));}} class="ash-field">
        <optgroup label="Global"><option value="global:response">Response guidance</option><option value="global:image-description">Image descriptions</option><option value="global:video-caption">Video captions and narration</option><option value="global:video-understanding">Video understanding</option><option value="global:engine-filter">Incoming Filter</option><option value="global:engine-route">Incoming Route</option><option value="global:engine-assess">Incoming action and presentation</option><option value="global:thread-visibility">Thread visibility</option><option value="global:thread-naming">Thread naming</option></optgroup>
        {#if topics.length}<optgroup label="Topics · routing">{#each topics as topic}<option value={`topic:${topic.id}`}>{topic.name}</option>{/each}</optgroup>{/if}
        {#if threads.length}<optgroup label="Threads">{#each threads as item}<option value={`thread:${item.id}`}>{item.title}{item.id===thread?.id?' · current':''}</option>{/each}</optgroup>{/if}
      </select>
      <h3>{title}</h3><p class="hint">{purpose}</p>
      {#if loading}<p>Loading instructions…</p>{:else if saved}
        <label class="sr-only" for="instruction-text">Instruction text</label><textarea id="instruction-text" bind:value={text} maxlength={ownerKey==='global:image-description'?3000:12000} disabled={busy} spellcheck="false" placeholder={scope==='topic'?'Describe where items and threads belong…':'Add guidance…'} class="ash-field"></textarea>
        <div class="editor-meta"><span>{text.length.toLocaleString()} characters{dirty?' · Unsaved changes':''}</span></div>
        {#if conflict}<button disabled={busy} onclick={compareSaved} class="ash-button">Compare latest saved text</button><details open><summary>Saved text</summary><pre>{saved.document?.text??'(No saved document)'}</pre></details>{/if}
      {/if}
      {#if onCaptureMic}<section class="recording-settings"><h3>Screen recording</h3><label><input type="checkbox" checked={captureMic} onchange={event=>onCaptureMic?.(event.currentTarget.checked)} class="ash-choice"/> Include microphone audio</label><p class="hint">Saved on this device. Record screen starts with this setting.</p></section>{/if}
    {/if}</div>
  </div>
  {#if pendingMove || tab==='instructions'}<footer>
    {#if pendingMove}<div class="unsaved" role="alert"><p>Save your {tab==='permissions'?'permission':'instruction'} changes before leaving?</p><button class="ash-button ash-primary primary" disabled={working} onclick={()=>void saveMove()}>Save and continue</button><button disabled={working} onclick={discardMove} class="ash-button">Discard changes</button><button disabled={working} onclick={()=>pendingMove=null} class="ash-button">Keep editing</button></div>
    {:else if tab==='instructions'}<button disabled={busy||loading||!dirty} onclick={()=>{text=saved?.document?.text??'';error='';notice='';conflict=false;}} class="ash-button">Cancel changes</button><button class="ash-button ash-primary primary" disabled={busy||loading||!dirty} onclick={()=>void save()}>Save instructions</button>
    {/if}
  </footer>{/if}
</div></dialog>

<style>
  .tabs{display:flex;gap:24px;margin:0 28px;border-bottom:1px solid var(--divider);flex-shrink:0}.tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:12px 0}.tabs button[aria-selected=true]{border-bottom-color:var(--accent);font-weight:525}
  dialog{border:1px solid var(--divider);border-radius:16px;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);width:min(1080px,calc(100vw - 40px));height:min(860px,calc(100vh - 48px));max-height:calc(100vh - 48px);overflow:hidden;padding:0;box-shadow:0 20px 70px color-mix(in srgb,var(--shadow) 25%,transparent)}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#25302077;backdrop-filter:blur(3px)}header{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;padding:22px 28px 14px}h2{font:525 1.4rem/1.25 var(--font);margin:5px 0 0}.close{font-size:26px;background:transparent;border:0;padding:0 8px}.body{flex:1;padding:20px 28px;overflow:auto;scrollbar-gutter:stable;min-height:0}label{display:block;font-size:.9rem;font-weight:525;margin-bottom:8px}button{border:1px solid var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);border-radius:6px;padding:8px 12px;font-size:.9rem}.primary{background:color-mix(in srgb,var(--control) 35%,transparent);color:white;border-color:var(--divider)}select,textarea{border:1px solid var(--divider);border-radius:6px;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);padding:9px;font:inherit}select{width:100%;font-size:1rem}h3{font-size:15px;margin:22px 0 8px;font-weight:525;overflow-wrap:anywhere}.hint{font-size:.9rem;line-height:1.6;color:var(--text);margin:0 0 16px}textarea{width:100%;min-height:180px;height:200px;resize:vertical;font-size:1rem;line-height:1.65}.editor-meta{display:flex;justify-content:space-between;font-size:.8rem;color:var(--text);margin:8px 0 12px}.error{color:var(--danger);background:color-mix(in srgb,var(--control) 35%,transparent);padding:12px;border-radius:6px;font-size:.9rem}.notice{color:var(--text);font-size:.9rem}footer{flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding:16px 28px;border-top:1px solid var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent)}.unsaved{width:100%;font-size:1rem}.unsaved p{margin:0 0 12px}.unsaved button{margin-right:6px;margin-bottom:4px}details{margin-top:12px;font-size:.9rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-size:.9rem;background:color-mix(in srgb,var(--control) 35%,transparent);padding:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:760px){header,.body{padding-left:18px;padding-right:18px}footer{padding-left:18px;padding-right:18px}textarea{min-height:130px}.editor-meta{gap:12px}}
</style>
