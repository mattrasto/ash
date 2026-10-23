<script lang="ts">
  import type {Snippet} from 'svelte';
  import {railSlide} from './rail.ts';
  let {side,width='360px',className='',children}:{side:'left'|'right';width?:string;className?:string;children:Snippet}=$props();
</script>
<!-- Keep the slide's lifecycle separate from the slotted surface's longer exit. -->
{#key side}
  <div class={`ash-rail ${className}`} data-side={side} style:width transition:railSlide|global={{side}}>{@render children()}</div>
{/key}
