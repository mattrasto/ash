<script lang="ts">
  import icons from './icons.json';
  let {name,size=16}:{name:keyof typeof icons;size?:number}=$props();
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html icons[name]}</svg>
