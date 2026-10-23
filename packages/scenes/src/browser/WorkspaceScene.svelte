<script lang="ts">
  import {onMount} from 'svelte';
  import SceneHost from './SceneHost.svelte';
  import {bundledScenes,fallbackScene} from './fixtures.ts';
  import {SCENE_ASSET_KEYS,SCENE_REPLACEMENTS,RETIRED_SCENE_IDS,validateSceneBundle,type ResolvedSceneBundle,type SceneBundle,type SceneLocation,type ScenePlaybackStatus} from '../contracts.ts';
  import {scenePreferences,setSceneLocation,type SceneNativeBridge} from './host-preferences.ts';
  let {native}:{native?:SceneNativeBridge}=$props();
  const cacheKey='ash-scene-manifests-v1';
  let host:{clock(now:Date|number):void}|undefined=$state();
  let bundle=$state<ResolvedSceneBundle>(initialBundle()),paused=$state(false);
  let retainedPrevious=$state<SceneBundle|null>(initialPrevious());
  let readyManifest=initialPrevious()??fallbackScene.manifest;
  let hasReady=false;
  let lastFailedId='';
  let firstPlaybackReady!:()=>void;
  const firstPlayback=new Promise<void>(resolve=>{firstPlaybackReady=resolve;});
  const startupFailures=new Set<string>();
  function initialBundle(){
    try{const saved=JSON.parse(localStorage.getItem(cacheKey)??'null'),manifest=validateSceneBundle(saved.current);return RETIRED_SCENE_IDS.includes(manifest.id)?bundledScenes.find(scene=>scene.manifest.id===SCENE_REPLACEMENTS[manifest.id])??fallbackScene:resolved(manifest);}catch{return fallbackScene;}
  }
  function initialPrevious(){
    try{const manifest=validateSceneBundle(JSON.parse(localStorage.getItem(cacheKey)??'null').previous);return RETIRED_SCENE_IDS.includes(manifest.id)?null:manifest;}catch{return null;}
  }
  function status(value:ScenePlaybackStatus){
    if(value.state==='error')lastFailedId=value.sceneId;
    if(value.state==='error'&&!hasReady){
      startupFailures.add(value.sceneId);
      try{
        const previous=retainedPrevious??validateSceneBundle(JSON.parse(localStorage.getItem(cacheKey)??'null').previous);
        if(!RETIRED_SCENE_IDS.includes(previous.id)&&!startupFailures.has(previous.id)){bundle=resolved(previous);return;}
      }catch{}
      if(!startupFailures.has(fallbackScene.manifest.id))bundle=fallbackScene;
      else firstPlaybackReady();
      return;
    }
    if(value.state!=='ready'||value.sceneId!==bundle.manifest.id)return;
    hasReady=true;
    lastFailedId='';firstPlaybackReady();
    if(readyManifest.id!==bundle.manifest.id)retainedPrevious=readyManifest;
    try{localStorage.setItem(cacheKey,JSON.stringify({current:bundle.manifest,previous:retainedPrevious}));}catch{}
    readyManifest=bundle.manifest;
  }
  function resolved(manifest:SceneBundle):ResolvedSceneBundle{
    // Shipped fixtures can play without requesting their files through the API.
    const shipped=bundledScenes.find(scene=>scene.manifest.id===manifest.id&&SCENE_ASSET_KEYS.every(key=>scene.manifest.assets[key].sha256===manifest.assets[key].sha256));
    return shipped?{manifest,assetUrls:shipped.assetUrls}:{manifest,assetUrls:Object.fromEntries(SCENE_ASSET_KEYS.map(key=>[key,`/api/scenes/bundles/${encodeURIComponent(manifest.id)}/assets/${manifest.assets[key].sha256}`])) as ResolvedSceneBundle['assetUrls']};
  }
  onMount(()=>{
    let disposed=false,updating=false,requested=false,timer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController();
    const update=async()=>{
      if(disposed)return;
      if(updating){requested=true;return;}
      updating=true;clearTimeout(timer);
      try{
        const response=await fetch('/api/scenes/state',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
        if(!response.ok)throw new Error('Scene state unavailable');
        const state=await response.json() as {manifest:SceneBundle;previous:SceneBundle|null;location:SceneLocation};
        const manifest=validateSceneBundle(state.manifest);
        if(disposed)return;
        setSceneLocation(state.location);
        if(!hasReady&&state.previous)retainedPrevious=validateSceneBundle(state.previous);
        if(lastFailedId===manifest.id||bundle.manifest.id!==manifest.id||SCENE_ASSET_KEYS.some(key=>bundle.manifest.assets[key].sha256!==manifest.assets[key].sha256))bundle=resolved(manifest);
      }catch{/* The complete currently decoded scene remains in place. */}
      finally{updating=false;if(!disposed){if(requested){requested=false;void update();}else timer=setTimeout(update,30000);}}
    };
    const setNative=(state:{visible:boolean;suspended:boolean;now?:string})=>{paused=!state.visible||state.suspended;if(state.now)host?.clock(new Date(state.now));};
    const off=native?.onChange(setNative)??(()=>{});
    const changed=()=>{void update();};window.addEventListener('ash-scene-change',changed);
    void native?.state().then(value=>{if(!disposed)setNative(value);}).catch(()=>{});
    void firstPlayback.then(()=>{if(!disposed)void update();});
    return()=>{disposed=true;controller.abort();clearTimeout(timer);off();window.removeEventListener('ash-scene-change',changed);};
  });
</script>

<div class="workspace-scene"><SceneHost bind:this={host} {bundle} {retainedPrevious} phase={$scenePreferences.phase} phaseAnchor={$scenePreferences.phaseAnchor} location={$scenePreferences.location} {paused} onStatus={status}/></div>

<style>
  .workspace-scene{position:fixed;inset:0;z-index:-1;overflow:hidden;background:#b9cad4;pointer-events:none}
  @media(forced-colors:active){.workspace-scene{display:none}}
</style>
