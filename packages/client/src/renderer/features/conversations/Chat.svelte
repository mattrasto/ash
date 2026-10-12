<script lang="ts">
  import { onMount } from 'svelte';
  import { isActive, messageText, type ArtifactView, type ConversationView, type InspectionView, type MessagePayload, type ModelMode, type PreviewInfo, type RequestPayload, type RunView, type ThreadView } from '@ash/shared';
  type Pending = {requestKey:string;text:string;mode:ModelMode};
  let info = $state<PreviewInfo | null>(null);
  let threads = $state<ThreadView[]>([]);
  let selected = $state('');
  let conversation = $state<ConversationView | null>(null);
  let drafts = $state<Record<string,string>>({});
  let pending = $state<Record<string,Pending>>({});
  let retryCommands = $state<Record<string,{requestKey:string;mode:ModelMode}>>({});
  let actionBusy = $state<Record<string,boolean>>({});
  let newTitle = $state('');
  let pendingThread: {id:string;title:string} | null = null;
  let error = $state('');
  let connected = $state(false);
  let submitting = $state(false);
  let creating = $state(false);
  let mode = $state<ModelMode>('normal');
  let inspection = $state<InspectionView | null>(null);
  let inspectedId = $state('');
  let transcript: HTMLElement;
  let stickToBottom = true;
  let requestSequence = 0;
  const active = $derived(conversation?.runs.find(run => isActive(run.status)));
  const hue = $derived(info ? parseInt(info.workspaceId.slice(0,6),16) % 360 : 145);
  const inspected = $derived(inspection?.artifacts.find(artifact => artifact.id === inspectedId));
  const inspectionRun = $derived(inspection?.runs.find(run => run.id === inspected?.runId));
  const captured = $derived(inspection?.artifacts.find(artifact => artifact.id === inspectionRun?.state.request_artifact_id)?.payload as RequestPayload | undefined);
  class ApiError extends Error { constructor(message:string, public status?:number) { super(message); } }
  async function api<T>(path:string, body?:object):Promise<T> {
    const response = await fetch(`/api/${path}`, {method:body ? 'POST' : 'GET', headers:{'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(10000)});
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new ApiError(data.error ?? 'The request failed.',response.status); }
    return response.json();
  }
  function saveLocal() {
    localStorage.setItem('ash-chat-drafts',JSON.stringify(drafts));
    localStorage.setItem('ash-chat-pending',JSON.stringify(pending));
    localStorage.setItem('ash-chat-retries',JSON.stringify(retryCommands));
    localStorage.setItem('ash-chat-selected',selected);
  }
  async function loadThread(id:string) {
    const sequence = ++requestSequence;
    const value = await api<ConversationView>(`threads/${id}`);
    if (selected !== id || sequence !== requestSequence) return;
    conversation = value;
    const delivery = pending[id];
    if (delivery && value.runs.some(run => run.requestKey === delivery.requestKey)) {
      if ((drafts[id] ?? '').trim() === delivery.text) drafts[id] = '';
      delete pending[id]; saveLocal();
    }
    for (const [runId,command] of Object.entries(retryCommands)) {
      if (value.runs.some(run=>run.requestKey===command.requestKey)) { delete retryCommands[runId]; saveLocal(); }
    }
    if (stickToBottom && transcript) requestAnimationFrame(() => { if (transcript) transcript.scrollTop = transcript.scrollHeight; });
  }
  async function selectThread(id:string) {
    selected = id; conversation = null; inspection = null; inspectedId = ''; error = ''; stickToBottom = true; saveLocal();
    try { await loadThread(id); } catch (e) { error = (e as Error).message; }
  }
  async function refresh() {
    try {
      info = await api<PreviewInfo>('info');
      if (info.model?.provider === 'openai') mode = 'normal';
      threads = await api<ThreadView[]>('threads');
      if (!selected && threads.length) selected = threads[0].id;
      if (!creating && selected && !threads.some(thread => thread.id === selected)) { selected = threads[0]?.id ?? ''; conversation = null; }
      if (selected) await loadThread(selected);
      if (inspectedId && inspection?.runs.some(run=>isActive(run.status))) await inspect(inspectedId);
      connected = true;
    } catch { connected = false; }
  }
  async function createThread() {
    if (!newTitle.trim() || creating) return;
    creating = true; error = '';
    const command = pendingThread?.title === newTitle.trim() ? pendingThread : {id:crypto.randomUUID(),title:newTitle.trim()};
    pendingThread = command; localStorage.setItem('ash-chat-new-thread',JSON.stringify(command));
    const {id} = command;
    try { await api('threads',command); pendingThread = null; localStorage.removeItem('ash-chat-new-thread'); newTitle = ''; await selectThread(id); await refresh(); }
    catch (e) { error = (e as Error).message; }
    finally { creating = false; }
  }
  async function send() {
    const id = selected;
    if (!id || submitting || active) return;
    const command = pending[id] ?? {requestKey:crypto.randomUUID(),text:(drafts[id] ?? '').trim(),mode};
    if (!command.text) return;
    pending[id] = command; saveLocal(); submitting = true; error = ''; stickToBottom = true;
    try {
      await api(`threads/${id}/messages`,command);
      if ((drafts[id] ?? '').trim() === command.text) drafts[id] = '';
      delete pending[id]; saveLocal();
      if (selected === id) await loadThread(id);
    } catch (e) {
      if (e instanceof ApiError && e.status && e.status < 500) { delete pending[id]; saveLocal(); }
      error = (e as Error).message;
    } finally { submitting = false; }
  }
  async function inspect(id:string) {
    inspectedId = id;
    try { const value = await api<InspectionView>(`artifacts/${id}`); if (inspectedId === id) inspection = value; }
    catch (e) { error = (e as Error).message; }
  }
  async function runAction(run:RunView, action:'cancel'|'retry') {
    if (actionBusy[run.id]) return;
    actionBusy[run.id] = true; error = '';
    const command = action === 'retry' ? (retryCommands[run.id] ?? {requestKey:crypto.randomUUID(),mode}) : {};
    if (action === 'retry') { retryCommands[run.id] = command as {requestKey:string;mode:ModelMode}; saveLocal(); }
    try { await api(`runs/${run.id}/${action}`,command); delete retryCommands[run.id]; saveLocal(); if (selected === run.threadId) await loadThread(selected); if (inspectedId) await inspect(inspectedId); }
    catch (e) { if (e instanceof ApiError && e.status && e.status < 500) { delete retryCommands[run.id]; saveLocal(); } error = (e as Error).message; }
    finally { actionBusy[run.id] = false; }
  }
  function associatedRun(artifact:ArtifactView) { return conversation?.runs.find(run => run.id === artifact.runId); }
  function outcomes(inputId:string) { return conversation?.runs.filter(run => run.inputArtifactId === inputId && !run.state.response_artifact_id) ?? []; }
  onMount(() => {
    try { pendingThread = JSON.parse(localStorage.getItem('ash-chat-new-thread') ?? 'null'); newTitle = pendingThread?.title ?? ''; drafts = JSON.parse(localStorage.getItem('ash-chat-drafts') ?? '{}'); pending = JSON.parse(localStorage.getItem('ash-chat-pending') ?? '{}'); retryCommands = JSON.parse(localStorage.getItem('ash-chat-retries') ?? '{}'); selected = localStorage.getItem('ash-chat-selected') ?? ''; } catch { drafts = {}; pending = {}; }
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!disposed) timer = setTimeout(poll,active ? 150 : 800); };
    void poll();
    return () => { disposed = true; clearTimeout(timer); requestSequence++; };
  });
</script>

<svelte:head><title>Ash — {conversation?.thread.title ?? 'Chat'}</title></svelte:head>
<div class="shell" style={`--accent:hsl(${hue} 29% 37%);--tint:hsl(${hue} 24% 92%)`}>
  <aside class="sidebar">
    <div class="brand"><span>✳</span> ash <small>DEV</small></div>
    <form class="new-thread" onsubmit={(e) => {e.preventDefault(); void createThread();}}>
      <label for="thread-title">New thread</label><input id="thread-title" placeholder="Name a conversation" bind:value={newTitle} maxlength="160" />
      <button class="new-button" disabled={!newTitle.trim() || creating || !connected}>+ Create thread</button>
    </form>
    <nav aria-label="Threads">
      {#each threads as thread (thread.id)}<button class:selected={selected === thread.id} onclick={() => selectThread(thread.id)}>{thread.title}</button>{/each}
    </nav>
    <div class="workspace"><span class="eyebrow">WORKSPACE</span><strong>{info?.label ?? 'Connecting…'}</strong><span>{info?.profile === 'preview' ? 'Persistent preview' : 'Disposable verification'}</span></div>
  </aside>
  <div class="main-column">
    <header><div><span class="eyebrow">CONVERSATION</span><h1>{conversation?.thread.title ?? 'A place to think.'}</h1></div><span class="connection" data-testid="connection"><i class:offline={!connected}></i>{connected ? 'Connected' : 'Reconnecting…'}</span></header>
    <div class="model-banner"><span class="model-dot"></span>{#if info?.model?.provider === 'openai'}OpenAI · {info.model.model}{#if info.model.session}<span>· {info.model.session.callsUsed}{#if info.model.session.maxCalls !== null} / {info.model.session.maxCalls}{/if} calls{#if info.model.session.expiresAt !== null} · expires {new Date(info.model.session.expiresAt).toLocaleTimeString()}{/if}</span>{/if}{:else}Deterministic test model <span>· No external calls</span>{/if}</div>
    {#if error}<div class="error" role="alert">{error}</div>{/if}
    <main class="transcript" bind:this={transcript} onscroll={() => stickToBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 70}>
      {#if !conversation}<div class="empty"><span class="empty-glyph">✳</span><h2>Start a conversation.</h2><p>Create a thread to try persisted chat.<br>Each exchange keeps its context and Artifact trail.</p></div>
      {:else if !conversation.artifacts.length}<div class="empty"><span class="empty-glyph">✳</span><h2>What’s on your mind?</h2><p>Try a message, then a follow-up.<br>{info?.model?.provider === 'openai' ? 'This session sends conversation context to OpenAI.' : 'The test model shows which conversation it received.'}</p></div>{/if}
      {#each conversation?.artifacts ?? [] as artifact (artifact.id)}
        {@const payload = artifact.payload as MessagePayload}
        {@const run = associatedRun(artifact)}
        <article class:user={payload.speaker === 'user'} data-testid="message" data-artifact-id={artifact.id}>
          <div class="message-heading"><strong>{payload.speaker === 'user' ? 'You' : 'Ash'}</strong>{#if run}<span class="status" class:stopped={['failed','cancelled','interrupted'].includes(run.status)} data-testid="run-status">{run.status}</span>{/if}<button class="inspect" aria-label={`Inspect ${payload.speaker === 'user' ? 'user message' : 'Ash response'}`} onclick={() => inspect(artifact.id)}>Inspect ↗</button></div>
          <div class="message-content">{messageText(payload) || (run?.status === 'completed' ? '(Empty response)' : '…')}</div>
          {#if run?.error}<p class="failure">{run.error.message}</p>{/if}
          {#if run && !isActive(run.status)}<button class="text-button" disabled={!!active || actionBusy[run.id]} onclick={() => runAction(run,'retry')}>Retry response</button>{/if}
          {#if payload.speaker === 'user'}
            {#each outcomes(artifact.sourceId!) as outcome (outcome.id)}<div class="outcome"><span data-testid="run-status">{outcome.status}</span>{#if outcome.error}<span>{outcome.error.message}</span>{/if}{#if !isActive(outcome.status)}<button class="text-button" disabled={!!active} onclick={() => runAction(outcome,'retry')}>Retry response</button>{/if}<button class="text-button" onclick={() => inspect(outcome.state.request_artifact_id)}>Inspect Run</button></div>{/each}
          {/if}
        </article>
      {/each}
    </main>
    <div class="composer">
      {#if conversation}
        <form onsubmit={(e) => {e.preventDefault(); void send();}}>
          <label class="sr-only" for="message">Message</label><textarea id="message" placeholder="Message Ash…" rows="3" maxlength="4000" disabled={!!pending[selected]} value={drafts[selected] ?? ''} oninput={(event) => {drafts[selected] = event.currentTarget.value; saveLocal();}} onkeydown={(event) => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); void send();}}}></textarea>
          <div class="composer-actions"><span>{active ? 'Response in progress · your draft is saved' : 'Enter to send · Shift + Enter for a new line'}</span>{#if active}<button type="button" onclick={() => runAction(active!,'cancel')}>Stop response</button>{:else}<button class="primary" disabled={submitting || !connected || (!pending[selected] && !(drafts[selected] ?? '').trim())}>{pending[selected] ? 'Retry sending' : 'Send message'}</button>{/if}</div>
        </form>
        {#if info?.model?.provider !== 'openai'}<details class="test-controls"><summary>Test response settings</summary><label for="mode">Response behavior</label><select id="mode" bind:value={mode}><option value="normal">Normal</option><option value="slow">Slow streaming</option><option value="fail">Fail after partial output</option><option value="fail-before">Fail before output</option><option value="empty">Empty response</option></select></details>{/if}
      {/if}
    </div>
  </div>
  {#if inspectedId}
    <aside class="inspector" aria-label="Artifact inspector"><div class="inspector-heading"><h2>Artifact inspector</h2><button aria-label="Close inspector" onclick={() => {inspectedId = ''; inspection = null;}}>×</button></div>
      {#if inspection}
        <span class="eyebrow">SELECTED ARTIFACT</span><code>{inspectedId}</code><p>{inspected?.layer} · {inspected?.actor}</p>
        <div class="section"><h3>Originating input</h3><p class="inspect-text">{(inspection.input.payload as {text:string}).text}</p><code>{inspection.input.id}</code></div>
        <div class="section"><h3>Artifact chain</h3>{#each inspection.artifacts as item (item.id)}<button class="chain-item" class:chosen={item.id === inspectedId} onclick={() => inspectedId = item.id}><strong>{item.layer} · {item.payload.type}</strong><code>{item.id}</code><small>Source: {item.sourceId ?? 'Input root'}</small></button>{/each}</div>
        {#if inspectionRun}<div class="section"><h3>Run · {inspectionRun.status}</h3><code>{inspectionRun.id}</code>{#if inspectionRun.retryOfId}<p>Retry of <code>{inspectionRun.retryOfId}</code></p>{/if}<p>Accepted {new Date(inspectionRun.createdAt).toLocaleTimeString()}<br>Started {inspectionRun.startedAt ? new Date(inspectionRun.startedAt).toLocaleTimeString() : 'Not started'}<br>Ended {inspectionRun.endedAt ? new Date(inspectionRun.endedAt).toLocaleTimeString() : 'Not settled'}</p><details><summary>Checkpoint</summary><pre>{JSON.stringify(inspectionRun.state,null,2)}</pre></details></div>{/if}
        {#if captured}<div class="section"><h3>Captured model request</h3><p>{captured.provider} / {captured.model}</p><p>{captured.selection.maxCharacters.toLocaleString()} character context limit · {captured.selection.omitted.length} omitted Artifacts</p>{#each captured.messages as message,index}<div class="context-message"><strong>{index + 1}. {message.role}</strong><p>{message.content}</p></div>{/each}<details><summary>Sources, instructions and omissions</summary><pre>{JSON.stringify(captured.selection,null,2)}</pre></details><details><summary>Generation options</summary><pre>{JSON.stringify(captured.options,null,2)}</pre></details></div>{/if}
        {#if inspectionRun?.state.model}{@const execution = inspectionRun.state.model}<div class="section"><h3>Provider result</h3><p>{execution.model ?? captured?.model} · {execution.status ?? 'No terminal result recorded'}</p>{#if execution.usage}<p>{execution.usage.inputTokens.toLocaleString()} input tokens · {execution.usage.outputTokens.toLocaleString()} output tokens<br>{execution.usage.cachedInputTokens.toLocaleString()} cached input · {execution.usage.reasoningTokens.toLocaleString()} reasoning tokens</p>{:else}<p>Usage unavailable for this attempt.</p>{/if}{#if execution.requestId}<code>Request: {execution.requestId}</code>{/if}{#if execution.responseId}<code>Response: {execution.responseId}</code>{/if}</div>{/if}
        <details class="section"><summary>Artifact payload</summary><pre>{JSON.stringify(inspected?.payload,null,2)}</pre></details><button class="text-button" onclick={() => inspect(inspectedId)}>Refresh inspection</button>
      {:else}<p>Loading Artifact…</p>{/if}
    </aside>
  {/if}
</div>
<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f7f7f2;color:#2d342e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}:global(button),:global(input),:global(textarea),:global(select){font:inherit}:global(button){cursor:pointer}:global(button:disabled){cursor:default;opacity:.45}:global(button:focus-visible),:global(input:focus-visible),:global(textarea:focus-visible),:global(select:focus-visible),:global(summary:focus-visible){outline:2px solid var(--accent);outline-offset:3px}
  .shell{display:flex;height:100vh;min-height:500px;border-top:3px solid var(--accent)}.sidebar{width:235px;flex-shrink:0;background:#eceee7;border-right:1px solid #dde0d6;padding:43px 20px 52px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:9px;font-size:29px;letter-spacing:-1px;font-weight:600;margin-bottom:36px}.brand span{color:var(--accent);font-size:36px}.brand small{font-size:9px;letter-spacing:1px;background:#dfe4d9;color:#64705c;padding:4px;margin-left:5px;border-radius:4px}.new-thread{display:grid;gap:8px}label{font-size:11px;color:#64705e}input{width:100%;border:1px solid #d8dfcf;border-radius:6px;background:#f9faf5;padding:10px;font-size:12px}.new-button{border:0;background:var(--tint);color:var(--accent);border-radius:6px;padding:10px;font-size:12px;text-align:left}nav{overflow:auto;margin-top:24px;flex:1}nav button{display:block;text-align:left;width:100%;border:0;background:transparent;padding:12px 10px;border-radius:6px;margin-bottom:4px;overflow-wrap:anywhere;color:#596352;font-size:13px}nav button.selected{background:#dfe5d7;color:#2d3e28}nav button:hover{background:#e3e8dd}.workspace{display:grid;gap:7px;padding-top:20px;font-size:10px;color:#838b7d}.workspace strong{font-size:11px;overflow-wrap:anywhere;color:#606c59}.eyebrow{font-size:9px;font-weight:600;letter-spacing:1.8px;color:#82907a}.main-column{display:flex;flex-direction:column;flex:1;min-width:330px}header{padding:31px 35px 21px;border-bottom:1px solid #e0e4da;display:flex;justify-content:space-between;gap:20px;-webkit-app-region:drag}h1{font-family:Georgia,serif;font-weight:400;font-size:25px;letter-spacing:-.5px;margin:7px 0 0;overflow-wrap:anywhere}.connection{font-size:10px;display:flex;gap:6px;align-items:center;white-space:nowrap;color:#7f8878}.connection i,.model-dot{display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%}.connection .offline{background:#a77455}.model-banner{padding:12px 35px;font-size:10px;color:#697460;display:flex;gap:7px;align-items:center}.model-banner span:last-child{color:#969d90}.transcript{flex:1;overflow:auto;padding:8px max(30px,calc((100% - 710px)/2));scrollbar-width:thin}.empty{text-align:center;margin:65px 0;color:#929989}.empty-glyph{font-size:45px;color:#9baa8f}.empty h2{font-family:Georgia,serif;font-weight:400;color:#68765b;font-size:27px;margin:22px 0 13px}.empty p{font-size:12px;line-height:1.8}article{padding:20px 22px;margin:12px 0 20px;border:1px solid #e0e5d9;border-radius:12px;background:#fffefa}article.user{background:#eef1e8;border-color:#e3e7db}.message-heading{display:flex;align-items:center;gap:10px;font-size:11px;margin-bottom:12px}.message-heading strong{font-weight:600;color:#526147}.inspect{margin-left:auto;font-size:10px;border:0;background:transparent;color:#819172;padding:2px}.message-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font-size:13px}.status{font-size:9px;color:#8c9784;letter-spacing:.3px}.status.stopped{color:#a1754e}.failure,.outcome{color:#99724d;font-size:11px;line-height:1.6}.outcome{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.text-button{border:0;background:transparent;color:var(--accent);font-size:10px;padding:8px 0;text-decoration:underline;text-underline-offset:3px}.composer{padding:14px 30px 18px;border-top:1px solid #e5e8df}.composer form{max-width:710px;margin:auto;border:1px solid #d9e0cf;border-radius:11px;background:#fffefa;padding:12px}.composer textarea{width:100%;border:0;resize:vertical;min-height:60px;max-height:180px;background:transparent;color:#35422e;line-height:1.6;padding:3px 4px;font-size:13px}.composer-actions{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-top:7px}.composer-actions span{font-size:9px;color:#9aa18f}.composer-actions button{border:1px solid #cdd7c2;border-radius:6px;padding:8px 12px;color:var(--accent);font-size:11px;background:var(--tint)}.composer-actions .primary{background:var(--accent);color:white}.test-controls{max-width:710px;margin:10px auto 0;font-size:10px;color:#8b947f}.test-controls label{margin-right:10px}.test-controls select{margin-top:9px;font-size:11px;background:#f6f8f1;border:1px solid #d9e0d0;border-radius:4px;padding:5px}summary{cursor:pointer}.error{margin:0 30px;padding:10px 14px;background:#f8e9e3;border-radius:6px;color:#965d46;font-size:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  .inspector{width:360px;flex-shrink:0;border-left:1px solid #dce2d3;background:#f0f2ea;padding:24px;overflow:auto;font-size:11px;color:#6a755f}.inspector-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.inspector h2{font-size:15px;font-weight:500;color:#3f5134;margin:0}.inspector-heading button{border:0;background:transparent;color:#7c896f;font-size:22px}.inspector h3{font-size:12px;font-weight:600;color:#596b4d;margin:0 0 10px}.inspector code{display:block;font-size:9px;overflow-wrap:anywhere;margin-top:7px;color:#8a957f}.inspector p{line-height:1.7}.section{border-top:1px solid #dbe2d1;padding-top:18px;margin-top:20px}.inspect-text{white-space:pre-wrap;overflow-wrap:anywhere}.chain-item{display:block;width:100%;text-align:left;border:1px solid #dce3d1;background:transparent;border-radius:6px;padding:10px;margin-bottom:7px;color:#6f7e63}.chain-item.chosen{background:#e2e9d9;border-color:#bbcbaa}.chain-item strong{font-size:10px;font-weight:500}.chain-item small{display:block;font-size:8px;margin-top:6px;overflow-wrap:anywhere}.context-message{background:#f9faf5;border:1px solid #dfe6d5;border-radius:6px;padding:11px;margin:10px 0}.context-message strong{font-size:10px}.context-message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}.inspector details{margin-top:12px}.inspector pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:9px;line-height:1.6;color:#6c7d60}
  @media(max-width:1050px){.sidebar{width:195px;padding-left:15px;padding-right:15px}.inspector{position:fixed;right:0;top:3px;bottom:0;z-index:4;box-shadow:-12px 0 30px #33452715}.transcript{padding:8px 22px}header{padding-left:25px}}
</style>
