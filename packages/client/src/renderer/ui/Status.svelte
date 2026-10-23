<script lang="ts">
  import type {Snippet} from 'svelte';
  import Icon from './Icon.svelte';
  let {kind='danger',label,children,announce=true}:{kind?:'danger'|'warning';label:string;children?:Snippet;announce?:boolean}=$props();
</script>
<div class="ash-status" role={announce?(kind==='danger'?'alert':'status'):undefined}><span class:ash-danger={kind==='danger'} class:ash-warning={kind==='warning'}><Icon name={kind}/></span><div><strong class:ash-danger={kind==='danger'} class:ash-warning={kind==='warning'}>{label}</strong>{#if children}<div class="status-explanation">{@render children()}</div>{/if}</div></div>
<style>.ash-status{background:color-mix(in srgb,var(--control) 90%,transparent);border-radius:6px;padding:10px 12px;font-size:.9rem;color:var(--text)}.status-explanation{color:var(--text)}</style>
