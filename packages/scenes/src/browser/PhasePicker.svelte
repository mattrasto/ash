<script lang="ts">
  import { SCENE_PHASES, type ScenePhase } from '../contracts.ts';
  import type { Action } from 'svelte/action';
  let { value = 'automatic', onchange, enhanceSelect }: { value?: ScenePhase; onchange?: (phase: ScenePhase) => void; enhanceSelect?: Action<HTMLSelectElement> } = $props();
  const enhance: Action<HTMLSelectElement> = node => enhanceSelect?.(node);
</script>

<label class="scene-phase">
  <span class="label">Scene lighting</span>
  <select use:enhance class="ash-field" aria-label="Scene lighting" {value} onchange={event => onchange?.(event.currentTarget.value as ScenePhase)}>
    {#each SCENE_PHASES as phase}<option value={phase}>{phase[0]!.toUpperCase() + phase.slice(1)}</option>{/each}
  </select>
</label>

<style>
  .scene-phase { display: inline-flex; align-items: center; -webkit-app-region: no-drag; }
  .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
