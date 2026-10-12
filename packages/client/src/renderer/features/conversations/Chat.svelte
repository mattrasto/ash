<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { isActive, modelContentText, IMAGE_LIMITS, type AttachmentView, type ArtifactView, type ConversationView, type InspectionView, type MessagePayload, type ModelMode, type PreviewInfo, type RequestPayload, type RunView, type ThreadView } from '@ash/shared';
  import Sidebar from './Sidebar.svelte';
  import Message from './Message.svelte';
  import Icon from './Icon.svelte';
  import { ConversationScroll, type ScrollPosition } from './scroll.ts';
  import Gallery from '../images/Gallery.svelte';
  import Viewer from '../images/Viewer.svelte';
  import { uploadImage, type DraftImage } from '../images/uploads.ts';
  type Pending = {requestKey:string;text:string;mode:ModelMode;attachmentIds?:string[]};
  let info = $state<PreviewInfo | null>(null);
  let threads = $state<ThreadView[]>([]);
  let selected = $state('');
  let conversation = $state<ConversationView | null>(null);
  let drafts = $state<Record<string,string>>({});
  let draftImages=$state<Record<string,DraftImage[]>>({});
  let viewer=$state<{images:AttachmentView[];index:number}|null>(null);
  let fileInput=$state<HTMLInputElement>(),textarea=$state<HTMLTextAreaElement>();
  let dragDepth=0,isDragOver=$state(false),jumpVisible=$state(false);
  const localFiles=new Map<string,{file:File;preview?:string;xhr?:XMLHttpRequest}>();
  let uploadTail:Promise<unknown>=Promise.resolve();
  const checkedDrafts=new Set<string>();
  const images=$derived(draftImages[selected]??[]);
  const imagesPending=$derived(images.some(image=>image.status!=='ready'));
  let pending = $state<Record<string,Pending>>({});
  let retryCommands = $state<Record<string,{requestKey:string;mode:ModelMode}>>({});
  let actionBusy = $state<Record<string,boolean>>({});
  let sidebarOpen=$state(true);
  let readRuns=$state<Record<string,string>>({});
  let scrollPositions:Record<string,ScrollPosition>={};
  let scrolling:ConversationScroll|undefined;
  let content:HTMLDivElement,spacer:HTMLDivElement;
  let restoring=true,scrollTimer:ReturnType<typeof setTimeout>;
  let inspectionFocus:HTMLElement|null=null;
  let pendingThread: {id:string;title:string} | null = null;
  let error = $state('');
  let connected = $state(false);
  let submitting = $state(false);
  let creating = $state(false);
  let mode = $state<ModelMode>('normal');
  let inspection = $state<InspectionView | null>(null);
  let inspectedId = $state('');
  let transcript: HTMLElement;

  let requestSequence = 0,threadRevision=0;
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
    localStorage.setItem('ash-chat-images',JSON.stringify(Object.fromEntries(Object.entries(draftImages).map(([id,items])=>[id,items.map(({preview,...item})=>item)]))));
  }
  function openImages(images:AttachmentView[],index:number){viewer={images,index};}
  function currentImage(image:AttachmentView){return conversation?.attachments?.find(a=>a.id===image.id)??Object.values(draftImages).flatMap(items=>items).find(a=>a.id===image.id)?.attachment??inspection?.attachments?.find(a=>a.id===image.id)??image;}
  function messageImages(payload:MessagePayload){return payload.content.flatMap(block=>block.type==='image'?conversation?.attachments?.filter(a=>a.id===block.attachmentId)??[]:[]);}
  function clearImages(thread:string,ids:string[]){for(const id of ids)removeImage(thread,id);}
  function removeImage(thread:string,id:string){
    draftImages[thread]=(draftImages[thread]??[]).filter(image=>image.id!==id);
    const local=localFiles.get(id);local?.xhr?.abort();if(local?.preview)URL.revokeObjectURL(local.preview);localFiles.delete(id);saveLocal();
  }
  function queueUpload(thread:string,id:string) {
    const file=localFiles.get(id)?.file;
    if(!file){error='Choose this image again to retry its upload.';return;}
    const patch=(value:Partial<DraftImage>)=>{draftImages[thread]=(draftImages[thread]??[]).map(item=>item.id===id?{...item,...value}:item);};
    patch({status:'uploading',progress:0,error:undefined});saveLocal();
    uploadTail=uploadTail.then(async()=>{
      if(!(draftImages[thread]??[]).some(item=>item.id===id))return;
      try {
        const attachment=await uploadImage(id,file,progress=>patch({progress}),xhr=>{const local=localFiles.get(id);if(local)local.xhr=xhr;});
        patch({status:'ready',progress:1,attachment});
      }catch(e){patch({status:'error',error:(e as Error).message});}
      saveLocal();
    });
  }
  function addFiles(files:FileList|File[]) {
    const thread=selected;if(!thread||pending[thread])return;
    const list=Array.from(files),existing=draftImages[thread]??[];
    if([...list,...existing].reduce((n,file)=>n+file.size,0)>IMAGE_LIMITS.perMessage){error='Images in one message must total at most 20 MiB.';return;}
    error='';
    for(const file of list){
      const id=crypto.randomUUID();
      const problem=file.size>IMAGE_LIMITS.perFile?'Each image must be at most 10 MiB.':file.type&&!['image/png','image/jpeg','image/webp'].includes(file.type)?'Choose a PNG, JPEG or WebP image.':undefined;
      const preview=!problem&&file.type.startsWith('image/')?URL.createObjectURL(file):undefined;
      localFiles.set(id,{file,preview});
      draftImages[thread]=[...(draftImages[thread]??[]),{id,filename:file.name,size:file.size,status:problem?'error':'uploading',progress:0,error:problem,preview}];
      if(!problem)queueUpload(thread,id);
    }
    saveLocal();textarea?.focus();
  }
  async function retryDescription(image:AttachmentView){
    if(!image.summaryRun)return;
    const value=await api<AttachmentView>(`attachments/${image.id}/retry`,{requestKey:crypto.randomUUID(),previousId:image.summaryRun.id});
    if(viewer)viewer={...viewer,images:viewer.images.map(a=>a.id===value.id?value:a)};
    for(const thread of Object.keys(draftImages))draftImages[thread]=draftImages[thread].map(a=>a.id===value.id?{...a,attachment:value}:a);
    await refresh();
  }
  function paste(event:ClipboardEvent){
    const files=Array.from(event.clipboardData?.items??[]).filter(item=>item.kind==='file').flatMap(item=>{const file=item.getAsFile();return file?[file]:[];});
    if(files.length){event.preventDefault();addFiles(files);}
  }
  function drag(event:DragEvent,phase:'enter'|'over'|'leave'|'drop'){
    if(!event.dataTransfer?.types.includes('Files'))return;
    event.preventDefault();if(phase==='enter'){dragDepth++;isDragOver=true;}
    if(phase==='leave'){dragDepth=Math.max(0,dragDepth-1);isDragOver=dragDepth>0;}
    if(phase==='drop'){dragDepth=0;isDragOver=false;if(event.dataTransfer.files.length)addFiles(event.dataTransfer.files);}
  }
  function scroll(){scrolling?.scroll();clearTimeout(scrollTimer);scrollTimer=setTimeout(rememberScroll,200);}
  function rememberScroll(){if(selected&&!restoring&&scrolling){scrollPositions[selected]=scrolling.position();localStorage.setItem('ash-chat-scroll',JSON.stringify(scrollPositions));}}
  function latest(){scrolling?.latest();rememberScroll();}
  function autosize(){if(textarea){textarea.style.height='auto';textarea.style.height=`${Math.min(200,Math.max(30,textarea.scrollHeight))}px`;}}
  function toggleSidebar(){sidebarOpen=!sidebarOpen;localStorage.setItem('ash-sidebar-open',String(sidebarOpen));}
  function closeInspector(){inspectedId='';inspection=null;inspectionFocus?.focus({preventScroll:true});}
  function key(event:KeyboardEvent){
    if(viewer)return;
    if(event.key==='Escape'&&inspectedId){event.preventDefault();closeInspector();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'){event.preventDefault();if(connected)void createThread();}
    if((event.metaKey||event.ctrlKey)&&event.key==='\\'){event.preventDefault();toggleSidebar();}
  }
  async function updateThread(id:string,change:{title?:string;isArchived?:boolean}){
    threadRevision++;
    try{
      await api(`threads/${id}`,change);
      threads=threads.map(thread=>thread.id===id?{...thread,...change}:thread);
      if(conversation?.thread.id===id)conversation={...conversation,thread:{...conversation.thread,...change}};
      if(change.isArchived&&selected===id){const next=threads.find(thread=>!thread.isArchived);if(next)await selectThread(next.id);else await createThread();}
      await refresh();return true;
    }catch(e){error=(e as Error).message;return false;}finally{threadRevision++;}
  }
  async function loadThread(id:string) {
    const sequence = ++requestSequence;
    const revision=threadRevision;
    const value = await api<ConversationView>(`threads/${id}`);
    if (selected !== id || sequence !== requestSequence || revision!==threadRevision) return;
    const initial=conversation===null;
    conversation = value;
    const last=value.runs.at(-1);if(last&&!isActive(last.status)&&readRuns[id]!==last.id){readRuns[id]=last.id;localStorage.setItem('ash-read-runs',JSON.stringify(readRuns));}
    if(initial){await tick();autosize();scrolling?.restore(scrollPositions[id]);restoring=false;}
    const delivery = pending[id];
    if (delivery && value.runs.some(run => run.requestKey === delivery.requestKey)) {
      if ((drafts[id] ?? '').trim() === delivery.text) drafts[id] = '';
      clearImages(id,delivery.attachmentIds??[]);
      delete pending[id]; saveLocal();
    }
    for (const [runId,command] of Object.entries(retryCommands)) {
      if (value.runs.some(run=>run.requestKey===command.requestKey)) { delete retryCommands[runId]; saveLocal(); }
    }
    await tick();scrolling?.layout();
  }
  async function selectThread(id:string) {
    rememberScroll();restoring=true;selected = id; conversation = null; inspection = null; inspectedId = ''; error = '';jumpVisible=false; saveLocal();
    try { await loadThread(id);await tick();autosize(); } catch (e) { error = (e as Error).message; }
  }
  async function refresh() {
    const revision=threadRevision;
    try {
      info = await api<PreviewInfo>('info');
      if (info.model?.provider === 'openai') mode = 'normal';
      const listed=await api<ThreadView[]>('threads');
      if(revision!==threadRevision)return;
      threads=listed;
      if (!selected && threads.length) selected = (threads.find(thread=>!thread.isArchived)??threads[0]).id;
      if (!creating && selected && !threads.some(thread => thread.id === selected)) { selected = threads[0]?.id ?? ''; conversation = null; }
      if (selected) await loadThread(selected);
      for(const [thread,items] of Object.entries(draftImages))for(const item of items)if(item.status==='ready' && (!checkedDrafts.has(item.id)||item.attachment?.summaryRun&&isActive(item.attachment.summaryRun.status)||item.attachment?.expiresAt&&Date.parse(item.attachment.expiresAt)<=Date.now())) {
        try{const attachment=await api<AttachmentView>(`attachments/${item.id}`);checkedDrafts.add(item.id);draftImages[thread]=(draftImages[thread]??[]).map(a=>a.id===item.id?{...a,attachment}:a);}
        catch(e){if(e instanceof ApiError&&e.status===404)draftImages[thread]=(draftImages[thread]??[]).map(a=>a.id===item.id?{...a,status:'error',error:'This upload expired. Choose the image again.'}:a);}
      }
      if (inspectedId && inspection?.runs.some(run=>isActive(run.status))) await inspect(inspectedId);
      connected = true;
      if(!threads.length&&!creating)await createThread();
    } catch { connected = false; }
  }
  async function createThread() {
    if (creating||!connected) return;
    creating = true; error = '';threadRevision++;
    const command = pendingThread ?? {id:crypto.randomUUID(),title:'New conversation'};
    pendingThread = command; localStorage.setItem('ash-chat-new-thread',JSON.stringify(command));
    try { await api('threads',command); pendingThread = null; localStorage.removeItem('ash-chat-new-thread'); await selectThread(command.id);textarea?.focus();threads=await api<ThreadView[]>('threads'); }
    catch (e) { error = (e as Error).message; }
    finally { creating = false;threadRevision++; }
  }
  async function send() {
    const id = selected;
    if (!id || submitting || active || imagesPending || !connected) return;
    const command = pending[id] ?? {requestKey:crypto.randomUUID(),text:(drafts[id] ?? '').trim(),mode,attachmentIds:images.map(image=>image.id)};
    if (!command.text && !command.attachmentIds?.length) return;
    pending[id] = command; saveLocal(); submitting = true; error = '';
    try {
      await api(`threads/${id}/messages`,command);
      if ((drafts[id] ?? '').trim() === command.text) drafts[id] = '';
      clearImages(id,command.attachmentIds??[]);
      delete pending[id]; saveLocal();
      if (selected === id) {await loadThread(id);await tick();autosize();scrolling?.anchor();textarea?.focus();}
    } catch (e) {
      if (e instanceof ApiError && e.status && e.status < 500) { delete pending[id]; saveLocal(); }
      error = (e as Error).message;
    } finally { submitting = false; }
  }
  async function inspect(id:string) {
    if(!inspectedId)inspectionFocus=document.activeElement as HTMLElement;
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
    try { pendingThread = JSON.parse(localStorage.getItem('ash-chat-new-thread') ?? 'null'); drafts = JSON.parse(localStorage.getItem('ash-chat-drafts') ?? '{}'); pending = JSON.parse(localStorage.getItem('ash-chat-pending') ?? '{}'); retryCommands = JSON.parse(localStorage.getItem('ash-chat-retries') ?? '{}'); selected = localStorage.getItem('ash-chat-selected') ?? ''; } catch { drafts = {}; pending = {}; }
    try{draftImages=JSON.parse(localStorage.getItem('ash-chat-images')??'{}');for(const thread of Object.keys(draftImages))draftImages[thread]=draftImages[thread].map(image=>image.status==='uploading'?{...image,status:'error',error:'Upload interrupted. Choose the image again.'}:image);}catch{draftImages={};}
    try{readRuns=JSON.parse(localStorage.getItem('ash-read-runs')??'{}');scrollPositions=JSON.parse(localStorage.getItem('ash-chat-scroll')??'{}');sidebarOpen=localStorage.getItem('ash-sidebar-open')!=='false';}catch{}
    scrolling=new ConversationScroll(transcript,content,spacer,visible=>jumpVisible=visible);
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!disposed) timer = setTimeout(poll,active ? 150 : 800); };
    void poll();
    return () => { disposed = true; clearTimeout(timer); requestSequence++;scrolling?.dispose();clearTimeout(scrollTimer);for(const local of localFiles.values()){local.xhr?.abort();if(local.preview)URL.revokeObjectURL(local.preview);} };
  });
</script>

<svelte:window onkeydown={key}/>
<svelte:head><title>Ash — {conversation?.thread.title ?? 'Chat'}</title></svelte:head>
<div class="shell" style={`--accent:hsl(${hue} 29% 37%);--tint:hsl(${hue} 24% 92%)`}>
  {#if sidebarOpen}<Sidebar {threads} {selected} {connected} {creating} {readRuns} onSelect={selectThread} onCreate={createThread} onUpdate={updateThread} onClose={toggleSidebar}/>{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="main-column" ondragenter={(e)=>drag(e,'enter')} ondragover={(e)=>drag(e,'over')} ondragleave={(e)=>drag(e,'leave')} ondrop={(e)=>drag(e,'drop')}>
    {#if isDragOver}<div class="drop-overlay"><strong>Drop images here</strong><span>PNG, JPEG or WebP</span></div>{/if}
    <header>{#if !sidebarOpen}<button class="icon-button" aria-label="Show sidebar" title="Show sidebar" onclick={toggleSidebar}><Icon name="sidebar"/></button>{/if}<div class="heading"><span class="eyebrow">CONVERSATION</span><h1>{conversation?.thread.title ?? 'New conversation'}</h1>{#if conversation?.thread.isArchived}<span class="archived-label">Archived</span>{/if}</div><span class="connection" data-testid="connection"><i class:offline={!connected}></i>{connected ? 'Connected' : 'Reconnecting…'}</span></header>
    <div class="model-banner"><span class="model-dot"></span>{#if info?.model?.provider === 'openai'}OpenAI · {info.model.model}{#if info.model.session}<span>· {info.model.session.callsUsed}{#if info.model.session.maxCalls !== null} / {info.model.session.maxCalls}{/if} calls{#if info.model.session.expiresAt !== null} · expires {new Date(info.model.session.expiresAt).toLocaleTimeString()}{/if}</span>{/if}{:else}Deterministic test model <span>· No external calls</span>{/if}</div>
    {#if error}<div class="error" role="alert">{error}</div>{/if}
    <main class="transcript" bind:this={transcript} onscroll={scroll} onwheel={e=>scrolling?.intent(e.deltaY<0)}><div class="messages" bind:this={content}>
      {#if !conversation}<div class="empty"><span class="empty-glyph">✳</span><h2>Start a conversation.</h2><p>Connecting to your conversations…</p></div>
      {:else if !conversation.artifacts.length}<div class="empty"><span class="empty-glyph">✳</span><h2>What’s on your mind?</h2><p>Ask a question, share an image, or start with a thought.</p></div>{/if}
      {#each conversation?.artifacts ?? [] as artifact (artifact.id)}
        {@const payload = artifact.payload as MessagePayload}
        {@const run = associatedRun(artifact)}
        <Message {artifact} {run} outcomes={payload.speaker==='user'?outcomes(artifact.sourceId!):[]} images={messageImages(payload)} blocked={!!active||!!(run&&actionBusy[run.id])} onInspect={inspect} onRetry={run=>runAction(run,'retry')} onOpen={openImages}/>

      {/each}
    </div><div class="bottom-spacer" bind:this={spacer} aria-hidden="true"></div></main>
    <div class="composer">
      {#if jumpVisible}<button class="jump-latest" onclick={latest}>↓ Latest messages</button>{/if}
      {#if conversation}
        <form onsubmit={(e) => {e.preventDefault(); void send();}}>
          {#if images.length}<div class="draft-images">{#each images as image (image.id)}<div class="draft-image" class:upload-error={image.status==='error'} data-testid="draft-image"><button type="button" class="draft-thumb" disabled={!image.attachment} aria-label={`Preview ${image.filename}`} onclick={()=>openImages(images.flatMap(item=>item.attachment?[item.attachment]:[]),images.filter(item=>item.attachment).findIndex(item=>item.id===image.id))}>{#if image.preview||image.attachment}<img src={image.preview??`/api/attachments/${image.id}/thumbnail`} alt={image.attachment?.summary??image.filename}/>{:else}<span>▧</span>{/if}</button><div class="draft-meta"><strong>{image.filename}</strong><span>{image.status==='uploading'?(image.progress<1?`Uploading ${Math.round(image.progress*100)}%`:'Processing image…'):image.status==='error'?image.error:`${Math.round(image.size/1024)} KB`}</span>{#if image.status==='error'&&localFiles.has(image.id)}<button type="button" onclick={()=>queueUpload(selected,image.id)}>Retry upload</button>{/if}</div><button class="remove-image" type="button" disabled={!!pending[selected]} aria-label={`Remove ${image.filename}`} onclick={()=>removeImage(selected,image.id)}>×</button></div>{/each}</div>{/if}
          <input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple bind:this={fileInput} aria-label="Choose images" onchange={(event)=>{if(event.currentTarget.files)addFiles(event.currentTarget.files);event.currentTarget.value='';}}/>
          <label class="sr-only" for="message">Message</label><textarea bind:this={textarea} id="message" placeholder="Message Ash…" rows="1" maxlength="4000" disabled={!!pending[selected]} value={drafts[selected] ?? ''} onpaste={paste} oninput={(event) => {drafts[selected] = event.currentTarget.value; saveLocal();autosize();}} onkeydown={(event) => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); void send();}}}></textarea>
          <div class="composer-actions"><button class="attach" type="button" aria-label="Attach images" title="Attach images" disabled={!!pending[selected]} onclick={()=>fileInput?.click()}><Icon name="attach"/></button><span>{imagesPending?(images.some(image=>image.status==='error')?'Retry or remove failed uploads':'Uploading images…'):active ? 'Response in progress · your draft is saved' : 'Enter to send · Shift + Enter for a new line'}</span>{#if active}<button type="button" class="stop" aria-label="Stop response" title="Stop response" disabled={actionBusy[active.id]} onclick={() => runAction(active!,'cancel')}><Icon name="stop"/></button>{:else}<button class="primary" aria-label={pending[selected]?'Retry sending':'Send message'} title={pending[selected]?'Retry sending':'Send message'} disabled={submitting || !connected || imagesPending || (!pending[selected] && !(drafts[selected] ?? '').trim()&&!images.length)}><Icon name={pending[selected]?'retry':'send'}/></button>{/if}</div>
        </form>
        {#if info?.model?.provider !== 'openai'}<details class="test-controls"><summary>Test response settings</summary><label for="mode">Response behavior</label><select id="mode" bind:value={mode}><option value="normal">Normal</option><option value="slow">Slow streaming</option><option value="fail">Fail after partial output</option><option value="fail-before">Fail before output</option><option value="empty">Empty response</option></select></details>{/if}
      {/if}
    </div>
  </div>
  {#if inspectedId}
    <aside class="inspector" aria-label="Artifact inspector"><div class="inspector-heading"><h2>Artifact inspector</h2><button aria-label="Close inspector" onclick={closeInspector}>×</button></div>
      {#if inspection}
        <span class="eyebrow">SELECTED ARTIFACT</span><code>{inspectedId}</code><p>{inspected?.layer} · {inspected?.actor}</p>
        <div class="section"><h3>Originating input</h3><p class="inspect-text">{'text' in inspection.input.payload?inspection.input.payload.text:inspection.input.payload.type==='image_upload'?inspection.input.payload.filename:''}</p><code>{inspection.input.id}</code></div>
        {#if inspection.attachments?.length}<div class="section"><h3>Images</h3>{#each inspection.attachments as image (image.id)}<Gallery images={[image]} onOpen={openImages}/><p>{image.filename}<br>{image.metadata.original.width} × {image.metadata.original.height} original · {image.metadata.model.width} × {image.metadata.model.height} model input</p><p>{image.summary??'Description not yet available.'}</p>{#if image.summaryRun}<p>Description: {image.summaryRun.status}</p><button class="text-button" onclick={()=>inspect(image.summaryRun!.state.request_artifact_id)}>Inspect description</button>{#if !isActive(image.summaryRun.status)&&image.summaryRun.status!=='completed'}<button class="text-button" onclick={()=>retryDescription(image).catch(e=>error=e.message)}>Retry description</button>{/if}{/if}<details><summary>Image identity and hashes</summary><code>{image.id}</code><pre>{JSON.stringify(image.metadata,null,2)}</pre></details>{/each}</div>{/if}
        <details class="section"><summary>Artifact chain</summary>{#each inspection.artifacts as item (item.id)}<button class="chain-item" class:chosen={item.id === inspectedId} onclick={() => inspectedId = item.id}><strong>{item.layer} · {item.payload.type}</strong><code>{item.id}</code><small>Source: {item.sourceId ?? 'Input root'}</small></button>{/each}</details>
        {#if inspectionRun}<div class="section"><h3>Run · {inspectionRun.status}</h3><code>{inspectionRun.id}</code>{#if inspectionRun.retryOfId}<p>Retry of <code>{inspectionRun.retryOfId}</code></p>{/if}<p>Accepted {new Date(inspectionRun.createdAt).toLocaleTimeString()}<br>Started {inspectionRun.startedAt ? new Date(inspectionRun.startedAt).toLocaleTimeString() : 'Not started'}<br>Ended {inspectionRun.endedAt ? new Date(inspectionRun.endedAt).toLocaleTimeString() : 'Not settled'}</p><details><summary>Checkpoint</summary><pre>{JSON.stringify(inspectionRun.state,null,2)}</pre></details></div>{/if}
        {#if captured}<div class="section"><h3>Captured model request</h3><p>{captured.provider} / {captured.model}</p><p>{captured.selection.maxCharacters.toLocaleString()} character context limit · {captured.selection.omitted.length} omitted Artifacts</p>{#each captured.messages as message,index}<div class="context-message"><strong>{index + 1}. {message.role}</strong><p>{modelContentText(message.content)}</p>{#if Array.isArray(message.content)}{#each message.content as block}{#if block.type==='image'}<img class="captured-image" src={`/api/attachments/${block.attachmentId}/model`} alt={block.description}/><small>Pixels included · {block.image.width} × {block.image.height} · {block.detail}</small><code>{block.image.hash}</code>{/if}{/each}{/if}</div>{/each}<button class="text-button" onclick={()=>window.ashMedia.copyText(captured!.messages.map(message=>`${message.role}:\n${modelContentText(message.content)}`).join('\n\n')).catch(()=>error='Could not copy context.')}>Copy text-only context</button><details><summary>Sources, instructions and omissions</summary><pre>{JSON.stringify(captured.selection,null,2)}</pre></details><details><summary>Generation options</summary><pre>{JSON.stringify(captured.options,null,2)}</pre></details></div>{/if}
        {#if inspectionRun?.state.model}{@const execution = inspectionRun.state.model}<div class="section"><h3>Provider result</h3><p>{execution.model ?? captured?.model} · {execution.status ?? 'No terminal result recorded'}</p>{#if execution.usage}<p>{execution.usage.inputTokens.toLocaleString()} input tokens · {execution.usage.outputTokens.toLocaleString()} output tokens<br>{execution.usage.cachedInputTokens.toLocaleString()} cached input · {execution.usage.reasoningTokens.toLocaleString()} reasoning tokens</p>{:else}<p>Usage unavailable for this attempt.</p>{/if}{#if execution.requestId}<code>Request: {execution.requestId}</code>{/if}{#if execution.responseId}<code>Response: {execution.responseId}</code>{/if}</div>{/if}
        <details class="section"><summary>Artifact payload</summary><pre>{JSON.stringify(inspected?.payload,null,2)}</pre></details><button class="text-button" onclick={() => inspect(inspectedId)}>Refresh inspection</button>
      {:else}<p>Loading Artifact…</p>{/if}
    </aside>
  {/if}
</div>
{#if viewer}<Viewer images={viewer.images.map(currentImage)} startIndex={viewer.index} onClose={()=>viewer=null} onRetry={retryDescription}/>{/if}
<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f7f7f2;color:#2d342e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}:global(button),:global(input),:global(textarea),:global(select){font:inherit}:global(button){cursor:pointer}:global(button:disabled){cursor:default;opacity:.45}:global(button:focus-visible),:global(input:focus-visible),:global(textarea:focus-visible),:global(select:focus-visible),:global(summary:focus-visible){outline:2px solid var(--accent);outline-offset:3px}
  .archived-label{display:inline-block;font-size:10px;color:#8b947f;margin-top:5px}
  .shell{display:flex;height:100vh;min-height:400px;border-top:3px solid var(--accent)}.main-column{position:relative;display:flex;flex-direction:column;flex:1;min-width:300px}header{padding:25px 30px 16px;display:flex;align-items:center;gap:14px;-webkit-app-region:drag}.heading{flex:1;min-width:0}h1{font-family:Georgia,serif;font-weight:400;font-size:23px;letter-spacing:-.5px;margin:6px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.eyebrow{font-size:9px;font-weight:600;letter-spacing:1.8px;color:#82907a}.icon-button{border:0;background:transparent;display:flex;color:#7e8a73;padding:6px;-webkit-app-region:no-drag}.connection{font-size:10px;display:flex;gap:6px;align-items:center;white-space:nowrap;color:#7f8878}.connection i,.model-dot{display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%}.connection .offline{background:#a77455}.model-banner{padding:0 30px 12px;font-size:10px;color:#7c8772;display:flex;gap:7px;align-items:center}.model-banner span:last-child{color:#969d90}
  .transcript{flex:1;overflow:auto;padding:0 max(24px,calc((100% - 730px)/2));scrollbar-width:thin;overflow-anchor:none}.messages{display:flow-root}.bottom-spacer{pointer-events:none}.empty{text-align:center;margin:65px 0;color:#929989}.empty-glyph{font-size:45px;color:#9baa8f}.empty h2{font-family:Georgia,serif;font-weight:400;color:#68765b;font-size:27px;margin:22px 0 13px}.empty p{font-size:12px;line-height:1.8}
  .composer{position:relative;padding:12px 24px 18px}.composer form{max-width:730px;margin:auto;border:1px solid #d9e0cf;border-radius:14px;background:#fffefa;padding:12px;transition:border-color .15s}.composer form:focus-within{border-color:#9bad8b}.composer textarea{display:block;width:100%;border:0;outline:none;resize:none;min-height:30px;max-height:200px;background:transparent;color:#35422e;line-height:1.6;padding:3px 4px;font-size:14px}.composer textarea:focus-visible{outline:none}.composer-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:5px}.composer-actions span{font-size:9px;color:#9aa18f}.composer-actions button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #cdd7c2;border-radius:50%;padding:6px;color:var(--accent);background:var(--tint);flex-shrink:0}.composer-actions .primary{background:var(--accent);color:white}.composer-actions .attach{background:transparent;border-color:transparent}.composer-actions .stop{color:#966b51;background:#f6eee7;border-color:#ddc9b9}.jump-latest{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);border:1px solid #ccd5c1;background:#fafcf5;border-radius:20px;padding:8px 14px;font-size:11px;color:var(--accent);box-shadow:0 3px 12px #20351d15;white-space:nowrap}
  .draft-images{display:flex;gap:8px;flex-wrap:wrap;padding:0 0 9px}.draft-image{display:flex;align-items:center;gap:7px;border:1px solid #dce3d3;border-radius:7px;max-width:240px;padding:5px;background:#f3f5ed;min-width:0}.draft-thumb{width:43px;height:43px;border:0;background:#e5ebdc;border-radius:4px;padding:0;overflow:hidden;flex-shrink:0}.draft-thumb img{width:100%;height:100%;object-fit:cover}.draft-meta{display:grid;gap:3px;min-width:0}.draft-meta strong{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.draft-meta span{font-size:9px;color:#89967a;max-width:155px;overflow-wrap:anywhere}.draft-meta button{font-size:10px;border:0;background:transparent;color:var(--accent);padding:0;text-align:left}.remove-image{border:0;background:transparent;color:#839273;font-size:16px;align-self:flex-start;padding:0 3px}.upload-error{border-color:#bb957d}.upload-error .draft-meta span{color:#9d644b}.drop-overlay{position:absolute;inset:12px;border:2px dashed var(--accent);border-radius:15px;z-index:8;background:#f3f6eced;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--accent)}.drop-overlay strong{font:25px Georgia,serif}.drop-overlay span{font-size:12px}
  .test-controls{max-width:730px;margin:9px auto 0;font-size:10px;color:#8b947f}.test-controls label{margin-right:10px}.test-controls select{margin-top:9px;font-size:11px;background:#f6f8f1;border:1px solid #d9e0d0;border-radius:4px;padding:5px}summary{cursor:pointer}.error{margin:0 24px;padding:10px 14px;background:#f8e9e3;border-radius:6px;color:#965d46;font-size:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.text-button{border:0;background:transparent;color:var(--accent);font-size:10px;padding:8px 0;text-decoration:underline;text-underline-offset:3px}.captured-image{display:block;max-width:100%;max-height:190px;object-fit:contain;margin:10px auto}.context-message small{font-size:9px;color:#7b8a6d}
  .inspector{width:360px;flex-shrink:0;border-left:1px solid #dce2d3;background:#f0f2ea;padding:24px;overflow:auto;font-size:11px;color:#6a755f}.inspector-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.inspector h2{font-size:15px;font-weight:500;color:#3f5134;margin:0}.inspector-heading button{border:0;background:transparent;color:#7c896f;font-size:22px}.inspector h3{font-size:12px;font-weight:600;color:#596b4d;margin:0 0 10px}.inspector code{display:block;font-size:9px;overflow-wrap:anywhere;margin-top:7px;color:#8a957f}.inspector p{line-height:1.7}.section{border-top:1px solid #dbe2d1;padding-top:18px;margin-top:20px}.inspect-text{white-space:pre-wrap;overflow-wrap:anywhere}.chain-item{display:block;width:100%;text-align:left;border:1px solid #dce3d1;background:transparent;border-radius:6px;padding:10px;margin-bottom:7px;color:#6f7e63}.chain-item.chosen{background:#e2e9d9;border-color:#bbcbaa}.chain-item strong{font-size:10px;font-weight:500}.chain-item small{display:block;font-size:8px;margin-top:6px;overflow-wrap:anywhere}.context-message{background:#f9faf5;border:1px solid #dfe6d5;border-radius:6px;padding:11px;margin:10px 0}.context-message strong{font-size:10px}.context-message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}.inspector details{margin-top:12px}.inspector pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:9px;line-height:1.6;color:#6c7d60}
  @media(max-width:1050px){.inspector{position:fixed;right:0;top:3px;bottom:0;z-index:4;box-shadow:-12px 0 30px #33452715}.transcript{padding:0 22px}header{padding-left:22px}.composer-actions span{max-width:220px}}@media(prefers-reduced-motion:reduce){.composer form{transition:none}}
</style>
