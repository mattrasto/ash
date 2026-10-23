<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { DEFAULT_LOCATION, type ResolvedSceneBundle, type SceneBundle, type SceneLocation, type ScenePhase, type ScenePlaybackStatus } from '../contracts.ts';
  import { fallbackScene } from './fixtures.ts';
  import { ScenePlaybackController } from './playback.ts';
  let { bundle = fallbackScene, phase = 'automatic', phaseAnchor, location = DEFAULT_LOCATION, paused = false, retainedPrevious, onStatus }: {
    bundle?: ResolvedSceneBundle; phase?: ScenePhase; phaseAnchor?:number; location?: SceneLocation; paused?: boolean; retainedPrevious?: SceneBundle | null; onStatus?: (status: ScenePlaybackStatus) => void;
  } = $props();
  let canvas: HTMLCanvasElement;
  let controller = $state<ScenePlaybackController>();
  let forcedColors = $state(false);
  let status = $state<ScenePlaybackStatus['state']>('loading');
  let activeSceneId=$state('');
  let loadMs=$state<number>();

  export function clock(now: Date | number = Date.now()): void { controller?.clock(false, now); }
  onMount(() => {
    const forced=matchMedia('(forced-colors: active)');forcedColors=forced.matches;
    const updateForced=()=>{forcedColors=forced.matches;};forced.addEventListener('change',updateForced);
    const playback = new ScenePlaybackController(canvas, value => {
      const desired=value.sceneId===bundle.manifest.id;
      if(value.state==='ready')activeSceneId=value.sceneId;
      if(desired){status=value.state;if(value.loadMs!==undefined)loadMs=value.loadMs;}
      onStatus?.(value);
    });
    controller = playback;
    // The decorative canvas never owns pointer events or focus. Observe only exposed sky.
    const listeners=new AbortController(),options={signal:listeners.signal,passive:true};
    const leave=()=>playback.renderer.hover(null);
    window.addEventListener('pointermove',event=>{
      const target=event.target instanceof Element?event.target:null;
      if(event.pointerType==='touch'||target?.closest('button,input,textarea,select,a,dialog,[role="button"],[role="menu"],[role="listbox"],[contenteditable="true"],.ash-surface')){leave();return;}
      const r=canvas.getBoundingClientRect();
      if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){leave();return;}
      playback.renderer.hover(event.clientX,event.clientY);
    },options);
    window.addEventListener('blur',leave,options);
    window.addEventListener('pointerout',event=>{if(!event.relatedTarget)leave();},options);
    window.addEventListener('pointerdown',leave,options);
    document.addEventListener('scroll',leave,{...options,capture:true});
    return () => { listeners.abort();forced.removeEventListener('change',updateForced);playback.dispose(); controller = undefined; };
  });
  $effect(() => { const playback = controller, previous = retainedPrevious; if (playback) untrack(() => playback.setRetainedPrevious(previous)); });
  $effect(() => { const playback = controller, candidate = bundle; if (playback) untrack(() => { void playback.load(candidate); }); });
  $effect(() => { const playback = controller, selected = phase, context = location, hold = paused||forcedColors,anchor=phaseAnchor; if (playback) untrack(() => playback.setContext(selected, context, hold,anchor)); });
</script>

<div class="scene-host" aria-hidden="true" data-scene-status={status} data-scene-id={activeSceneId||bundle.manifest.id} data-scene-request={bundle.manifest.id} data-load-ms={loadMs}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .scene-host { position: absolute; inset: 0; overflow: hidden; background: #d8e0d5; pointer-events: none; }
  canvas { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
