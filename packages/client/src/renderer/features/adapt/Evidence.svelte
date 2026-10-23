<script lang="ts">
  import type { AdaptCheckpoint } from '@ash/shared';
  let {kind,checkpoint}:{kind:'changes'|'checks';checkpoint:AdaptCheckpoint}=$props();
  let copied=$state('');
  async function copy(){try{await window.ashMedia.copyText(checkpoint.patch);copied='Patch copied';}catch{copied='Could not copy the patch';}}
</script>
<section aria-label={kind==='changes'?'Source changes':'Check evidence'}>
  <p>Base <code>{checkpoint.baseRevision.slice(0,7)}</code> · Source <code>{checkpoint.tree.slice(0,7)}</code></p>
  {#if kind==='changes'}<button class="ash-button ash-ghost" onclick={copy} disabled={checkpoint.patch.length>100000}>Copy patch</button><span role="status">{copied}</span>{:else}<p>Reported by the coding agent. Protected verification happens before Apply.</p>{/if}
  <pre>{kind==='changes'?(checkpoint.patch||'No source changes.'):checkpoint.checks}</pre>
</section>
<style>
  section{min-width:0;font-size:.9rem}p{color:var(--muted);margin:0 0 12px}code,pre{font-family:ui-monospace,SFMono-Regular,monospace}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;line-height:1.6;margin-top:14px}span[role=status]{margin-left:8px;font-size:.8rem}
</style>
