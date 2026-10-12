<script lang="ts">
  import { onMount } from 'svelte';
  import type { PreviewInfo, ScratchState } from '@ash/shared';
  let info = $state<PreviewInfo | null>(null);
  let data = $state<ScratchState>({ note: '', count: 0, fileNote: '' });
  let note = $state('');
  let fileNote = $state('');
  let error = $state('');
  let saving = $state(false);
  let saved = $state('');
  let compact = $state(false);
  const hue = $derived(info ? parseInt(info.workspaceId.slice(0, 6), 16) % 360 : 145);
  async function api(path: string, body?: object) {
    const response = await fetch(`/api/${path}`, body ? { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    if (!response.ok) throw new Error('Connection interrupted. Refresh when the preview is ready.');
    return response.json();
  }
  async function refresh() {
    try {
      [info, data] = await Promise.all([api('info'), api('state')]);
      note = data.note; fileNote = data.fileNote; error = '';
    } catch (e) { error = (e as Error).message; }
  }
  async function change(body: object) {
    saving = true; saved = '';
    try { data = await api('state', body); error = ''; saved = 'Saved in this preview'; }
    catch (e) { error = (e as Error).message; }
    finally { saving = false; }
  }
  async function toggle() { compact = !compact; await window.ashPreferences.setCompact(compact); }
  onMount(() => { void refresh(); void window.ashPreferences.getCompact().then(value => compact = value); });
</script>

<svelte:head><title>Ash — {info?.label ?? 'Starting'}</title></svelte:head>
<div class="shell" class:compact style={`--accent: hsl(${hue} 35% 42%); --tint: hsl(${hue} 22% 93%)`}>
  <aside>
    <div class="brand"><span class="glyph">✳</span> ash<span class="dev-tag">DEV</span></div>
    <div class="nav-item"><span>◫</span> Workspace</div>
    <div class="sidebar-bottom"><span class="eyebrow">CURRENT WORKSPACE</span><strong>{info?.label ?? 'Starting…'}</strong><span class="muted">{info?.profile === 'preview' ? 'Persistent preview' : 'Disposable verification'}</span></div>
  </aside>
  <div class="content">
    <header><span>Development storage checks</span><span class="connection" data-testid="connection">{error ? 'Disconnected' : info ? 'Connected' : 'Connecting…'}<i class:offline={!!error}></i></span></header>
    <main>
      <div class="intro"><span class="eyebrow">DEVELOPER TOOLS</span><h1>Storage test screen</h1><p>Test database, file and client persistence in this instance.<br>Use Back to chat to return to your conversations.</p></div>
      {#if error}<div class="error" role="alert">{error} <button onclick={refresh}>Refresh</button></div>{/if}
      <section class="scratchpad">
        <div class="section-heading"><h2>Scratchpad</h2><span class="pill">{info?.label ?? 'Loading'}</span></div>
        <label for="note">A note for this preview</label>
        <textarea id="note" bind:value={note} maxlength="2000" placeholder="Leave yourself a note…" rows={compact ? 2 : 3}></textarea>
        <div class="actions"><span class="hint">Stored in this instance’s database</span><button class="primary" disabled={saving || !info} onclick={() => change({ note })}>Save note</button></div>
        <div class="divider"></div>
        <div class="markers"><div><h3>Leave a marker</h3><span class="hint">A small way to check that state sticks.</span></div><div class="counter"><output data-testid="count">{data.count}</output><button class="add" aria-label="Add a marker" disabled={saving || !info} onclick={() => change({ increment: true })}>+</button></div></div>
      </section>
      <details class="checks"><summary>File and client storage checks</summary><div class="check-body"><label for="file-note">Local file note</label><input id="file-note" bind:value={fileNote} maxlength="2000"><div class="actions"><span class="hint">Stored in this instance’s file directory</span><button disabled={saving || !info} onclick={() => change({ fileNote })}>Save file</button></div><label class="checkbox"><input type="checkbox" checked={compact} onchange={toggle}> Compact scratchpad <span class="hint">· saved on this client</span></label></div></details>
      <div class="save-status" aria-live="polite">{saved}</div>
    </main>
    <footer><span>Storage checks · No model calls</span><span title={info?.instanceId}>Instance {info?.instanceId.slice(0, 8) ?? '…'}</span></footer>
  </div>
</div>

<style>
  :global(*){box-sizing:border-box} :global(body){margin:0;background:#f7f7f2;color:#2a302c;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px} :global(button),:global(input),:global(textarea){font:inherit} :global(button){cursor:pointer} :global(button:disabled){opacity:.45;cursor:default} :global(button:focus-visible),:global(input:focus-visible),:global(textarea:focus-visible),:global(summary:focus-visible){outline:2px solid var(--accent);outline-offset:3px}
  .shell{display:flex;min-height:100vh;border-top:3px solid var(--accent)} aside{width:210px;flex-shrink:0;background:#eceee7;border-right:1px solid #dde0d6;padding:50px 22px 26px;display:flex;flex-direction:column}.brand{font-size:26px;font-weight:600;letter-spacing:-1px;display:flex;align-items:center;gap:9px;margin-bottom:50px}.glyph{color:var(--accent);font-size:32px}.dev-tag{font-size:9px;letter-spacing:1.5px;background:#dfe4d9;color:#64705c;padding:4px 5px;border-radius:4px;margin:5px 0 0 9px}.nav-item{background:#dfe4d9;border-radius:7px;padding:12px 13px;display:flex;gap:10px;font-size:13px}.sidebar-bottom{margin-top:auto;display:grid;gap:9px;padding-top:50px}.sidebar-bottom strong{font-size:13px;overflow-wrap:anywhere}.eyebrow{font-size:10px;font-weight:600;letter-spacing:1.8px;color:#74806f}.muted{color:#7a8278;font-size:12px}.content{flex:1;min-width:0;display:flex;flex-direction:column}header{height:78px;display:flex;justify-content:space-between;align-items:center;padding:0 35px;border-bottom:1px solid #e5e7df;font-size:12px;color:#7c847a;-webkit-app-region:drag}.connection{display:flex;align-items:center;gap:8px}.connection i{width:6px;height:6px;border-radius:50%;background:var(--accent)}.connection i.offline{background:#b45a47} main{width:min(640px,100%);margin:0 auto;padding:42px 35px 20px;flex:1}.intro{margin-bottom:29px}h1{font-family:Georgia,serif;font-size:42px;font-weight:400;letter-spacing:-1.5px;margin:15px 0 13px}p{color:#7a8278;line-height:1.7;margin:0}.scratchpad{background:#fffefa;border:1px solid #dfe3d9;border-radius:12px;padding:23px 25px;box-shadow:0 4px 16px #24351b04}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:23px;gap:15px}h2{font-size:15px;font-weight:550;margin:0}.pill{color:var(--accent);background:var(--tint);font-size:10px;border-radius:20px;padding:5px 9px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}label{display:block;font-size:12px;color:#63705f;margin-bottom:9px}textarea,input:not([type=checkbox]){width:100%;padding:12px 13px;border:1px solid #dce1d5;border-radius:7px;background:#fbfcf7;resize:vertical;color:#394233;line-height:1.6}textarea{min-height:66px}.actions{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:12px}.hint{font-size:11px;color:#93998e}button{border:1px solid #dce1d5;border-radius:6px;background:#fcfdf9;color:#59664f;padding:8px 13px;font-size:11px}button:hover{background:#edf0e6}.primary{background:var(--accent);color:white;border-color:var(--accent)}.primary:hover{filter:brightness(1.07);background:var(--accent)}.divider{height:1px;background:#e9ece3;margin:24px 0}.markers{display:flex;justify-content:space-between;align-items:center}h3{font-size:12px;font-weight:500;margin:0 0 6px}.counter{display:flex;align-items:center;gap:17px}output{font-family:Georgia,serif;font-size:28px}.add{font-size:21px;padding:1px 10px}.checks{margin:20px 0 0;font-size:11px;color:#818b79}summary{cursor:pointer}.check-body{padding:19px 0 0}.checkbox{display:flex;align-items:center;gap:6px;margin-top:21px}.save-status{min-height:30px;text-align:right;padding-top:10px;font-size:11px;color:var(--accent)}footer{padding:16px 28px;display:flex;justify-content:space-between;font-size:10px;color:#9aa190;border-top:1px solid #e5e7df}.error{background:#f9e9e3;color:#995942;padding:12px;border-radius:6px;margin-bottom:16px;font-size:12px}
  @media(max-width:780px){aside{width:170px;padding-left:15px;padding-right:15px}main{padding:30px 25px}header{padding:0 25px}}
</style>
