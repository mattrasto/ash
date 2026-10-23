<script lang="ts">
  import {onMount,tick,type Component,type Snippet} from 'svelte';
  import type {Action} from 'svelte/action';
  import ScenePicker from './ScenePicker.svelte';
  import {sceneTuning,scenePreview,tuneScene,resetSceneTuning,tuningProfile,tuningPercent,tuningValue,cloudTuningKeys,type SceneOverrides,type TuningRange} from './scene-tuning.ts';
  import {clockLabel} from './engine/scene.js';
  let {Panel,enhanceRange,enhanceSelect,StatusDisplay,triggerIcon}:{Panel:Component<{anchor:HTMLElement;onClose:()=>void;children:Snippet;width?:number;maxHeight?:number}>;enhanceRange:Action<HTMLInputElement,number>;enhanceSelect:Action<HTMLSelectElement>;StatusDisplay:Component<{label:string;children?:Snippet}>;triggerIcon:Snippet}=$props();
  let anchor=$state<HTMLButtonElement>(),content=$state<HTMLDivElement>();
  let open=$state(false);
  const preview=$derived($scenePreview);
  const draft=$derived(preview?$sceneTuning.drafts[preview.id]??{}:{});
  const settings=$derived(preview?tuningProfile(preview.profile,draft):null);
  const shadowAvailable=$derived(settings?.clouds&&['soft','cumulus'].includes(settings.cloudStyle));
  const time=$derived($sceneTuning.time??preview?.time??720);
  const cloudPosition=$derived($sceneTuning.cloudPosition??preview?.cloudPosition??0);
  const styles=[['cumulus','Cumulus'],['soft','Soft layers'],['cirrus-feathered','Cirrus'],['storm','Overcast']] as const;
  const ranges={daylight:'Daylight strength',amount:'Coverage',speed:'Drift',shadowStrength:'Shadow strength',shadowSoftness:'Shadow softness',waterStrength:'Ripple strength',waterSpeed:'Ripple speed',waterReflections:'Sky reflections'} as const;
  function change(changes:SceneOverrides){
    if(!preview||!settings)return;
    if(cloudTuningKeys.some(key=>changes[key]!==undefined)){
      const style=settings.cloudStyle;
      tuneScene(preview.id,{cloudStyles:{...draft.cloudStyles,[style]:{
        amount:changes.amount??settings.amount,speed:changes.speed??settings.speed,
        shadowStrength:changes.shadowStrength??settings.shadowStrength,shadowSoftness:changes.shadowSoftness??settings.shadowSoftness,
      }}});
    }else tuneScene(preview.id,changes);
  }
  function close(){open=false;sceneTuning.update(state=>({...state,open:false}));}
  async function toggle(){if(open){close();return;}open=true;sceneTuning.update(state=>({...state,open:true}));await tick();(content?.querySelector<HTMLElement>('select:not(:disabled),input:not(:disabled),button:not(:disabled)')??content)?.focus({preventScroll:true});}
  function keydown(event:KeyboardEvent){
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();anchor?.focus({preventScroll:true});}
    if(event.key==='Tab'&&content){
      const controls=Array.from(content.querySelectorAll<HTMLElement>('select:not(:disabled),button:not(:disabled),input:not(:disabled):not(fieldset:disabled input)'));
      if(document.activeElement===(event.shiftKey?controls[0]:controls.at(-1))){close();anchor?.focus({preventScroll:true});}
    }
  }
  const range:Action<HTMLInputElement,number>=(node,value)=>enhanceRange(node,value);
  onMount(()=>{
    sceneTuning.update(state=>({...state,enabled:true}));
    return()=>sceneTuning.update(state=>({...state,enabled:false,open:false,time:null,cloudPosition:null}));
  });
</script>

{#snippet slider(key:TuningRange,disabled=false)}
  <label class="slider" for={`tune-${key}`}><span>{key==='amount'&&settings?.cloudStyle==='storm'?'Thickness':ranges[key]} <output>{tuningPercent(key,settings?.[key]??0)}%</output></span>
    <input id={`tune-${key}`} class="ash-range" use:range={tuningPercent(key,settings?.[key]??0)} type="range" min="0" max="100" step="1" value={tuningPercent(key,settings?.[key]??0)} {disabled} oninput={event=>change({[key]:tuningValue(key,event.currentTarget.valueAsNumber)})}/>
  </label>
{/snippet}

<button class="ash-button ash-icon scene-tuning-trigger" bind:this={anchor} aria-label="Scene controls" title="Scene controls" aria-expanded={open} aria-haspopup="dialog" onclick={toggle}>{@render triggerIcon()}</button>
{#if open&&anchor}
  <Panel {anchor} onClose={close} width={360} maxHeight={660}>
    <div class="tuning" role="dialog" tabindex="-1" aria-modal="false" aria-label="Scene controls" bind:this={content} onkeydown={keydown}>
      <ScenePicker id="debug-scene" {enhanceSelect} {StatusDisplay}/>
      {#if settings&&preview}
        <section aria-label="Lighting settings">
          <h3>Lighting</h3>
          <label class="switch-row"><span>Set time manually</span><input class="ash-choice" type="checkbox" role="switch" checked={$sceneTuning.time!==null} onchange={event=>{const checked=event.currentTarget.checked;sceneTuning.update(state=>({...state,time:checked?time:null}));}}/></label>
          <label class="slider" for="tune-time"><span>Time of day <output>{clockLabel(time)}</output></span><input id="tune-time" class="ash-range" use:range={time} type="range" min="0" max="1439" step="1" value={time} disabled={$sceneTuning.time===null} aria-valuetext={clockLabel(time)} oninput={event=>{const value=event.currentTarget.valueAsNumber;sceneTuning.update(state=>({...state,time:value}));}}/></label>
          <p>Manual time overrides the lighting selection above. Turn it off to use that selection again.</p>
          {@render slider('daylight')}
        </section>
        <section aria-label="Cloud settings">
          <div class="section-heading"><div class="heading-actions"><h3>Clouds</h3><button class="ash-button ash-ghost ash-icon" aria-label="New cloud arrangement" title="New cloud arrangement" disabled={!settings.clouds} onclick={()=>change({cloudSeed:crypto.getRandomValues(new Uint32Array(1))[0]!%2147483647+1})}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg></button></div><label class="choice"><input class="ash-choice" type="checkbox" role="switch" checked={settings.clouds} aria-label="Show clouds" onchange={event=>change({clouds:event.currentTarget.checked})}/></label></div>
          <fieldset disabled={!settings.clouds}><legend>Cloud type</legend><div class="grid">{#each styles as [value,label]}<label class="choice"><input class="ash-choice" type="radio" name="tune-cloud-style" checked={settings.cloudStyle===value} onchange={()=>change({cloudStyle:value})}/>{label}</label>{/each}</div></fieldset>
          <div class="grid">{@render slider('amount',!settings.clouds)}{@render slider('speed',!settings.clouds)}</div>
          <label class="switch-row"><span>Animate clouds</span><input class="ash-choice" type="checkbox" role="switch" checked={$sceneTuning.cloudPosition===null} disabled={!settings.clouds} onchange={event=>{const checked=event.currentTarget.checked;sceneTuning.update(state=>({...state,cloudPosition:checked?null:cloudPosition}));}}/></label>
          <label class="slider" for="tune-cloud-position"><span>Cloud position <output>{Math.round(cloudPosition)}%</output></span><input id="tune-cloud-position" class="ash-range" use:range={cloudPosition} type="range" min="0" max="100" step="0.1" value={cloudPosition} disabled={!settings.clouds||$sceneTuning.cloudPosition===null} oninput={event=>{const value=event.currentTarget.valueAsNumber;sceneTuning.update(state=>({...state,cloudPosition:value}));}}/></label>
          <p>Turn animation off to scrub the clouds without pausing water.</p>
        </section>
        <section aria-label="Cloud shadow settings">
          <label class="section-heading switch-row"><span>Cloud shadows</span><input class="ash-choice" type="checkbox" role="switch" checked={settings.cloudShadows} disabled={!shadowAvailable} onchange={event=>change({cloudShadows:event.currentTarget.checked})}/></label>
          <div class="grid">{@render slider('shadowStrength',!shadowAvailable||!settings.cloudShadows)}{@render slider('shadowSoftness',!shadowAvailable||!settings.cloudShadows)}</div>
          {#if !shadowAvailable}<p>Shadows are available with Cumulus and Soft layers.</p>{/if}
        </section>
        <section aria-label="Water settings">
          <div class="section-heading"><h3>Water</h3><label class="choice"><input class="ash-choice" type="checkbox" role="switch" checked={settings.water} disabled={!preview.waterAvailable} aria-label="Water effects" onchange={event=>change({water:event.currentTarget.checked})}/></label></div>
          {#if preview.waterAvailable}<div class="grid">{@render slider('waterStrength',!settings.water)}{@render slider('waterSpeed',!settings.water)}</div>{@render slider('waterReflections',!settings.water)}<p>Shorelines stay still; reflections follow the sky.</p>{:else}<p>No water region in this scene.</p>{/if}
        </section>
        {#if preview.reducedMotion}<p>System reduced motion is on. Scrubbing remains available.</p>{/if}
        <div class="footer"><p>Debug adjustments stay on this device, separately for each scene and cloud type.</p><button class="ash-button" onclick={()=>resetSceneTuning(preview.id)}>Reset this scene</button></div>
      {:else}<p>Waiting for the scene…</p>{/if}
    </div>
  </Panel>
{/if}

<style>
  .scene-tuning-trigger{min-width:42px;min-height:42px;-webkit-app-region:no-drag}
  .tuning{padding:11px 13px;display:grid;gap:12px;-webkit-app-region:no-drag}
  h3,p{margin:0}h3{font-size:.9rem;font-weight:525}p{font-size:.8rem;color:var(--muted)}
  .section-heading,.switch-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  section{display:grid;gap:8px;border-top:1px solid var(--divider);padding-top:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
  .slider{display:grid;gap:1px;min-width:0}.slider>span{display:flex;justify-content:space-between;gap:8px;font-size:.85rem}.slider output{font-variant-numeric:tabular-nums;color:var(--muted)}.slider input{width:100%;min-width:0;margin:0}
  .choice{display:flex;align-items:center;gap:8px;font-size:.85rem}.choice input{margin:0}fieldset{border:0;margin:0;padding:0}legend{font-size:.8rem;color:var(--muted);padding:0 0 6px}
  .heading-actions{display:flex;align-items:center;gap:4px}.switch-row{font-size:.85rem}.switch-row input{margin:0}.section-heading.switch-row{font-weight:525}.footer{border-top:1px solid var(--divider);padding-top:12px;display:grid;gap:8px}
</style>
