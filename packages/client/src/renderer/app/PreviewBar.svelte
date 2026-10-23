<script lang="ts">
  import type { PreviewInfo } from '@ash/shared';
  let { info }: { info: PreviewInfo | null } = $props();
  const branch = $derived(info?.source ? info.source.branch ?? `Detached · ${info.source.revision}` : 'Branch unavailable');
  const worktree = $derived(info?.checkout.split('/').slice(-2).join('/') ?? 'Connecting…');
  const profile = $derived(info?.profile === 'test' ? 'Test' : info?.profile === 'verify' ? 'Verification' : 'Preview');
</script>

<div class="preview-bar" aria-label="Preview identity">
  <span class="profile">{profile}</span>
  <span class="branch" data-testid="preview-branch" title={branch}>{branch}</span>
  <span class="worktree" data-testid="preview-worktree" title={info ? `${info.checkout}\nWorkspace ${info.workspaceId}\nInstance ${info.instanceId}` : undefined}>{worktree}</span>
  {#if info && info.profile !== 'preview'}<span class="instance">{info.instanceId.slice(0,6)}</span>{/if}
</div>

<style>
  .preview-bar{height:44px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 18px 0 96px;background:#405a68;color:#fffff8;-webkit-app-region:drag;font-size:12px}
  .profile{font-size:10px;font-weight:650;letter-spacing:.6px;text-transform:uppercase;padding:4px 7px;border:1px solid #ffffff66;border-radius:4px;flex-shrink:0}
  .branch{font-weight:550;min-width:80px;flex:1}.worktree{max-width:35%;opacity:.85}.branch,.worktree{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;-webkit-app-region:no-drag}.instance{font:10px ui-monospace,monospace;opacity:.8}
</style>
