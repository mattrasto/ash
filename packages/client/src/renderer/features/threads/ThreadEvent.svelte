<script lang="ts">
 import type {ApplicationChangeView,ThreadEvent} from '@ash/shared';
 let {change,event,initial=false,onInspect}:{change:ApplicationChangeView;event:ThreadEvent;initial?:boolean;onInspect:(id:string)=>void}=$props();
 const who=$derived(event.origin==='automatic'?'Ash':'You');
 const label=$derived(event.event==='renamed'?(initial&&(event.origin==='automatic'||['Untitled','New Thread'].includes(event.previousTitle))?`${who} named this Thread “${event.title}”`:`${who} renamed this Thread from “${event.previousTitle}” to “${event.title}”`)
  :event.origin==='activity'?'Thread unarchived after new activity'
  :`${who} ${event.event} this Thread`);
</script>
<div class="thread-event" data-testid="thread-event" data-change-id={change.id}>
 <button onclick={()=>onInspect(change.id)} aria-label={`Inspect: ${label}`}>
  <span>{label}{event.origin==='undo'?' · Undo':''}</span>
  <time datetime={change.createdAt} title={new Date(change.createdAt).toLocaleString()}>{new Date(change.createdAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time>
 </button>
</div>
<style>
 .thread-event{margin:12px 0;text-align:center;color:#7b8775;font-size:12px;line-height:1.5}
 button{border:0;background:transparent;color:inherit;padding:4px 8px;max-width:100%;overflow-wrap:anywhere}
 button:hover{color:#526749}time{display:block;font-size:10px;color:#929b8d;margin-top:3px}
</style>
