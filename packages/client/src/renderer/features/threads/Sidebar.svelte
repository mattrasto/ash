<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { isActive, type ThreadChange, type MembershipView, type ThreadView, type TopicView } from '@ash/shared';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import TopicDialog, {type TopicAction} from '../organization/TopicDialog.svelte';
  type Api = <T>(path:string,body?:object)=>Promise<T>;
  let {threads,topics,api,onChanged,onInstructions,onDecisions,decisionsActive,pendingDecisions,selected,connected,creating,readRuns,onSelect,onCreate,onUpdate,onVisibility,onClose}:{threads:ThreadView[];topics:TopicView[];api:Api;onChanged:()=>Promise<void>;onInstructions:(owner:string)=>void;onDecisions:()=>void;decisionsActive:boolean;pendingDecisions:number;selected:string;connected:boolean;creating:boolean;readRuns:Record<string,string>;onSelect:(id:string)=>void;onCreate:(topicId?:string)=>void;onUpdate:(id:string,change:Omit<ThreadChange,'requestId'|'expectedVersion'>)=>Promise<boolean>;onVisibility:(id:string)=>void;onClose:()=>void}=$props();
  let expanded=$state<Record<string,boolean>>({}),topicAction=$state<TopicAction|null>(null);
  let topicMenu=$state<{topic:TopicView;x:number;y:number}|null>(null);
  function expand(id:string,value=true){expanded[id]=value;localStorage.setItem('ash-topics-expanded',JSON.stringify(expanded));}
  function openTopicMenu(event:MouseEvent,topic:TopicView){event.preventDefault();const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();topicMenu={topic,x:event.type==='contextmenu'?event.clientX:rect.left,y:event.type==='contextmenu'?event.clientY:rect.bottom};}
  let width=$state(260),archivedOpen=$state(false),now=$state(Date.now()),reduced=$state(false);
  let menu=$state<{thread:ThreadView;group:string;x:number;y:number}|null>(null),rename=$state(''),renameId=$state(''),title=$state(''),saving=$state(false);
  let input=$state<HTMLInputElement>();
  let membership=$state<{threadId:string;value:MembershipView}|null>(null),membershipLoading=$state(false),linkBusy=$state(false),linkError=$state(''),linkNotice=$state('');
  let loadSequence=0,dragging=$state(''),dropTarget=$state('');
  const dragType='application/x-ash-thread';
  async function loadMembership(threadId:string){
    const sequence=++loadSequence;membershipLoading=true;membership=null;linkError='';
    try{const value=await api<MembershipView>(`threads/${threadId}/topics`);if(sequence===loadSequence)membership={threadId,value};}
    catch(e){if(sequence===loadSequence)linkError=(e as Error).message;}
    finally{if(sequence===loadSequence)membershipLoading=false;}
  }
  async function setLinked(threadId:string,topic:TopicView,checked:boolean,current?:MembershipView){
    if(linkBusy||!connected)return;
    linkBusy=true;linkError='';linkNotice='';
    try{
      const before=current??await api<MembershipView>(`threads/${threadId}/topics`);
      const topicIds=before.topics.map(item=>item.id).filter(id=>id!==topic.id);if(checked)topicIds.push(topic.id);
      const value=await api<MembershipView>(`threads/${threadId}/topics`,{expectedVersion:before.version,topicIds});
      if(menu?.thread.id===threadId)membership={threadId,value};
      if(checked)expand(topic.id);
      await onChanged();linkNotice=`${checked?'Linked to':'Unlinked from'} ${topic.name}`;
    }catch(e){
      const message=(e as Error).message;
      if(menu?.thread.id===threadId)await loadMembership(threadId);
      await onChanged();linkError=message;
    }finally{linkBusy=false;}
  }
  function startDrag(event:DragEvent,thread:ThreadView){
    if(!connected||linkBusy||!event.dataTransfer){event.preventDefault();return;}
    dragging=thread.id;menu=null;topicMenu=null;linkError='';linkNotice='';
    event.dataTransfer.setData(dragType,thread.id);event.dataTransfer.effectAllowed='link';
  }
  function dragOver(event:DragEvent,topic:TopicView){
    if(!dragging||!connected||linkBusy||!event.dataTransfer?.types.includes(dragType))return;
    event.preventDefault();event.dataTransfer.dropEffect='link';dropTarget=topic.id;
  }
  function dropThread(event:DragEvent,topic:TopicView){
    if(!dragging||event.dataTransfer?.getData(dragType)!==dragging)return;
    event.preventDefault();const threadId=dragging;dragging='';dropTarget='';void setLinked(threadId,topic,true);
  }
  let preferencesLoaded=$state(false),revealed:string|undefined;
  $effect(()=>{
    if(!preferencesLoaded||!connected||!threads.some(thread=>thread.id===selected))return;
    // Restoring the sidebar preserves saved expansion; subsequent selection reveals groups.
    if(revealed===undefined){
      revealed=selected;
      for(const topic of topics.filter(topic=>topic.threadIds.includes(selected)&&expanded[topic.id]===undefined))expand(topic.id);
      if(threads.find(thread=>thread.id===selected)?.isArchived)archivedOpen=true;
      return;
    }
    if(selected!==revealed){
      revealed=selected;
      for(const topic of topics.filter(topic=>topic.threadIds.includes(selected)))expand(topic.id);
      if(threads.find(thread=>thread.id===selected)?.isArchived)archivedOpen=true;
    }
  });
  const linked=$derived(new Set(topics.flatMap(topic=>topic.threadIds)));
  const visible=$derived(threads.filter(thread=>!thread.isArchived&&!linked.has(thread.id))),archived=$derived(threads.filter(thread=>thread.isArchived));
  function age(value:string){const minutes=Math.max(0,Math.floor((now-Date.parse(value))/60000));return minutes<1?'just now':minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h`:`${Math.floor(minutes/1440)}d`;}
  function setWidth(value:number){width=Math.min(400,Math.max(200,value));localStorage.setItem('ash-sidebar-width',String(width));}
  function resize(event:PointerEvent){const start=event.clientX,initial=width;const handle=event.currentTarget as HTMLElement;handle.setPointerCapture(event.pointerId);handle.onpointermove=e=>setWidth(initial+e.clientX-start);handle.onlostpointercapture=()=>{handle.onpointermove=null;};}
  async function beginRename(thread:ThreadView,group:string){rename=`${group}:${thread.id}`;renameId=thread.id;title=thread.title;await tick();input?.focus();input?.select();}
  async function saveTitle(){if(!rename||!title.trim()||saving)return;saving=true;try{if(await onUpdate(renameId,{title:title.trim()}))rename='';}finally{saving=false;}}
  function openMenu(event:MouseEvent,thread:ThreadView,group:string){event.preventDefault();loadSequence++;membership=null;membershipLoading=false;linkError='';linkNotice='';const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();menu={thread,group,x:event.type==='contextmenu'?event.clientX:rect.left,y:event.type==='contextmenu'?event.clientY:rect.bottom};}
  onMount(()=>{try{expanded=JSON.parse(localStorage.getItem('ash-topics-expanded')??'{}');}catch{expanded={};}const saved=Number(localStorage.getItem('ash-sidebar-width'));if(saved)setWidth(saved);archivedOpen=localStorage.getItem('ash-archive-open')==='true';preferencesLoaded=true;const media=matchMedia('(prefers-reduced-motion: reduce)');reduced=media.matches;const changed=()=>reduced=media.matches;media.addEventListener('change',changed);const timer=setInterval(()=>now=Date.now(),30000);return()=>{clearInterval(timer);media.removeEventListener('change',changed);};});
</script>
<aside class="sidebar" style:width={`${width}px`} aria-label="Thread sidebar">
  <div class="brand"><span>✳</span> ash <small>DEV</small><button class="icon hide" aria-label="Hide sidebar" title="Hide sidebar" onclick={onClose}><Icon name="sidebar"/></button></div>
  <nav aria-label="Threads">
    <div class="feature-buttons"><button data-open-feature="decisions" aria-current={decisionsActive?'page':undefined} onclick={onDecisions}>Decisions{#if pendingDecisions}<span aria-label={`${pendingDecisions} pending Decisions`}>{pendingDecisions}</span>{/if}</button></div>
    <section class="topics" aria-label="Topics">
      <div class="section-heading"><h2>Topics</h2><button class="icon" aria-label="New Topic" disabled={!connected} onclick={()=>topicAction={kind:'create'}}><Icon name="new"/></button></div>
      {#each topics as topic (topic.id)}
        <section class="topic-group" aria-label={`Topic ${topic.name}`}>
          <!-- The Thread menu provides the keyboard equivalent of dropping onto a Topic. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="topic-row" class:drop-target={dropTarget===topic.id} ondragover={event=>dragOver(event,topic)} ondragleave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))dropTarget='';}} ondrop={event=>dropThread(event,topic)}>
            <button class="topic-toggle" aria-label={`Topic ${topic.name}`} aria-expanded={!!expanded[topic.id]} oncontextmenu={event=>openTopicMenu(event,topic)} onclick={()=>expand(topic.id,!expanded[topic.id])}><span class="chevron">{expanded[topic.id]?'▾':'▸'}</span><span class="title">{topic.name}</span></button>
            <button class="icon topic-actions" aria-label={`Actions for Topic ${topic.name}`} disabled={!connected} onclick={event=>openTopicMenu(event,topic)}><Icon name="more"/></button>
            <button class="icon topic-create" aria-label={`New Thread in ${topic.name}`} title="New Thread" disabled={creating||!connected} onclick={()=>{expand(topic.id);onCreate(topic.id);}}><Icon name="compose"/></button>
          </div>
          {#if expanded[topic.id]}
            <div class="topic-threads">
              {#each threads.filter(thread=>!thread.isArchived&&topic.threadIds.includes(thread.id)) as thread (thread.id)}{@render row(thread,topic.id)}{:else}<p class="topic-empty">No Threads yet</p>{/each}
            </div>
          {/if}
        </section>
      {/each}
    </section>
    <div class="section-heading"><h2>Threads</h2><button class="icon" aria-label="New Thread" title="New Thread · ⌘N" disabled={creating||!connected} onclick={()=>onCreate()}><Icon name="new"/></button></div>
    {#each visible as thread (thread.id)}<div onintrostart={event=>{event.currentTarget.removeAttribute("aria-hidden");event.currentTarget.inert=false;}} onoutrostart={event=>{event.currentTarget.setAttribute("aria-hidden","true");event.currentTarget.inert=true;}} animate:flip={{duration:reduced?0:240}} transition:fly={{x:-16,duration:reduced?0:180}}>{@render row(thread,'')}</div>{/each}
    {#if !visible.length}<p class="empty">No unlinked Threads</p>{/if}
    {#if archived.length}<button class="archive-heading" aria-expanded={archivedOpen} onclick={()=>{archivedOpen=!archivedOpen;localStorage.setItem('ash-archive-open',String(archivedOpen));}}>{archivedOpen?'▾':'▸'} Archived ({archived.length}){#if archived.some(t=>t.unread)} · {archived.filter(t=>t.unread).length} unread{/if}</button>{#if archivedOpen}{#each archived as thread (thread.id)}{@render row(thread,'archived')}{/each}{/if}{/if}
  </nav>
  {#if !menu&&linkError}<p class="link-error" role="alert">{linkError}</p>{/if}
  {#if linkBusy&&!menu}<p class="link-status" role="status">Saving Topic link…</p>{:else if linkNotice}<p class="link-status" role="status">{linkNotice}</p>{/if}

  <!-- Focusable separator follows the ARIA window-splitter keyboard pattern. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="resize" role="separator" tabindex="0" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin="200" aria-valuemax="400" aria-valuenow={width} onpointerdown={resize} ondblclick={()=>setWidth(260)} onkeydown={e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();setWidth(e.key==='Home'?260:width+(e.key==='ArrowRight'?10:-10));}}}></div>
</aside>
{#snippet row(thread:ThreadView,group:string)}
  {@const running=thread.activeWork??(!!thread.latestRun&&isActive(thread.latestRun.status))}
  {@const unread=thread.unread??(!!thread.latestRun&&!running&&readRuns[thread.id]!==thread.latestRun.id)}
  <div class="row" class:selected={!decisionsActive&&selected===thread.id} class:unread={unread&&(decisionsActive||selected!==thread.id)}>
    {#if rename===`${group}:${thread.id}`}<form onsubmit={e=>{e.preventDefault();void saveTitle();}}><input aria-label="Thread title" bind:this={input} bind:value={title} maxlength="160" disabled={saving} onkeydown={e=>{if(e.key==='Escape'){e.preventDefault();rename='';}}}/><button disabled={saving||!title.trim()} aria-label="Save title">Save</button><button type="button" aria-label="Cancel rename" onclick={()=>rename=''}>×</button></form>
    {:else}<button class="select" draggable={connected&&!linkBusy} ondragstart={event=>startDrag(event,thread)} ondragend={()=>{dragging='';dropTarget='';}} aria-label={thread.title} aria-current={!decisionsActive&&selected===thread.id?'page':undefined} title={thread.title} oncontextmenu={e=>openMenu(e,thread,group)} onclick={()=>onSelect(thread.id)}><span class="title">{thread.isPinned?'⌖ ':''}{thread.title}</span><span class="activity">{#if running}<span class="dot pulse" role="status" aria-label="Response in progress"></span>{:else if unread&&(decisionsActive||selected!==thread.id)}<span class="dot" aria-label="Unread response"></span>{/if}<time datetime={thread.updatedAt}>{age(thread.updatedAt)}</time></span></button><div class="row-actions"><button class="icon" aria-label={`${thread.isArchived?'Unarchive':'Archive'} ${thread.title}`} title={thread.isArchived?'Unarchive':'Archive'} onclick={()=>onUpdate(thread.id,{isArchived:!thread.isArchived})}><Icon name={thread.isArchived?'restore':'archive'} size={15}/></button><button class="icon" data-thread-actions={thread.id} aria-label={`Actions for ${thread.title}`} title="Thread actions" onclick={e=>openMenu(e,thread,group)}><Icon name="more" size={15}/></button></div>{/if}
  </div>
{/snippet}
{#if menu}{@const target=menu.thread}{@const group=menu.group}<Menu x={menu.x} y={menu.y} fallbackFocus={()=>document.querySelector<HTMLButtonElement>(`[data-thread-actions="${target.id}"]`)?.focus({preventScroll:true})} onClose={()=>menu=null} items={[
  {label:'Topics',disabled:!connected,submenu:{onOpen:()=>void loadMembership(target.id),status:membershipLoading?'Loading Topics…':!topics.length?'No Topics yet':undefined,error:linkError,items:topics.map(topic=>({label:topic.name,checked:membership?.threadId===target.id&&membership.value.topics.some(item=>item.id===topic.id),disabled:linkBusy||membershipLoading||membership?.threadId!==target.id,action:()=>void setLinked(target.id,topic,!membership?.value.topics.some(item=>item.id===topic.id),membership?.value)}))}},
  {label:'Instructions',disabled:!connected,action:()=>onInstructions(`thread:${target.id}`)},
  {label:target.isPinned?'Unpin':'Pin',disabled:!connected,action:()=>void onUpdate(target.id,{isPinned:!target.isPinned})},
  {label:'Visibility and naming',action:()=>onVisibility(target.id)},
  {label:'Rename',action:()=>void beginRename(target,group)},
  {label:'Automatic name',checked:target.lifecycle?.titleMode==='automatic',disabled:!connected||target.lifecycle?.titleMode==='automatic',action:()=>void onUpdate(target.id,{automaticName:true})},
]}/>{/if}
{#if topicMenu}{@const target=topicMenu.topic}<Menu x={topicMenu.x} y={topicMenu.y} onClose={()=>topicMenu=null} items={[
  {label:'Instructions',action:()=>onInstructions(`topic:${target.id}`)},
  {label:'Rename',action:()=>topicAction={kind:'rename',topic:target}},
  {label:'Delete Topic',action:()=>topicAction={kind:'delete',topic:target}},
]}/>{/if}
{#if topicAction}<TopicDialog action={topicAction} {api} {onChanged} onClose={()=>topicAction=null} onCreated={id=>expand(id)}/>{/if}
<style>
  .feature-buttons{display:flex;flex-direction:column;gap:3px;margin:0 0 18px}.feature-buttons button{display:flex;justify-content:space-between;align-items:center;border:0;background:transparent;color:#526347;padding:9px 8px;text-align:left;border-radius:6px;font:inherit;font-size:12px}.feature-buttons button[aria-current=page]{background:#dfe5d7;font-weight:600}.feature-buttons button:hover{background:#dfe5d7}.feature-buttons span{font-size:10px;background:#d5e2c9;border-radius:10px;padding:2px 6px}
  .topics{margin-bottom:18px}.topic-create,.topic-actions{flex-shrink:0;opacity:0}.topic-row.drop-target{background:#d7e6ca;outline:2px solid var(--accent);outline-offset:-2px}.link-error,.link-status{font-size:11px;line-height:1.5;padding:8px;margin:5px 0;overflow-wrap:anywhere}.link-error{color:#934d3c}.link-status{color:#66765b}.topic-row{display:flex;align-items:center;border-radius:6px}.topic-row:hover{background:#e3e8dd}.topic-toggle{display:flex;align-items:center;gap:7px;min-width:0;flex:1;border:0;background:transparent;color:#596352;text-align:left;padding:10px 6px;font-size:12px}.chevron{color:#89927e;width:10px;flex-shrink:0}.topic-row:hover .topic-actions,.topic-row:hover .topic-create,.topic-row:focus-within .topic-actions,.topic-row:focus-within .topic-create{opacity:1}.topic-threads{margin-left:13px;padding-left:5px;border-left:1px solid #d4dccb}.topic-empty{font-size:11px;color:#89927e;padding:0 10px 6px}
  .sidebar{position:relative;flex-shrink:0;background:#eceee7;border-right:1px solid #dde0d6;padding:34px 12px 12px;display:flex;flex-direction:column;min-width:200px;max-width:40vw}.brand{display:flex;align-items:center;gap:8px;font-size:28px;font-weight:600;padding:0 8px 24px}.brand>span{color:var(--accent);font-size:34px}.brand small{font-size:9px;letter-spacing:1px;color:#7b8970}.icon{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:5px;background:transparent;color:#73826b;padding:6px}.icon:hover{background:#dfe5d7}.hide{margin-left:auto}.section-heading{display:flex;justify-content:space-between;align-items:center;padding:0 6px 5px;margin-bottom:8px;border-bottom:1px solid #d6ddce}.section-heading h2{margin:0;color:#536248;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase}.section-heading>.icon{opacity:0}.section-heading:hover>.icon,.section-heading:focus-within>.icon{opacity:1}nav{flex:1;overflow:auto;scrollbar-width:thin}.row{display:flex;position:relative;border-radius:7px;margin:2px 0}.row.selected{background:#dfe5d7}.row:hover{background:#e3e8dd}.select{display:flex;gap:8px;align-items:center;justify-content:space-between;min-width:0;flex:1;text-align:left;border:0;background:transparent;color:#596352;padding:12px 10px;font-size:12px}.title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity{display:flex;gap:5px;align-items:center;flex-shrink:0}time{font-size:9px;color:#89927e}.row-actions{display:flex;align-items:center;position:absolute;right:3px;top:6px;opacity:0;background:#e3e8dd;border-radius:5px}.selected .row-actions{background:#dfe5d7}.row:hover .row-actions,.row:focus-within .row-actions{opacity:1}.row:hover .activity,.row:focus-within .activity{visibility:hidden}.select{padding-right:12px}.row:hover .select,.row:focus-within .select{padding-right:64px}.unread .title{font-weight:600}.dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}.pulse{animation:pulse 1.4s ease-in-out infinite}.archive-heading{display:block;text-align:left;width:100%;padding:20px 8px 10px;border:0;background:transparent;color:#7c8973;font-size:10px}.empty{font-size:12px;color:#89927e;padding:10px}.resize{position:absolute;right:-3px;top:0;bottom:0;width:6px;cursor:col-resize;z-index:3;touch-action:none}.resize:hover{background:#75886925}form{display:flex;gap:4px;padding:7px;width:100%}input{width:100%;min-width:0;border:1px solid #a9b59e;border-radius:4px;background:#fafcf5;padding:6px;font:inherit;font-size:12px}form button{border:0;background:transparent;color:var(--accent);font-size:10px}@keyframes pulse{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){.pulse{animation:none}}
</style>
