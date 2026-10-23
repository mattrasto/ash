<script lang="ts">
  import Chat from './features/threads/Chat.svelte';
  import Specimen from './ui/Specimen.svelte';
  import {WorkspaceScene} from '@ash/scenes/browser';
  const specimen=import.meta.env.DEV&&new URLSearchParams(location.search).get('specimen')==='design';
</script>
{#if specimen}<Specimen/>{:else}<WorkspaceScene native={window.ashScenes}/><Chat/>{/if}
