<script lang="ts">
 import Rail from '../../ui/Rail.svelte';
  import Icon from "../../ui/Icon.svelte";
  import Status from "../../ui/Status.svelte";
  import {surface,mist} from '../../ui/surface.ts';
  import {scrollArea} from '../../ui/scroll.ts';
 import { hasDraft,type ApplicationChangeView,type AssessmentView,type ThreadView,type ThreadChange } from '@ash/shared';
 let {thread,api,onClose,onChange,onInspect,onInspectChange}:{thread:ThreadView|undefined;api:<T>(path:string,body?:object)=>Promise<T>;onClose:()=>void;onChange:(change:Omit<ThreadChange,'requestId'|'expectedVersion'>)=>Promise<boolean>;onInspect:(id:string)=>void;onInspectChange:(id:string)=>void}=$props();
 let attempts=$state<AssessmentView[]>([]),changes=$state<ApplicationChangeView[]>([]),error=$state('');
 const lifecycle=$derived(thread?.lifecycle);
 const threadId=$derived(thread?.id);
 let now=$state(Date.now());
 const unreadUntil=$derived(thread?.unread&&lifecycle?.unreadAt?Date.parse(lifecycle.unreadAt)+86400000:0);
 const draft=$derived(lifecycle?hasDraft(lifecycle):false);
 const held=$derived(thread?.isPinned||thread?.activeWork||thread?.waitingWork||draft);
 const deadline=$derived(lifecycle?.deadline?Date.parse(lifecycle.deadline):0);
 $effect(()=>{
  const id=threadId;attempts=[];changes=[];error='';if(!id)return;
  let current=true,timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{
   now=Date.now();
   try{const result=await Promise.all([api<AssessmentView[]>(`threads/${id}/assessments`),api<ApplicationChangeView[]>(`threads/${id}/changes`)]);if(current){[attempts,changes]=result;error='';}}
   catch(e){if(current)error=(e as Error).message;}
   finally{if(current)timer=setTimeout(()=>void refresh(),2000);}
  };
  void refresh();return()=>{current=false;clearTimeout(timer);};
 });
</script>
<Rail side="right" className="visibility-rail" width="min(360px,100vw)"><aside aria-label="Thread visibility" class="visibility" use:surface={{dense:true}} transition:mist={{role:"large"}}><div use:scrollArea class="surface-content">
 <header><h2>Visibility and naming</h2><button aria-label="Close visibility" onclick={onClose} class="ash-button ash-ghost ash-icon ash-close"><Icon name="close"/></button></header>
 {#if thread&&lifecycle}
  <h3>{thread.title}</h3>
  <p>{thread.isArchived?`Archived ${lifecycle.origin==='automatic'?'automatically':'manually'}`:'Visible'}{thread.isPinned?' · Pinned':''}</p>
  <p>{lifecycle.kind==='pending'?'Waiting for assessment':lifecycle.kind==='failed'?`Assessment unavailable${thread.isArchived?'':'; kept visible'}`:lifecycle.kind==='indefinite'?(thread.isArchived?'No automatic archive target':'Visible indefinitely'):held||thread.isArchived?`Assessed archive target: ${lifecycle.kind==='immediate'?'immediate':new Date(deadline).toLocaleString()}`:`Scheduled archive: ${Math.max(deadline,unreadUntil)<=now?'now':new Date(Math.max(deadline,unreadUntil)).toLocaleString()}`}</p>
  {#if draft}<p>{thread.isArchived?'Draft saved. Sending it will revive this Thread.':'A saved draft keeps this Thread visible until sent or cleared. Manual Archive still works.'}</p>{/if}
  {#if thread.isPinned}<p>Pinning pauses automatic archiving.</p>{/if}
  {#if !thread.isArchived&&deadline&&unreadUntil>now}<p>{unreadUntil>deadline?`Unread protection delays archiving until ${new Date(unreadUntil).toLocaleString()}. Reading removes this delay; the assessed target still applies.`:'Unread protection ends before the archive target, so it adds no delay.'}</p>{/if}
  {#if thread.activeWork}<p>Automatic archiving waits for work to finish.</p>{/if}
  {#if thread.waitingWork}<p>Automatic archiving waits for waiting work and unanswered Decisions, including snoozed Decisions.</p>{/if}
  <button onclick={()=>void onChange({recalculate:true})} class="ash-button">Recalculate visibility</button>
  <p>Name: {lifecycle.titleMode}. {lifecycle.messages} messages.</p>
  {#if lifecycle.titleMode==='manual'}<button onclick={()=>void onChange({automaticName:true})} class="ash-button">Use automatic name</button>{/if}
  <h3>Assessments</h3>
  {#each attempts as attempt(attempt.id)}<button class="ash-button attempt" onclick={()=>onInspect(attempt.id)}>{attempt.kind} · {attempt.status}<small>{new Date(attempt.createdAt).toLocaleString()}</small></button>{:else}<p>No assessments yet.</p>{/each}
  <h3>Application history</h3>
  {#each changes as change(change.id)}<button class="ash-button attempt" onclick={()=>onInspectChange(change.id)}>{change.events.length?change.events.map(event=>event.event==='name_mode'?'Naming mode changed':event.event).join(', '):change.command?.recalculate?'Recalculate requested':change.command?.automaticName?'Automatic naming requested':'Control saved'} · {change.origin}<small>{new Date(change.createdAt).toLocaleString()}</small></button>{:else}<p>No changes yet.</p>{/each}
 {/if}
 {#if error}<div role="alert"><Status announce={false} label="Action failed">{error}</Status></div>{/if}
</div></aside></Rail>
<style>
 .visibility{position:fixed;right:0;top:44px;bottom:0;z-index:4;width:min(360px,100vw);padding:24px;overflow:auto;border-left:1px solid var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent);box-shadow:-12px 0 30px color-mix(in srgb,var(--shadow) 8%,transparent);color:var(--text);font-size:.9rem}header{display:flex;align-items:center;justify-content:space-between}h2{font-size:15px;font-weight:525}h3{font-size:.9rem;margin-top:24px}p{line-height:1.7}button{border:1px solid var(--divider);border-radius:6px;padding:7px 10px;background:color-mix(in srgb,var(--control) 35%,transparent);color:inherit}header button{border:0;background:transparent;font-size:22px}.attempt{display:block;width:100%;text-align:left;margin:8px 0}.attempt small{display:block;margin-top:5px;color:var(--muted)}
</style>
