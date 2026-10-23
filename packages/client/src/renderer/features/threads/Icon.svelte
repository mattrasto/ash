<script lang="ts">
  import Icon from '../../ui/Icon.svelte';
  import icons from '../../ui/icons.json';
  let {name,size=16}:{name:keyof typeof icons;size?:number}=$props();
</script>
<Icon {name} {size}/>
