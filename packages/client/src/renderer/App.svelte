<script lang="ts">
  import Chat from './features/conversations/Chat.svelte';
  import Scratchpad from './features/development/Scratchpad.svelte';
  let development = $state(false);
</script>
{#if development}<Scratchpad />{:else}<Chat />{/if}
<button class="view-switch" onclick={() => development = !development}>{development ? 'Back to chat' : 'Development checks'}</button>
<style>
  .view-switch{position:fixed;bottom:12px;left:18px;z-index:5;border:0;background:transparent;color:#70796d;font:11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;padding:5px;text-decoration:underline;text-underline-offset:3px}
</style>
