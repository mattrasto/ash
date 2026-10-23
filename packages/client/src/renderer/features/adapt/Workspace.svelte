<script lang="ts">
  import { surface,mist } from '../../ui/surface.ts';
  import Status from '../../ui/Status.svelte';
  import Icon from '../../ui/Icon.svelte';
  import type { AdaptWorkspaceView,AdaptInfo,RunView } from '@ash/shared';
  let {workspace,run,info,connected,onStop,onInspect,onEvidence,onPreview,busy=false}:{workspace:AdaptWorkspaceView|null|undefined;run?:RunView;info?:AdaptInfo;connected:boolean;onStop:()=>void;onInspect:(id:string)=>void;onEvidence:(kind:'changes'|'checks'|'apply')=>void;onPreview:(action:'run'|'stop'|'refresh')=>void;busy?:boolean}=$props();
  const working=$derived(run&&['queued','running','waiting'].includes(run.status));
  const checkpoint=$derived(workspace?.checkpoint);
  const preview=$derived(workspace?.preview),preparing=$derived(preview?.phase==='preparing'),running=$derived(preview?.running??preview?.phase==='running');
  const behind=$derived(running&&preview?.checkpointId!==checkpoint?.id);
  const previewLabel=$derived(preparing?preview?.message:preview?.phase==='failed'?(running?'Update failed':'Unavailable'):running?'Running':'Stopped');
</script>

<section class="adapt-workspace" aria-label="Adapt workspace" use:surface transition:mist={{role:'compact'}}>
  <div class="surface-content">
    <div class="workspace-summary">
      <div class="workspace-heading"><strong>Adapt</strong><span>{workspace?'Workspace · '+workspace.baseRevision.slice(0,7):'A workspace will be prepared when you send.'}</span></div>
      {#if working}<button class="ash-button ash-ghost" onclick={onStop} disabled={!connected}><Icon name="stop"/> Stop agent</button>{/if}
    </div>
    <div class="workspace-status" role="status"><span>{workspace?.application?.conflicts?.length?'Resolve merge conflicts before preview or Apply.':run?.state.adapt?.message??'Describe the change or record your feedback below.'}</span><small>{info?.label??'Connecting to coding…'}</small></div>
    <div class="workspace-actions">
      <button class="ash-button ash-ghost" disabled={!checkpoint} onclick={()=>onEvidence('changes')}>Changes</button>
      <button class="ash-button ash-ghost" disabled={!checkpoint} onclick={()=>onEvidence('checks')}>Checks</button>
      <button class="ash-button ash-ghost" disabled={!run} onclick={()=>run&&onInspect(run.state.adapt?.requestArtifactId??run.state.request_artifact_id)}>Inspect Run</button>
      {#if info?.capabilities.nativePreview}
        <button class="ash-button ash-ghost" disabled={!connected||!checkpoint||preparing||busy||!!workspace?.application?.conflicts?.length} onclick={()=>onPreview('run')}>{running?(behind?'Update preview':'Open preview'):'Run preview'}</button>
        {#if running}<button class="ash-button ash-ghost" disabled={!connected||preparing||busy} onclick={()=>onPreview('refresh')}>Refresh</button><button class="ash-button ash-ghost" disabled={!connected||preparing||busy} onclick={()=>onPreview('stop')}>Stop</button>{/if}
      {:else}<span class="preview-unavailable">Native preview unavailable</span>{/if}
      <button class="ash-button" disabled={!checkpoint||working} onclick={()=>onEvidence('apply')}>Apply…</button>
    </div>
    <div class="preview-state" role="status" aria-label="Preview status">Preview · {previewLabel}{#if running&&preview?.tree} · {preview.tree.slice(0,7)}{/if}{#if behind&&!preparing} · Newer changes ready{/if}{#if running&&!preparing&&preview?.phase!=='failed'} · Updates automatically{/if}</div>
    {#if workspace?.application&&workspace.application.phase!=='idle'}<div class="preview-state" role="status" aria-label="Application status">Update · {workspace.application.phase==='awaiting_approval'?'Ready for your approval':workspace.application.message}</div>{/if}
    {#if preview?.phase==='failed'}<div class="preview-state"><Status label={running?'Preview update failed':'Preview unavailable'}>{preview.message}</Status></div>{/if}
  </div>
</section>

<style>
  .adapt-workspace{flex-shrink:0;margin:0 30px 12px;min-width:0}
  .surface-content{padding:12px 16px}
  .workspace-summary,.workspace-heading,.workspace-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .workspace-summary{justify-content:space-between}.workspace-heading span,.workspace-status small,small,.preview-unavailable{color:var(--muted);font-size:.8rem}
  .workspace-status{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:.9rem;margin-top:4px}
  .preview-state{font-size:.8rem;color:var(--muted);margin-top:6px}
  .workspace-actions{gap:4px;margin-top:6px}.preview-unavailable{margin-left:auto}
  @media(max-width:800px){.adapt-workspace{margin-inline:22px}.workspace-status small{width:100%}.preview-unavailable{margin-left:8px}}
</style>
