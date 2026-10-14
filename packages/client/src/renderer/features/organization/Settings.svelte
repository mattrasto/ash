<script lang="ts">
  import { onMount } from 'svelte';
  import type { OwnedInstruction, ThreadView, TopicView } from '@ash/shared';
  type Api = <T>(path:string,body?:object)=>Promise<T>;
  let {api,thread,threads,initialOwner='global:response',onClose}:{api:Api;thread:ThreadView|null;threads:ThreadView[];initialOwner?:string;onClose:()=>void}=$props();
  let dialog:HTMLDialogElement;
  let topics=$state<TopicView[]>([]);
  let ownerKey=$state('global:response'),saved=$state<OwnedInstruction|null>(null),text=$state('');
  let busy=$state(false),loading=$state(true),error=$state(''),notice=$state(''),conflict=$state(false);
  let pendingMove=$state<(()=>void)|null>(null);
  const dirty=$derived(!!saved && text !== (saved.document?.text??''));
  const scope=$derived(ownerKey.split(':')[0]);
  const selectedTopic=$derived(topics.find(topic=>ownerKey===`topic:${topic.id}`));
  const selectedThread=$derived(threads.find(item=>ownerKey===`thread:${item.id}`));
  const title=$derived(scope==='topic'?selectedTopic?.name??'Topic':scope==='thread'?selectedThread?.title??'Thread':ownerKey==='global:response'?'Global response guidance':'Image description guidance');
  const purpose=$derived(scope==='topic'?'Routing guidance · Saved for the Route layer. Organization is manual in this phase.':scope==='thread'?'Applies to this thread. Thread guidance takes priority over global response guidance.':ownerKey==='global:response'?'Applies to chat responses. Individual threads can add more specific guidance.':'Applies only when describing uploaded images.');
  async function load(key:string) {
    loading=true;error='';notice='';conflict=false;
    try {const value=await api<OwnedInstruction>(`instructions/${key.replace(':','/')}`);ownerKey=key;saved=value;text=value.document?.text??'';}
    catch(e){error=(e as Error).message;}
    finally{loading=false;}
  }
  function move(action:()=>void) {if(busy||loading)return;if(dirty)pendingMove=action;else action();}
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
  function discardMove(){text=saved?.document?.text??'';const next=pendingMove;pendingMove=null;next?.();}
  onMount(()=>{
    const before=document.activeElement as HTMLElement|null;dialog.showModal();
    void (async()=>{try{topics=await api<TopicView[]>('topics');await load(initialOwner);}catch(e){error=(e as Error).message;loading=false;}})();
    return()=>before?.focus({preventScroll:true});
  });
</script>

<dialog bind:this={dialog} aria-label="Settings" oncancel={event=>{event.preventDefault();move(onClose);}}>
  <header><div><span class="eyebrow">ASH</span><h2>Settings</h2></div><button class="close" aria-label="Close Settings" disabled={busy||loading} onclick={()=>move(onClose)}>×</button></header>
  <div class="body">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      <label for="instruction-owner">Instruction owner</label>
      <select id="instruction-owner" value={ownerKey} disabled={loading||busy||!!pendingMove} onchange={event=>{const key=event.currentTarget.value;event.currentTarget.value=ownerKey;move(()=>void load(key));}}>
        <optgroup label="Global"><option value="global:response">Response guidance</option><option value="global:image-description">Image descriptions</option></optgroup>
        {#if topics.length}<optgroup label="Topics · routing">{#each topics as topic}<option value={`topic:${topic.id}`}>{topic.name}</option>{/each}</optgroup>{/if}
        {#if threads.length}<optgroup label="Threads">{#each threads as item}<option value={`thread:${item.id}`}>{item.title}{item.id===thread?.id?' · current':''}</option>{/each}</optgroup>{/if}
      </select>
      <h3>{title}</h3><p class="hint">{purpose}</p>
      {#if loading}<p>Loading instructions…</p>{:else if saved}
        <label class="sr-only" for="instruction-text">Instruction text</label><textarea id="instruction-text" bind:value={text} maxlength={ownerKey==='global:image-description'?3000:12000} disabled={busy} spellcheck="false" placeholder={scope==='topic'?'Describe where items and threads belong…':'Add guidance…'}></textarea>
        <div class="editor-meta"><span>{text.length.toLocaleString()} characters{dirty?' · Unsaved changes':''}</span><span>Owned independently</span></div>
        <p class="hint authority">Instructions do not grant tool permissions.</p>
        {#if conflict}<button disabled={busy} onclick={compareSaved}>Compare latest saved text</button><details open><summary>Saved text</summary><pre>{saved.document?.text??'(No saved document)'}</pre></details>{/if}
      {/if}
  </div>
  <footer>
    {#if pendingMove}<div class="unsaved" role="alert"><p>Save your instruction changes before leaving?</p><button class="primary" disabled={busy} onclick={()=>void save(true)}>Save and continue</button><button disabled={busy} onclick={discardMove}>Discard changes</button><button disabled={busy} onclick={()=>pendingMove=null}>Keep editing</button></div>
    {:else}<button disabled={busy||loading||!dirty} onclick={()=>{text=saved?.document?.text??'';error='';notice='';conflict=false;}}>Cancel changes</button><button class="primary" disabled={busy||loading||!dirty} onclick={()=>void save()}>Save instructions</button>
    {/if}
  </footer>
</dialog>

<style>
  dialog{border:1px solid #cdd6c4;border-radius:16px;background:#f7f8f2;color:#35422e;width:min(760px,calc(100vw - 40px));height:min(640px,calc(100vh - 48px));max-height:calc(100vh - 48px);overflow:hidden;padding:0;box-shadow:0 20px 70px #23301e40}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#25302077;backdrop-filter:blur(3px)}header{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;padding:22px 28px 14px}.eyebrow{font-size:10px;letter-spacing:2px;color:#7b8b70}h2{font:28px Georgia,serif;margin:5px 0 0}.close{font-size:26px;background:transparent;border:0;padding:0 8px}.body{flex:1;padding:20px 28px;overflow:auto;scrollbar-gutter:stable;min-height:0}label{display:block;font-size:12px;font-weight:600;margin-bottom:8px}button{border:1px solid #cbd5bf;background:#f6f8ef;color:#536947;border-radius:6px;padding:8px 12px;font-size:12px}button:hover{background:#e6ecdf}.primary{background:#536f43;color:white;border-color:#536f43}select,textarea{border:1px solid #cbd5bf;border-radius:6px;background:#fffefa;color:#35422e;padding:9px;font:inherit}select{width:100%;font-size:13px}h3{font-size:15px;margin:22px 0 8px;font-weight:600;overflow-wrap:anywhere}.hint{font-size:12px;line-height:1.6;color:#79856d;margin:0 0 16px}textarea{width:100%;min-height:180px;height:200px;resize:vertical;font-size:13px;line-height:1.65}.editor-meta{display:flex;justify-content:space-between;font-size:10px;color:#89947d;margin:8px 0 12px}.authority{margin-bottom:0}.error{color:#8d4938;background:#f7e8e0;padding:12px;border-radius:6px;font-size:12px}.notice{color:#536f43;font-size:12px}footer{flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding:16px 28px;border-top:1px solid #dfe5d6;background:#f0f3e9}.unsaved{width:100%;font-size:13px}.unsaved p{margin:0 0 12px}.unsaved button{margin-right:6px;margin-bottom:4px}details{margin-top:12px;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-size:12px;background:#edf1e6;padding:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:760px){header,.body{padding-left:18px;padding-right:18px}footer{padding-left:18px;padding-right:18px}textarea{min-height:130px}.editor-meta{gap:12px}}
</style>
