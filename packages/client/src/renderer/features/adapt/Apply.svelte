<script lang="ts">
  import type {AdaptApplicationView,DecisionView} from '@ash/shared';
  import DecisionCard from '../decisions/Card.svelte';
  import Status from '../../ui/Status.svelte';
  let {application,decision,available,unavailableReason,busy,refreshing=false,onPrepare,onRefresh,onResolve,api,onChanged}:{application?:AdaptApplicationView;decision?:DecisionView;available:boolean;unavailableReason?:string;busy:boolean;refreshing?:boolean;onRefresh:()=>void;onResolve:()=>void;onPrepare:(action:'apply'|'restore')=>void;api:<T>(path:string,body?:object)=>Promise<T>;onChanged:()=>Promise<void>}=$props();
  const working=$derived(application&&['preparing','applying'].includes(application.phase));
  const failed=$derived(application&&['failed','stale','rolled_back'].includes(application.phase));
  const approving=$derived(decision&&['pending','snoozed'].includes(decision.status));
</script>
<section aria-label="Apply changes">
  {#if !approving}<h3>{application?.phase==='applied'?'Update applied':application?.phase==='restored'?'Previous version restored':'Apply and restart'}</h3>
  <p>Install this UI update locally using your existing conversations and drafts.</p>{/if}
  {#if !available}<p>{unavailableReason??'Local updates are unavailable in this instance.'}</p>
  {:else}
    {#if application?.needsRefresh}<p>Another version is installed. Refresh this Workspace to retain its changes before preparing an update.</p>{/if}
    {#if application?.conflicts?.length}<Status label="Merge conflicts">Resolve these files before preview or Apply:<ul class="paths">{#each application.conflicts as path}<li><code>{path}</code></li>{/each}</ul></Status><button class="ash-button ash-primary" disabled={busy||!!working} onclick={onResolve}>Resolve conflicts…</button>{/if}
    {#if failed}<Status label={application?.phase==='rolled_back'?'Previous version restored':'Update unavailable'}>{application?.message}</Status>
    {:else}<p role="status">{application?.message??'Prepare a verified build, then approve the exact update.'}</p>{/if}
    {#if application?.evidence}<p class="evidence">Source <code>{application.evidence.sourceTree.slice(0,7)}</code> · Build <code>{application.evidence.buildDigest.slice(0,10)}</code></p><details><summary>Protected checks</summary><p>{application.evidence.checks}</p></details>{/if}
    {#if decision&&approving}<DecisionCard {decision} {api} {onChanged}/>{/if}
    <div class="actions">
      {#if !working}<button class="ash-button" disabled={busy} onclick={onRefresh}>{refreshing?'Refreshing…':'Refresh Workspace'}</button>{/if}
      {#if !working&&application?.phase!=='awaiting_approval'}<button class="ash-button ash-primary" disabled={busy||application?.needsRefresh||!!application?.conflicts?.length} onclick={()=>onPrepare('apply')}>{application?.candidateId?'Prepare another update':'Prepare update'}</button>{/if}
      {#if application?.canRestore}<button class="ash-button" disabled={busy||!!working} onclick={()=>onPrepare('restore')}>Restore previous version…</button>{/if}
    </div>
    <p class="scope">UI changes only. This installs a local version; signed app updates are separate.</p>
  {/if}
</section>
<style>
  section{font-size:.9rem;min-width:0}h3{font-size:1rem;font-weight:525;margin:0 0 12px}p{line-height:1.6;margin:0 0 12px}.evidence,.scope{color:var(--muted);font-size:.8rem}.scope{margin-top:14px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}code{font-family:ui-monospace,SFMono-Regular,monospace}summary{cursor:pointer}.paths{padding-left:18px}.paths code{overflow-wrap:anywhere}
</style>
