<script lang="ts">
  import { onMount, onDestroy, type Component, type Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import type { SceneChoices } from '../contracts.ts';
  let { enhanceSelect, StatusDisplay, busy = $bindable(false), id = 'settings-scene' }: {
    enhanceSelect: Action<HTMLSelectElement>; StatusDisplay: Component<{ label: string; children?: Snippet }>; busy?: boolean; id?: string;
  } = $props();
  let choices = $state<SceneChoices>({ selectedId: '', revision: 0, scenes: [] }), loading = $state(true), error = $state('');
  const controller = new AbortController();
  let sequence=0;
  async function request(path: string, body?: object): Promise<SceneChoices> {
    const response = await fetch(`/api/scenes${path}`, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'The scene could not be changed.');
    return result;
  }
  async function select(id: string) {
    if (busy) return; sequence++; busy = true; error = '';
    try {
      choices = await request(id === '__new__' ? '/new' : '/select', id === '__new__' ? {} : { id, expectedRevision: choices.revision });
      window.dispatchEvent(new Event('ash-scene-change'));
    } catch (e) {
      if (!controller.signal.aborted) { error = (e as Error).message; choices = await request('').catch(() => choices); }
    } finally { busy = false; }
  }
  async function refresh(){
    const version=++sequence;
    try{const value=await request('');if(version===sequence)choices=value;}
    catch(e){if(!controller.signal.aborted&&version===sequence)error=(e as Error).message;}
    finally{if(version===sequence)loading=false;}
  }
  onMount(() => {
    void refresh();const changed=()=>{if(!busy)void refresh();};window.addEventListener('ash-scene-change',changed);
    return()=>window.removeEventListener('ash-scene-change',changed);
  });
  onDestroy(() => controller.abort());
</script>

<div class="scene-picker">
  <label for={id}>Scene</label>
  <select use:enhanceSelect {id} class="ash-field" value={choices.selectedId} disabled={loading || busy} onchange={event => { const id = event.currentTarget.value; event.currentTarget.value = choices.selectedId; void select(id); }}>
    {#if loading}<option value="">Loading…</option>{/if}
    {#each choices.scenes as scene}<option value={scene.id}>{scene.name}</option>{/each}
    <option value="__new__">New Scene</option>
  </select>
  {#if error}<StatusDisplay label="Scene unavailable">{error}</StatusDisplay>{/if}
</div>

<style>
  label{display:block;margin:0 0 7px}select{width:100%}
</style>
