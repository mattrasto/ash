<script lang="ts">
  import {tick,untrack,type Component,type Snippet} from 'svelte';
  import {DEFAULT_LOCATION,validateLocation,type SceneLocation} from '../contracts.ts';
  import {scenePreferences,setSceneLocation} from './host-preferences.ts';
  let {SearchField,Suggestions,StatusDisplay,replaceResults,busy=$bindable(false)}:{
    SearchField:Component<{value?:string;label?:string;placeholder?:string;disabled?:boolean;suggestions?:{expanded:boolean;controls:string;activeDescendant?:string};onKeyDown?:(event:KeyboardEvent)=>void;onFocus?:()=>void;onBlur?:()=>void}>;
    Suggestions:Component<{anchor:HTMLElement;onClose:()=>void;children:Snippet}>;
    StatusDisplay:Component<{label:string;children?:Snippet}>;
    replaceResults:(host:HTMLElement|undefined,update:()=>void|Promise<void>)=>Promise<void>;
    busy?:boolean;
  }=$props();
  let query=$state(''),results=$state<SceneLocation[]>([]),resolvedQuery=$state(''),searching=$state(false),error=$state(''),notice=$state('');
  let focused=$state(false),dismissed=$state(false),active=$state(-1);
  let field=$state<HTMLDivElement>(),frame=$state<HTMLDivElement>();
  const listId=`cities-${crypto.randomUUID()}`;
  const anchor=$derived(field?.querySelector('input'));
  const open=$derived(focused&&!dismissed&&!busy&&query.trim().length>=2&&!!anchor);
  const pending=$derived(searching||resolvedQuery!==query.trim());
  const activeId=$derived(open&&!pending&&active>=0?`${listId}-${active}`:undefined);

  $effect(()=>{
    const text=query.trim(),controller=new AbortController();
    error='';notice='';
    if(text.length<2){results=[];resolvedQuery='';searching=false;active=-1;return;}
    searching=true;dismissed=false;
    const timer=setTimeout(()=>void search(text,controller),220);
    return()=>{clearTimeout(timer);controller.abort();};
  });
  async function search(text:string,controller:AbortController){
    try{
      const response=await fetch(`/api/scenes/locations?q=${encodeURIComponent(text)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
      if(!response.ok)throw new Error('Could not search cities. Your current location is unchanged.');
      const data=await response.json(),next:SceneLocation[]=data.locations.map(validateLocation);
      if(controller.signal.aborted)return;
      const previous=untrack(()=>results[active]?.name);
      await replaceResults(frame,()=>{
        if(controller.signal.aborted)return;
        results=next;resolvedQuery=text;searching=false;
        active=next.findIndex(location=>location.name===previous);
      });
    }catch(e){if(!controller.signal.aborted){searching=false;error=(e as Error).message;}}
  }
  function key(event:KeyboardEvent){
    if(event.isComposing)return;
    if(event.key==='Tab'){dismissed=true;return;}
    if(event.key==='Enter'){event.preventDefault();if(open&&!pending&&results[active])void save(results[active]);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||pending||!results.length)return;
    if((event.key==='Home'||event.key==='End')&&!open)return;
    event.preventDefault();dismissed=false;
    active=event.key==='Home'?0:event.key==='End'?results.length-1:active<0?(event.key==='ArrowUp'?results.length-1:0):(active+(event.key==='ArrowUp'?-1:1)+results.length)%results.length;
    void tick().then(()=>document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'}));
  }
  async function save(location:SceneLocation){
    if(busy)return;busy=true;error='';notice='';dismissed=true;
    try{
      const response=await fetch('/api/scenes/location',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(location),signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('Could not save this location. Try again.');
      setSceneLocation(location);query='';await tick();notice=`Location saved: ${location.name}.`;
    }catch(e){error=(e as Error).message;}finally{busy=false;await tick();anchor?.focus({preventScroll:true});}
  }
</script>

<section aria-labelledby="scene-location-heading">
  <h3 id="scene-location-heading">Location</h3>
  <p>Automatic lighting follows the sun in <strong>{$scenePreferences.location.name}</strong>.</p>
  <div class="field-label">City</div>
  <div bind:this={field}><SearchField label="City" bind:value={query} placeholder="Search for a city" disabled={busy} suggestions={{expanded:open,controls:listId,activeDescendant:activeId}} onKeyDown={key} onFocus={()=>{focused=true;dismissed=false;}} onBlur={()=>focused=false}/></div>
  {#if open&&anchor}
    <Suggestions {anchor} onClose={()=>dismissed=true}>
      <div bind:this={frame}>
        <div role="listbox" id={listId} aria-label="Matching cities" aria-busy={pending}>
          {#each results as location,index (location.name)}<button type="button" role="option" tabindex="-1" id={`${listId}-${index}`} aria-selected={index===active} aria-disabled={pending} data-highlighted={!pending&&index===active} class="ash-menu-row city" onpointerdown={event=>event.preventDefault()} onpointermove={event=>{if(!pending&&(event.movementX||event.movementY))active=index;}} onclick={()=>{if(!pending)void save(location);}}>{location.name}</button>{/each}
        </div>
        <p class="result-status" role="status">{searching?'Searching…':error?'Search unavailable':results.length?`${results.length} ${results.length===1?'city':'cities'} found`:'No matching cities. Try a nearby major city.'}</p>
      </div>
    </Suggestions>
  {/if}
  {#if error}<StatusDisplay label="Location unavailable">{error}</StatusDisplay>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if $scenePreferences.location.name!==DEFAULT_LOCATION.name}<button class="ash-button ash-ghost reset" disabled={busy} onclick={()=>void save({...DEFAULT_LOCATION})}>Use San Francisco</button>{/if}
  <p class="hint">San Francisco is the default. Search the offline list for a nearby city.</p>
</section>

<style>
  h3{margin:0 0 12px}p{color:var(--text)}strong{font-weight:525}.field-label{margin:24px 0 7px}.city{width:100%;text-align:left}.result-status{font-size:.8rem;color:var(--muted);margin:7px 10px;min-height:1.6em}.hint{font-size:.8rem;color:var(--muted);margin-top:24px}.reset{margin-top:12px}
</style>
