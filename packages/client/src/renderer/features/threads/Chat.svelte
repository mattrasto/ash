<script lang="ts">
  import Rail from '../../ui/Rail.svelte';
  import Status from "../../ui/Status.svelte";
  import {selectField} from '../../ui/select.ts';
  import {dismissPopups} from '../../ui/popup.ts';
  import {replaceContent} from '../../ui/replacement.ts';
  import Scene from '../../ui/Scene.svelte';
  import {surface,mist,departComposition,settleComposition} from '../../ui/surface.ts';
  import {scrollArea} from '../../ui/scroll.ts';
  import ThreadEvent from './ThreadEvent.svelte';
  import { DraftPresenceSync } from './drafts';
  import { onMount, tick } from 'svelte';
  import { isActive, isVideoAttachment,formatVideoDuration, modelContentText, IMAGE_LIMITS, VIDEO_LIMITS, type AssessmentDetail,type ApplicationChangeView,type ThreadChange,type RecordingState,type RecordingFile, type AttachmentView, type ArtifactView, type ThreadDetail, type InspectionView, type MessagePayload, type ModelMode, type PreviewInfo, type RequestPayload, type RunView, type ThreadView } from '@ash/shared';
  import Processing from '../artifacts/Processing.svelte';
  let processing=$state(false);
  import Sidebar from './Sidebar.svelte';
  import Visibility from './Visibility.svelte';
  let visibilityId=$state('');
  let lastEdit=$state<{id:string;version:number}|null>(null);
  type Change=Omit<ThreadChange,'requestId'|'expectedVersion'>;
  import PreviewBar from '../../app/PreviewBar.svelte';
  import Message from './Message.svelte';
  import ToolInspection from './ToolInspection.svelte';
  import Icon from './Icon.svelte';
  import { ThreadScroll, type ScrollPosition } from './scroll.ts';
  import Gallery from '../images/Gallery.svelte';
  import Viewer from '../images/Viewer.svelte';
  import { uploadImage, type DraftImage } from '../images/uploads.ts';
  import {recordScreen,type Recorder} from '../recording/recorder.ts';
  import Settings from '../organization/Settings.svelte';
  import ContextView from '../organization/ContextView.svelte';
  import RetrievedContext from '../organization/RetrievedContext.svelte';
  import type { TopicView } from '@ash/shared';
  import type { DecisionView, SavePermission } from '@ash/shared';
  import DecisionsPage from '../decisions/Page.svelte';
  import DecisionCard from '../decisions/Card.svelte';
  type Pending = {requestKey:string;text:string;mode:ModelMode;attachmentIds?:string[]};
  let info = $state<PreviewInfo | null>(null);
  let threads = $state<ThreadView[]>([]);
  let topics=$state<TopicView[]>([]);
  let decisions=$state<DecisionView[]>([]),decisionsOpen=$state(false);
  let proposedRule=$state<SavePermission|undefined>(undefined),settingsTab=$state<'instructions'|'permissions'>('instructions');
  let navigationSequence=0;
  async function closeDecisions(){const sequence=++navigationSequence;dismissPopups();await departComposition(document.querySelector<HTMLElement>('[data-testid="decisions-page"]')??undefined);if(sequence!==navigationSequence)return;decisionsOpen=false;settleComposition(content);await tick();scrolling?.restore(scrollPositions[selected]);autosize();document.querySelector<HTMLButtonElement>('[data-open-feature="decisions"]')?.focus();}
  async function openDecisions(){dismissPopups();if(decisionsOpen){await closeDecisions();return;}const sequence=++navigationSequence;rememberScroll();await departComposition(content);if(sequence!==navigationSequence)return;inspectedId='';inspection=null;decisionsOpen=true;}
  function openSettings(owner='global:response'){settingsTab='instructions';proposedRule=undefined;settings=owner;}
  function reviewRule(rule:SavePermission){proposedRule=rule;settingsTab='permissions';settings='global:response';}
  let settings=$state<string|null>(null);
  let selected = $state('');
  let detail = $state<ThreadDetail | null>(null);
  let drafts = $state<Record<string,string>>({});
  let draftPresence:DraftPresenceSync|undefined;
  let draftsRestored=false;
  let draftImages=$state<Record<string,DraftImage[]>>({});
  let viewer=$state<{images:AttachmentView[];index:number;startSeconds?:number}|null>(null);
  let fileInput=$state<HTMLInputElement>(),textarea=$state<HTMLTextAreaElement>();
  let dragDepth=0,isDragOver=$state(false),jumpVisible=$state(false);
  const localFiles=new Map<string,{file:File;preview?:string;xhr?:XMLHttpRequest}>();
  let uploadTail:Promise<unknown>=Promise.resolve();
  const checkedDrafts=new Set<string>();
  const images=$derived(draftImages[selected]??[]);
  const imagesPending=$derived(images.some(image=>image.status!=='ready'));
  const recordingDraftPending=$derived(images.some(image=>image.recordingDraft==='pending'));
  const textTooLong=$derived((drafts[selected]??'').trim().length>4000);
  let pending = $state<Record<string,Pending>>({});
  let retryCommands = $state<Record<string,{requestKey:string;mode:ModelMode}>>({});
  let actionBusy = $state<Record<string,boolean>>({});
  let sidebarOpen=$state(true);
  let readRuns=$state<Record<string,string>>({});
  let scrollPositions:Record<string,ScrollPosition>={};
  let scrolling:ThreadScroll|undefined;
  let content:HTMLDivElement,spacer:HTMLDivElement;
  let restoring=$state(true),scrollTimer:ReturnType<typeof setTimeout>;
  let inspectionFocus:HTMLElement|null=null;
  let pendingThread: {id:string;title:string;topicId?:string} | null = null;
  let error = $state('');
  let connected = $state(false);
  let submitting = $state(false);
  let creating = $state(false);
  let mode = $state<ModelMode>('normal');
  let recorder:Recorder|undefined;
  let recording=$state<RecordingState|null>(null),recordBusy=$state(false),recordingNotice=$state(''),recordingAvailable=$state(false);
  let recordingThread='',captureMic=$state(true),hoveredDraft=$state<string|null>(null),reducedMotion=$state(false);
  async function startRecording(){
    if(recorder||recordBusy||!selected)return;recordBusy=true;recordingNotice='';recordingThread=selected;saveLocal();
    const handle=recordScreen(recordingThread,captureMic,()=>void stopRecording());recorder=handle;
    try{await handle.ready;}catch(e){if(recorder===handle){recorder=undefined;recordBusy=false;recordingNotice=`Could not start recording: ${(e as Error).message}`;}}
    if(recorder===handle)recordBusy=false;saveLocal();
  }
  async function stopRecording(discard=false){
    if(!recorder)return;const handle=recorder;recorder=undefined;recordBusy=true;
    const automatic=recording?.remainingMs===0;
    try{if(discard){await handle.discard();recordingNotice='Recording discarded.';}else{const file=await handle.stop();if(file){addRecording(file);recordingNotice=file.incomplete?'Recording interrupted. An incomplete clip was saved to the draft.':automatic?'Recording stopped at its deadline and was saved to the draft.':'Recording saved to the draft.';}else recordingNotice='Recording cancelled.';}}
    catch(e){recordingNotice=`Recording could not finish: ${(e as Error).message}. Recoverable media will be offered when Ash reopens.`;}
    finally{recording=null;recordBusy=false;saveLocal();}
  }
  function addRecording(file:RecordingFile){
    const existing=Object.values(draftImages).flat().some(item=>item.id===file.id);if(existing)return;
    draftImages[file.threadId]=[...(draftImages[file.threadId]??[]),{id:file.id,filename:file.filename,size:file.size,kind:'video',captureId:file.id,incomplete:file.incomplete,status:'uploading',progress:0,recordingDraft:'pending'}];saveLocal();queueUpload(file.threadId,file.id);
  }
  let inspection = $state<InspectionView | null>(null);
  let inspectedId = $state('');
  let inspectionKind=$state<'artifact'|'assessment'|'change'>('artifact');
  let assessmentInspection=$state<AssessmentDetail|null>(null),changeInspection=$state<ApplicationChangeView|null>(null);
  const timeline=$derived([...(detail?.artifacts??[]).map(artifact=>({kind:'artifact' as const,id:artifact.id,createdAt:artifact.createdAt,artifact})),...(detail?.changes??[]).flatMap(change=>change.events.flatMap((event,index)=>['archived','unarchived','renamed'].includes(event.event)?[{kind:'change' as const,id:change.id+':'+index,createdAt:change.createdAt,change,event}]:[]))].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));
  const firstName=$derived(timeline.find(entry=>entry.kind==='change'&&entry.event.event==='renamed')?.id);
  let transcript: HTMLElement;

  let requestSequence = 0,threadRevision=0;
  const active = $derived(detail?.runs.find(run => isActive(run.status)));
  const inspected = $derived(inspection?.artifacts.find(artifact => artifact.id === inspectedId));
  const inspectionRun = $derived(inspection?.runs.find(run => run.id === inspected?.runId));
  const captured = $derived.by(()=>{
    if(inspectionKind==='assessment')return assessmentInspection?.request;
    if(inspectionKind!=='artifact')return undefined;
    if(inspected?.payload.type==='model_request')return inspected.payload;
    if(inspected?.payload.type==='engine_request')return inspected.payload.request;
    let requestId=inspectionRun?.state.tools?.rounds.at(-1)?.requestId??inspectionRun?.state.request_artifact_id;
    if(inspected&&'requestId' in inspected.payload)requestId=inspected.payload.requestId;
    if(inspected?.payload.type==='tool_result'){
      const call=inspection?.artifacts.find(item=>item.id===(inspected!.payload as {callArtifactId:string}).callArtifactId)?.payload;
      if(call?.type==='tool_call')requestId=call.requestId;
    }
    const payload=inspection?.artifacts.find(artifact=>artifact.id===requestId)?.payload;
    return payload?.type==='model_request'?payload:undefined;
  });
  class ApiError extends Error { constructor(message:string, public status?:number) { super(message); } }
  async function api<T>(path:string, body?:object):Promise<T> {
    const response = await fetch(`/api/${path}`, {method:body ? 'POST' : 'GET', headers:{'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(['permissions/formalize','permissions/review'].includes(path)?40000:10000)});
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new ApiError(data.error ?? 'The request failed.',response.status); }
    return response.json();
  }
  function saveLocal() {
    localStorage.setItem('ash-chat-drafts',JSON.stringify(drafts));
    localStorage.setItem('ash-chat-pending',JSON.stringify(pending));
    localStorage.setItem('ash-chat-retries',JSON.stringify(retryCommands));
    localStorage.setItem('ash-chat-selected',selected);
    localStorage.setItem('ash-chat-images',JSON.stringify(Object.fromEntries(Object.entries(draftImages).map(([id,items])=>[id,items.map(({preview,...item})=>item)]))));
    void syncDrafts().catch(()=>{}); // Reconnect polling retries the persisted presence command.
  }
  function syncDrafts(){
    const present=new Set(Object.keys(drafts).filter(id=>drafts[id].trim()));
    for(const [id,items] of Object.entries(draftImages))if(items.length)present.add(id);
    for(const id of Object.keys(pending))present.add(id);
    if(recording)present.add(recording.threadId);
    if(recordBusy&&recordingThread)present.add(recordingThread);
    return draftPresence?.sync(present,threads,draftsRestored)??Promise.resolve();
  }
  function openImages(images:AttachmentView[],index:number){viewer={images,index};}
  async function openVideo(id:string,startSeconds:number){
    try{const image=detail?.attachments?.find(a=>a.id===id)??inspection?.attachments?.find(a=>a.id===id)??await api<AttachmentView>('attachments/'+id);viewer={images:[image],index:0,startSeconds};}
    catch(e){error=(e as Error).message;}
  }
  async function openCitation(resultId:string,citationId:string){
    try{
      const saved=await api<InspectionView>('artifacts/'+resultId),payload=saved.artifacts.find(a=>a.id===resultId)?.payload;
      const ref=payload?.type==='tool_result'?payload.result.references.find(r=>r.citationId===citationId||r.id===citationId):undefined;
      if(ref?.kind==='video'&&typeof ref.location.attachmentId==='string'&&typeof ref.location.startSeconds==='number')await openVideo(ref.location.attachmentId,ref.location.startSeconds);
      else await inspect(resultId);
    }catch(e){error=(e as Error).message;}
  }
  function currentImage(image:AttachmentView){return detail?.attachments?.find(a=>a.id===image.id)??Object.values(draftImages).flatMap(items=>items).find(a=>a.id===image.id)?.attachment??inspection?.attachments?.find(a=>a.id===image.id)??image;}
  function messageImages(payload:MessagePayload){return payload.content.flatMap(block=>block.type!=='text'?detail?.attachments?.filter(a=>a.id===block.attachmentId)??[]:[]);}
  function clearImages(thread:string,ids:string[]){for(const id of ids)removeImage(thread,id);}
  function removeImage(thread:string,id:string){
    draftImages[thread]=(draftImages[thread]??[]).filter(image=>image.id!==id);
    if(!localFiles.has(id))void window.ashRecording?.discard(id).catch(()=>{});
    const local=localFiles.get(id);local?.xhr?.abort();if(local?.preview)URL.revokeObjectURL(local.preview);localFiles.delete(id);saveLocal();
  }
  function applyRecordingDraft(thread:string,id:string,attachment:AttachmentView){
    const item=draftImages[thread]?.find(image=>image.id===id);
    if(!item||item.recordingDraft!=='pending'||!isVideoAttachment(attachment)||!attachment.summaryRun||isActive(attachment.summaryRun.status))return;
    const analysis=attachment.understanding;
    if(attachment.summaryRun.status!=='completed'||!analysis?.complete||analysis.actionItems===undefined){
      item.recordingDraft='error';item.recordingDraftError='Action items could not be generated. Retry or write your message.';
    }else{
      const items=analysis.actionItems.trim();item.recordingDraft=items?'inserted':'empty';item.recordingDraftError=undefined;
      if(items){
        const previous=drafts[thread]??'',legacy='Summarize the action items from my recorded narration. Preserve corrections and distinguish requests from visible evidence.';
        const selection=selected===thread&&document.activeElement===textarea?{start:textarea!.selectionStart,end:textarea!.selectionEnd}:null;
        if(!previous.includes(items))drafts[thread]=previous.endsWith(legacy)?previous.slice(0,-legacy.length)+items:previous+(previous?'\n\n':'')+items;
        if(selection)void tick().then(()=>{if(selected===thread)textarea?.setSelectionRange(selection.start,selection.end);});
      }
    }
    saveLocal();
  }
  async function generateRecordingDraft(thread:string,id:string){
    const item=draftImages[thread]?.find(image=>image.id===id);if(!item?.attachment||item.recordingDraft==='pending')return;
    item.recordingDraft='pending';item.recordingDraftError=undefined;saveLocal();
    const attachment=item.attachment;
    if(isVideoAttachment(attachment)&&attachment.understanding?.actionItems!==undefined&&attachment.understanding.complete&&attachment.summaryRun?.status==='completed'){applyRecordingDraft(thread,id,attachment);return;}
    try{await retryDescription(attachment);}catch(e){const current=draftImages[thread]?.find(image=>image.id===id);if(current){current.recordingDraft='error';current.recordingDraftError=(e as Error).message;saveLocal();}}
  }
  function queueUpload(thread:string,id:string) {
    const file=localFiles.get(id)?.file,captureId=draftImages[thread]?.find(item=>item.id===id)?.captureId;
    if(!file&&!captureId){error='Choose this attachment again to retry its upload.';return;}
    const patch=(value:Partial<DraftImage>)=>{draftImages[thread]=(draftImages[thread]??[]).map(item=>item.id===id?{...item,...value}:item);};
    patch({status:'uploading',progress:0,error:undefined});saveLocal();
    uploadTail=uploadTail.then(async()=>{
      if(!(draftImages[thread]??[]).some(item=>item.id===id))return;
      try {
        const attachment=captureId?await window.ashRecording.upload(captureId):await uploadImage(id,file!,progress=>patch({progress}),xhr=>{const local=localFiles.get(id);if(local)local.xhr=xhr;});
        patch({status:'ready',progress:1,attachment});
        applyRecordingDraft(thread,id,attachment);
        saveLocal();
        if(captureId)await window.ashRecording.discard(captureId).catch(()=>{});
      }catch(e){patch({status:'error',error:(e as Error).message});}
      saveLocal();
    });
  }
  function addFiles(files:FileList|File[]) {
    const thread=selected;if(!thread||creating||pending[thread])return;
    const list=Array.from(files),existing=draftImages[thread]??[];
    const videoFile=(file:File)=>file.type.startsWith('video/')||/\.(mp4|mov|webm)$/i.test(file.name);
    if(list.filter(file=>!videoFile(file)).reduce((n,file)=>n+file.size,0)+existing.filter(file=>file.kind!=='video').reduce((n,file)=>n+file.size,0)>IMAGE_LIMITS.perMessage){error='Images in one message must total at most 20 MiB.';return;}
    if(list.filter(videoFile).reduce((n,file)=>n+file.size,0)+existing.filter(file=>file.kind==='video').reduce((n,file)=>n+file.size,0)>VIDEO_LIMITS.perMessage){error='Videos in one message must total at most 4 GiB.';return;}
    error='';
    for(const file of list){
      const id=crypto.randomUUID();
      const video=videoFile(file);
      const problem=video?(file.size>VIDEO_LIMITS.perFile?'Each video must be at most 2 GiB.':undefined):file.size>IMAGE_LIMITS.perFile?'Each image must be at most 10 MiB.':file.type&&!['image/png','image/jpeg','image/webp'].includes(file.type)?'Choose a PNG, JPEG or WebP image.':undefined;
      const preview=!problem&&file.type.startsWith('image/')?URL.createObjectURL(file):undefined;
      localFiles.set(id,{file,preview});
      draftImages[thread]=[...(draftImages[thread]??[]),{id,filename:file.name,size:file.size,kind:video?'video':'image',status:problem?'error':'uploading',progress:0,error:problem,preview}];
      if(!problem)queueUpload(thread,id);
    }
    saveLocal();textarea?.focus();
  }
  async function retryDescription(image:AttachmentView){
    if(!image.summaryRun)return;
    const value=await api<AttachmentView>(`attachments/${image.id}/retry`,{requestKey:crypto.randomUUID(),previousId:image.summaryRun.id});
    if(viewer)viewer={...viewer,images:viewer.images.map(a=>a.id===value.id?value:a)};
    for(const thread of Object.keys(draftImages))draftImages[thread]=draftImages[thread].map(a=>a.id===value.id?{...a,attachment:value,...(a.captureId&&a.recordingDraft!=='inserted'?{recordingDraft:'pending' as const,recordingDraftError:undefined}:{})}:a);
    saveLocal();
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
  function scroll(){if(decisionsOpen)return;scrolling?.scroll();void acknowledge();clearTimeout(scrollTimer);scrollTimer=setTimeout(rememberScroll,200);}
  function rememberScroll(){if(selected&&!restoring&&scrolling&&!decisionsOpen){scrollPositions[selected]=scrolling.position();localStorage.setItem('ash-chat-scroll',JSON.stringify(scrollPositions));}}
  function latest(){scrolling?.latest();rememberScroll();}
  function autosize(){if(textarea){textarea.style.height='auto';textarea.style.height=`${Math.min(240,window.innerHeight*.3,Math.max(30,textarea.scrollHeight))}px`;}}
  $effect(()=>{drafts[selected];selected;textarea;let current=true;void tick().then(()=>{if(current)autosize();});return()=>{current=false;};});
  $effect(()=>{if(!textarea)return;let width=0;const observer=new ResizeObserver(entries=>{const next=entries[0].contentRect.width;if(next!==width){width=next;autosize();}});observer.observe(textarea);return()=>observer.disconnect();});
  function toggleSidebar(){sidebarOpen=!sidebarOpen;localStorage.setItem('ash-sidebar-open',String(sidebarOpen));}
  function closeInspector(){inspectedId='';inspection=null;assessmentInspection=null;changeInspection=null;inspectionFocus?.focus({preventScroll:true});}
  function key(event:KeyboardEvent){
    if(viewer||document.querySelector('dialog[open]'))return;
    if(event.key==='Escape'&&visibilityId){event.preventDefault();visibilityId='';return;}
    if(event.key==='Escape'&&decisionsOpen){event.preventDefault();closeDecisions();return;}
    if(event.key==='Escape'&&inspectedId){event.preventDefault();closeInspector();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'){event.preventDefault();if(connected)void createThread();}
    if((event.metaKey||event.ctrlKey)&&event.key==='\\'){event.preventDefault();toggleSidebar();}
  }
  async function updateThread(id:string,change:Change,expectedVersion?:number){
    const listed=threads.find(t=>t.id===id),opened=detail?.thread.id===id?detail.thread:undefined;
    const before=opened&&(!listed||(opened.lifecycle?.version??0)>=(listed.lifecycle?.version??0))?opened:listed;if(!before)return false;
    threadRevision++;
    try{
      const saved=await api<ThreadView>(`threads/${id}`,{...change,requestId:crypto.randomUUID(),expectedVersion:expectedVersion??before.lifecycle?.version??0});
      threads=threads.map(thread=>thread.id===id?{...thread,...saved}:thread);
      if(detail?.thread.id===id)detail={...detail,thread:{...detail.thread,...saved}};
      lastEdit=change.undo?null:{id,version:saved.lifecycle!.version};
      if(change.isArchived&&selected===id){const next=threads.find(thread=>!thread.isArchived);if(next)await selectThread(next.id);else await createThread();}
      await refresh();return true;
    }catch(e){error=(e as Error).message;return false;}finally{threadRevision++;}
  }
  const seenPending=new Set<string>();
  async function acknowledge(){
    const value=detail,cursor=value?.thread.lifecycle?.unread;
    if(!value||!cursor||cursor<=(value.thread.lifecycle?.seen??0)||selected!==value.thread.id||!document.hasFocus()||document.visibilityState!=='visible'||restoring||decisionsOpen||settings||visibilityId||inspectedId||processing||viewer)return;
    const messages=content?.querySelectorAll('[data-testid="message"]');
    const last=messages?.item(messages.length-1)?.getBoundingClientRect(),viewport=transcript?.getBoundingClientRect();
    if(!last||!viewport||last.bottom>viewport.bottom+2||last.bottom<viewport.top)return;
    const key=value.thread.id+':'+cursor;if(seenPending.has(key))return;seenPending.add(key);
    try{await api(`threads/${value.thread.id}/seen`,{cursor});
      const last=value.runs.filter(run=>!isActive(run.status)&&!(value.artifacts.every(a=>a.runId!==run.id))).at(-1);
      if(last){readRuns[value.thread.id]=last.id;localStorage.setItem('ash-read-runs',JSON.stringify(readRuns));}
    }catch{}finally{seenPending.delete(key);}
  }
  async function loadThread(id:string) {
    const sequence = ++requestSequence;
    const revision=threadRevision;
    const value = await api<ThreadDetail>(`threads/${id}`);
    if (selected !== id || sequence !== requestSequence || revision!==threadRevision) return;
    const initial=detail===null;
    detail = value;
    if(initial){await tick();autosize();scrolling?.restore(scrollPositions[id]);restoring=false;}
    const delivery = pending[id];
    if (delivery && (value.runs.some(run => run.requestKey === delivery.requestKey)||value.artifacts.some(artifact=>artifact.sourceId===delivery.requestKey))) {
      if ((drafts[id] ?? '').trim() === delivery.text) drafts[id] = '';
      clearImages(id,delivery.attachmentIds??[]);
      delete pending[id]; saveLocal();
    }
    for (const [runId,command] of Object.entries(retryCommands)) {
      if (value.runs.some(run=>run.requestKey===command.requestKey)) { delete retryCommands[runId]; saveLocal(); }
    }
    await tick();scrolling?.layout();if(selected===id&&sequence===requestSequence&&revision===threadRevision)void acknowledge();
  }
  async function selectThread(id:string) {
    const navigation=++navigationSequence;dismissPopups();rememberScroll();await departComposition(decisionsOpen?document.querySelector<HTMLElement>('[data-testid="decisions-page"]')??undefined:content);if(navigation!==navigationSequence)return;
    decisionsOpen=false;restoring=true;selected = id; detail = null; inspection = null; assessmentInspection=null;changeInspection=null;inspectedId = ''; error = '';jumpVisible=false; saveLocal();
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
      await syncDrafts();
      topics=await api<TopicView[]>('topics');
      decisions=await api<DecisionView[]>('decisions');
      if(revision!==threadRevision)return;
      if (!selected && threads.length) selected = (threads.find(thread=>!thread.isArchived)??threads[0]).id;
      if (!creating && selected && !threads.some(thread => thread.id === selected)) { selected = threads[0]?.id ?? ''; detail = null; }
      if (selected) await loadThread(selected);
      for(const [thread,items] of Object.entries(draftImages))for(const item of items)if(item.status==='ready' && (!checkedDrafts.has(item.id)||item.recordingDraft==='pending'||item.attachment?.summaryRun&&isActive(item.attachment.summaryRun.status)||item.attachment?.expiresAt&&Date.parse(item.attachment.expiresAt)<=Date.now())) {
        try{const attachment=await api<AttachmentView>(`attachments/${item.id}`);checkedDrafts.add(item.id);draftImages[thread]=(draftImages[thread]??[]).map(a=>a.id===item.id?{...a,attachment}:a);applyRecordingDraft(thread,item.id,attachment);}
        catch(e){if(e instanceof ApiError&&e.status===404)draftImages[thread]=(draftImages[thread]??[]).map(a=>a.id===item.id?{...a,status:'error',error:'This upload expired. Choose the image again.'}:a);}
      }
      if (inspectedId && (inspection?.runs.some(run=>isActive(run.status))||assessmentInspection?.status==='running')) await inspect(inspectedId,inspectionKind);
      connected = true;
      if(!threads.length&&!creating)await createThread(pendingThread?.topicId);
    } catch { connected = false; }
  }
  async function createThread(topicId?:string) {
    if (creating||!connected) return;
    creating = true; error = '';threadRevision++;
    const command = pendingThread && pendingThread.topicId === topicId
      ? pendingThread : {id:crypto.randomUUID(),title:'Untitled',...(topicId?{topicId}:{})};
    pendingThread = command; localStorage.setItem('ash-chat-new-thread',JSON.stringify(command));
    try { await api('threads',command); topics=await api<TopicView[]>('topics'); pendingThread = null; localStorage.removeItem('ash-chat-new-thread'); await selectThread(command.id);threads=await api<ThreadView[]>('threads'); }
    catch (e) {
      if(e instanceof ApiError&&e.status&&e.status<500){pendingThread=null;localStorage.removeItem('ash-chat-new-thread');}
      error = (e as Error).message;
    }
    finally { creating = false;threadRevision++;await tick();if(selected===command.id)textarea?.focus(); }
  }
  async function send() {
    const id = selected;
    if (!id || creating || submitting || active || imagesPending || recordingDraftPending || textTooLong || !connected) return;
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
  let inspectorContent=$state<HTMLDivElement>(null!);
  async function inspect(id:string,kind:'artifact'|'assessment'|'change'='artifact'){if(inspectedId&&inspectedId!==id)await replaceContent(inspectorContent,()=>inspectValue(id,kind),{resize:false});else await inspectValue(id,kind);}
  async function inspectValue(id:string,kind:'artifact'|'assessment'|'change'='artifact') {
    decisionsOpen=false;
    if(!inspectedId)inspectionFocus=document.activeElement as HTMLElement;
    if(inspectionKind!==kind){inspection=null;assessmentInspection=null;changeInspection=null;}
    else if(kind!=='artifact'&&inspectedId!==id){assessmentInspection=null;changeInspection=null;}
    inspectedId=id;inspectionKind=kind;
    try {
      if(kind==='artifact'){const value=await api<InspectionView>(`artifacts/${id}`);if(inspectedId===id&&inspectionKind===kind)inspection=value;}
      else if(kind==='assessment'){const value=await api<AssessmentDetail>(`thread-assessments/${id}`);if(inspectedId===id&&inspectionKind===kind)assessmentInspection=value;}
      else {const value=await api<ApplicationChangeView>(`application-changes/${id}`);if(inspectedId===id&&inspectionKind===kind)changeInspection=value;}
    }catch(e){error=(e as Error).message;}
  }
  async function openAssessmentSource(id:string){
    // Migrated captures retain historical IDs; former controls/notices now resolve as changes.
    if(assessmentInspection?.applicationSourceIds.includes(id))await inspect(id,'change');
    else await openSource(id);
  }
  async function openSource(id:string) {
    try {
      const source=await api<InspectionView>(`artifacts/${id}`);
      const artifact=source.artifacts.find(item=>item.id===id);
      if(artifact?.threadId && artifact.threadId!==selected)await selectThread(artifact.threadId);
      await inspect(id);
    }catch(e){error=(e as Error).message;}
  }
  async function runAction(run:RunView, action:'cancel'|'retry') {
    if (actionBusy[run.id]) return;
    actionBusy[run.id] = true; error = '';
    const command = action === 'retry' ? (retryCommands[run.id] ?? {requestKey:crypto.randomUUID(),mode}) : {};
    if (action === 'retry') { retryCommands[run.id] = command as {requestKey:string;mode:ModelMode}; saveLocal(); }
    try { await api(`runs/${run.id}/${action}`,command); delete retryCommands[run.id]; saveLocal(); if (selected === run.threadId) await loadThread(selected); if (inspectedId) await inspect(inspectedId,inspectionKind); }
    catch (e) { if (e instanceof ApiError && e.status && e.status < 500) { delete retryCommands[run.id]; saveLocal(); } error = (e as Error).message; }
    finally { actionBusy[run.id] = false; }
  }
  function associatedRun(artifact:ArtifactView) { return detail?.runs.find(run => run.id === artifact.runId); }
  function outcomes(inputId:string) { return detail?.runs.filter(run => run.inputArtifactId === inputId && !run.state.response_artifact_id) ?? []; }
  onMount(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    draftPresence=new DraftPresenceSync((id,command)=>api(`threads/${id}/draft`,command));
    try { pendingThread = JSON.parse(localStorage.getItem('ash-chat-new-thread') ?? 'null'); drafts = JSON.parse(localStorage.getItem('ash-chat-drafts') ?? '{}'); pending = JSON.parse(localStorage.getItem('ash-chat-pending') ?? '{}'); retryCommands = JSON.parse(localStorage.getItem('ash-chat-retries') ?? '{}'); selected = localStorage.getItem('ash-chat-selected') ?? ''; } catch { drafts = {}; pending = {}; }
    try{draftImages=JSON.parse(localStorage.getItem('ash-chat-images')??'{}');for(const thread of Object.keys(draftImages))draftImages[thread]=draftImages[thread].map(image=>image.status==='uploading'?{...image,status:'error',error:'Upload interrupted. Choose the image again.'}:image);}catch{draftImages={};}
    try{readRuns=JSON.parse(localStorage.getItem('ash-read-runs')??'{}');scrollPositions=JSON.parse(localStorage.getItem('ash-chat-scroll')??'{}');sidebarOpen=localStorage.getItem('ash-sidebar-open')!=='false';}catch{}
    captureMic=localStorage.getItem('ash-recording-microphone')!=='false';const motion=matchMedia('(prefers-reduced-motion: reduce)');reducedMotion=motion.matches;const motionChanged=()=>reducedMotion=motion.matches;motion.addEventListener('change',motionChanged);
    recordingAvailable=!!window.ashRecording;
    let observedRecording!:()=>void;
    const recordingReady=new Promise<void>(resolve=>observedRecording=resolve);
    const offState=window.ashRecording?.onState(value=>{recording=value;saveLocal();observedRecording();})??(()=>{});
    if(!window.ashRecording)observedRecording();
    const offControl=window.ashRecording?.onControl(action=>void stopRecording(action==='discard'))??(()=>{});
    void Promise.all([window.ashRecording?.recover()??Promise.resolve([]),recordingReady]).then(([files])=>{
      if(disposed)return;
      for(const file of files){const draft=Object.values(draftImages).flat().find(item=>item.id===file.id);if(!draft)addRecording(file);else if(draft.status!=='ready')queueUpload(file.threadId,file.id);else void window.ashRecording.discard(file.id).catch(()=>{});}
      draftsRestored=true;void syncDrafts().catch(()=>{});
    }).catch(()=>{if(!disposed)recordingNotice='Saved recordings could not be recovered. Reload to retry.';});
    scrolling=new ThreadScroll(transcript,content,spacer,visible=>jumpVisible=visible);
    const poll = async () => { await refresh(); if (!disposed) timer = setTimeout(poll,active ? 150 : 800); };
    void poll();
    return () => { disposed = true;motion.removeEventListener('change',motionChanged);offState();offControl();void recorder?.discard(); clearTimeout(timer); requestSequence++;scrolling?.dispose();clearTimeout(scrollTimer);for(const local of localFiles.values()){local.xhr?.abort();if(local.preview)URL.revokeObjectURL(local.preview);} };
  });
</script>

<svelte:window onfocus={()=>void acknowledge()} onkeydown={key} onresize={autosize}/>
<svelte:head><title>Ash — {info?.source ? info.source.branch ?? `Detached ${info.source.revision}` : 'Preview'} — {decisionsOpen?'Decisions':detail?.thread.title ?? 'Chat'}</title></svelte:head>
<Scene/><div class="preview-shell">
<PreviewBar {info}/>
<div class="shell">
  {#if sidebarOpen}<Sidebar {threads} {topics} {api} onChanged={refresh} onInstructions={openSettings} onDecisions={openDecisions} decisionsActive={decisionsOpen} pendingDecisions={decisions.filter(d=>d.status==='pending').length} {selected} {connected} {creating} {readRuns} onSelect={selectThread} onCreate={createThread} onUpdate={updateThread} onVisibility={id=>visibilityId=id} onClose={toggleSidebar}/>{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="main-column" class:covered={decisionsOpen} ondragenter={(e)=>drag(e,'enter')} ondragover={(e)=>drag(e,'over')} ondragleave={(e)=>drag(e,'leave')} ondrop={(e)=>drag(e,'drop')}>
    {#if isDragOver}<div class="drop-overlay"><strong>Drop images or videos here</strong><span>PNG, JPEG, WebP, MP4, MOV or WebM</span></div>{/if}
    {#if lastEdit}<div class="recording-notice" role="status">Thread updated. <button onclick={()=>lastEdit&&void updateThread(lastEdit.id,{undo:true},lastEdit.version)} class="ash-button">Undo</button><button aria-label="Dismiss undo" onclick={()=>lastEdit=null} class="ash-button ash-ghost ash-icon ash-close"><Icon name="close"/></button></div>{/if}
    <header>{#if !sidebarOpen}<button class="ash-button icon-button" aria-label="Show sidebar" title="Show sidebar" onclick={toggleSidebar}><Icon name="sidebar"/></button>{/if}<div class="heading"><span class="eyebrow">THREAD</span><h1>{detail?.thread.title ?? 'Untitled'}</h1>{#if detail?.thread.isArchived}<span class="archived-label">Archived</span>{/if}</div><div class="header-actions"><div class="header-controls"><button class="ash-button settings-button" disabled={!connected} onclick={()=>processing=true}>Processing</button><button class="ash-button settings-button" disabled={!connected} onclick={()=>openSettings()}>Settings</button></div><span class="connection" data-testid="connection"><i class:offline={!connected}></i>{connected ? 'Connected' : 'Reconnecting…'}</span></div></header>
    {#if detail}<div class="topic-strip" aria-label="Thread Topics">{#each detail.membership?.topics??[] as topic}<span>{topic.name}</span>{:else}<span>No Topics</span>{/each}</div>{/if}
    <div class="model-banner"><span class="model-dot"></span>{#if info?.model?.provider === 'openai'}OpenAI · {info.model.model}{#if info.model.session}<span>· {info.model.session.callsUsed}{#if info.model.session.maxCalls !== null} / {info.model.session.maxCalls}{/if} calls{#if info.model.session.expiresAt !== null} · expires {new Date(info.model.session.expiresAt).toLocaleTimeString()}{/if}</span>{/if}{:else}Deterministic test model <span>· No external calls</span>{/if}</div>
    {#if error}<div class="error" role="alert"><Status announce={false} label="Action failed">{error}</Status></div>{/if}
    <div class="transcript-frame">
    <main use:scrollArea={{onIntent:up=>scrolling?.intent(up)}} class="transcript" bind:this={transcript} onscroll={scroll} onwheel={e=>scrolling?.intent(e.deltaY<0)}><div class="messages" bind:this={content}>
      {#if !detail}<div class="empty"><span class="empty-glyph">✳</span><h2>Start a thread.</h2><p>Connecting to your threads…</p></div>
      {:else if !timeline.length}<div class="empty"><span class="empty-glyph">✳</span><h2>What’s on your mind?</h2><p>Ask a question, share an image, or start with a thought.</p></div>{/if}
      {#each timeline as entry (entry.id)}
        {#if entry.kind==='change'}
        <ThreadEvent change={entry.change} event={entry.event} initial={entry.id===firstName} onInspect={id=>void inspect(id,'change')}/>
        {:else}
        {@const artifact=entry.artifact}
        {@const payload = artifact.payload as MessagePayload}
        {@const run = associatedRun(artifact)}
        <Message animate={!restoring} {artifact} {run} outcomes={payload.speaker!=='ash'?outcomes(payload.inputArtifactId??artifact.sourceId!):[]} images={messageImages(payload)} blocked={!!active||!!(run&&actionBusy[run.id])} onInspect={inspect} onCitation={(resultId,citationId)=>void openCitation(resultId,citationId)} onRetry={run=>runAction(run,'retry')} onOpen={openImages}/>
        {/if}
      {/each}
      {#each detail?.decisions??[] as decision(decision.id)}<DecisionCard {decision} {api} onChanged={refresh} onRule={reviewRule} runs={detail?.runs??[]}/>{/each}
    </div><div class="bottom-spacer" bind:this={spacer} aria-hidden="true"></div></main>
    <!-- Keep transcript overlays clear of recording and composer controls. -->
      {#if jumpVisible}<button class="ash-button jump-latest" onclick={latest}>↓ Latest messages</button>{/if}
    </div>
    {#if recording}<div class="recording-status" role="status"><strong>{recording.phase==='starting'?'Starting recording…':recording.phase==='finishing'?'Finishing recording…':'Recording'}</strong><span>{formatVideoDuration(recording.elapsedMs/1000)} · {recording.source} · {recording.mic?'Mic on':'No microphone'}</span><button onclick={()=>void stopRecording()} disabled={recording.phase!=='recording'} class="ash-button">Stop</button><button onclick={()=>void stopRecording(true)} disabled={recording.phase==='finishing'} class="ash-button">Discard</button>{#if recording.warning&&recording.phase==='recording'}<span>Stops in {formatVideoDuration(recording.remainingMs/1000)}</span><button onclick={()=>window.ashRecording.extend(recording!.id)} class="ash-button">Extend by 10 minutes</button>{/if}</div>{/if}
    {#if recordingNotice}<div class="recording-notice" role="status">{recordingNotice}</div>{/if}
    <div class="composer">
      {#if detail}
        <form onsubmit={(e) => {e.preventDefault(); void send();}} use:surface><div class="surface-content">
          {#if images.length}<div class="draft-images">{#each images as image (image.id)}<div class="draft-image" class:upload-error={image.status==='error'} data-testid="draft-image"><button type="button" class="ash-button draft-thumb" onmouseenter={()=>hoveredDraft=image.id} onmouseleave={()=>hoveredDraft=null} onfocus={()=>hoveredDraft=image.id} onblur={()=>hoveredDraft=null} disabled={!image.attachment} aria-label={`Preview ${image.filename}`} onclick={()=>openImages(images.flatMap(item=>item.attachment?[item.attachment]:[]),images.filter(item=>item.attachment).findIndex(item=>item.id===image.id))}>{#if image.kind==='video'&&image.attachment}{#if hoveredDraft===image.id&&!reducedMotion}<video class="draft-hover-video" src={`/api/attachments/${image.id}/playback`} autoplay muted loop playsinline></video>{/if}<img src={`/api/attachments/${image.id}/thumbnail`} alt={image.filename}/><span class="draft-play">▶</span>{#if isVideoAttachment(image.attachment)}<span class="draft-duration">{formatVideoDuration(image.attachment.metadata.durationSeconds)}</span>{/if}{:else if image.preview||image.attachment}<img src={image.preview??`/api/attachments/${image.id}/thumbnail`} alt={image.attachment?.summary??image.filename}/>{:else}<span>▧</span>{/if}</button><div class="draft-meta"><strong>{image.filename}</strong>{#if image.incomplete}<span>Incomplete recording</span>{/if}<span>{image.status==='uploading'?(image.progress<1?`Uploading ${Math.round(image.progress*100)}%`:'Preparing attachment…'):image.status==='error'?image.error:`${Math.round(image.size/1024)} KB`}</span>{#if image.status==='error'&&(localFiles.has(image.id)||image.captureId)}<button type="button" onclick={()=>queueUpload(selected,image.id)} class="ash-button">Retry upload</button>{#if image.captureId}<button type="button" onclick={()=>window.ashRecording.save(image.captureId!).then(result=>{recordingNotice=result==='saved'?'Recording saved locally.':'';}).catch(e=>recordingNotice=e.message)} class="ash-button">Save locally</button>{/if}{/if}</div><button class="ash-button remove-image ash-ghost ash-icon ash-close" type="button" disabled={creating||!!pending[selected]} aria-label={`Remove ${image.filename}`} onclick={()=>removeImage(selected,image.id)}><Icon name="close"/></button></div>{/each}</div>{/if}
          <input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,.mov" multiple bind:this={fileInput} aria-label="Choose images or videos" onchange={(event)=>{if(event.currentTarget.files)addFiles(event.currentTarget.files);event.currentTarget.value='';}}/>
          {#each images.filter(image=>image.captureId&&image.status==='ready') as image (image.id)}<div class="recording-draft-status" role="status">{#if image.recordingDraft==='pending'}Preparing action items from your narration…{:else if image.recordingDraft==='error'}{image.recordingDraftError}<button type="button" disabled={creating||!!pending[selected]} onclick={()=>void generateRecordingDraft(selected,image.id)} class="ash-button">Retry action items</button>{:else if image.recordingDraft==='empty'}No spoken action items found. You can write a message or send the video.{:else if !image.recordingDraft}<button type="button" disabled={creating||!!pending[selected]} onclick={()=>void generateRecordingDraft(selected,image.id)} class="ash-button">Generate action items</button>{/if}</div>{/each}
          <label class="sr-only" for="message">Message</label><textarea bind:this={textarea} id="message" placeholder="Message Ash…" rows="1" maxlength="4000" disabled={creating||!!pending[selected]} value={drafts[selected] ?? ''} onpaste={paste} oninput={(event) => {drafts[selected] = event.currentTarget.value; saveLocal();autosize();}} onkeydown={(event) => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); void send();}}} class="ash-field"></textarea>
          <div class="composer-actions"><div class="attachment-actions"><button class="ash-button ash-icon ash-ghost record-button" class:recording={!!recording} type="button" aria-label={recording?'Stop recording':'Record screen'} title={recording?'Stop recording':'Record screen'} disabled={!recordingAvailable||recordBusy||creating||!!pending[selected]||!connected} onclick={()=>recording?void stopRecording():void startRecording()}><Icon name="record"/></button><button class="ash-button ash-ghost ash-icon attach" type="button" aria-label="Attach images or videos" title="Attach images or videos" disabled={creating||!!pending[selected]} onclick={()=>fileInput?.click()}><Icon name="attach"/></button></div><span>{creating?'Creating Thread…':imagesPending?(images.some(image=>image.status==='error')?'Retry or remove failed uploads':'Uploading attachments…'):recordingDraftPending?'Preparing action items…':textTooLong?'Shorten your message to 4000 characters':active ? 'Response in progress · your draft is saved' : 'Enter to send · Shift + Enter for a new line'}</span>{#if active}<button type="button" class="ash-button ash-icon stop" aria-label="Stop response" title="Stop response" disabled={actionBusy[active.id]} onclick={() => runAction(active!,'cancel')}><Icon name="stop"/></button>{:else}<button class="ash-button ash-primary primary" aria-label={pending[selected]?'Retry sending':'Send message'} title={pending[selected]?'Retry sending':'Send message'} disabled={creating || submitting || !connected || imagesPending || recordingDraftPending || textTooLong || (!pending[selected] && !(drafts[selected] ?? '').trim()&&!images.length)}><Icon name={pending[selected]?'retry':'send'}/></button>{/if}</div>
        </div></form>
        {#if info?.model?.provider !== 'openai'}<details class="test-controls"><summary>Test response settings</summary><label for="mode">Response behavior</label><select use:selectField id="mode" bind:value={mode} class="ash-field"><option value="normal">Normal</option><option value="slow">Slow streaming</option><option value="fail">Fail after partial output</option><option value="fail-before">Fail before output</option><option value="empty">Empty response</option></select></details>{/if}
      {/if}
    </div>
  </div>
  {#if visibilityId}<Visibility thread={threads.find(t=>t.id===visibilityId)} {api} onClose={()=>visibilityId=''} onChange={change=>updateThread(visibilityId,change)} onInspect={id=>{visibilityId='';void inspect(id,'assessment');}} onInspectChange={id=>{visibilityId='';void inspect(id,'change');}}/>{/if}
  {#if processing}<Processing {api} onClose={()=>processing=false} onInspect={id=>void tick().then(()=>inspect(id))} onThread={id=>void selectThread(id)}/>{/if}
  {#if decisionsOpen}<DecisionsPage {decisions} {api} onChanged={refresh} onThread={selectThread} onRule={reviewRule} onSettings={()=>openSettings()} onClose={closeDecisions}/>{/if}
  {#if inspectedId}
    <Rail side="right" className="inspector-rail"><aside class="inspector" aria-label={inspectionKind==='artifact'?'Artifact inspector':'Thread inspector'} use:surface={{dense:true}} transition:mist={{role:"large"}}><div bind:this={inspectorContent} use:scrollArea class="surface-content"><div class="inspector-heading"><h2>{inspectionKind==='artifact'?'Artifact inspector':'Thread inspector'}</h2><button aria-label="Close inspector" onclick={closeInspector} class="ash-button ash-ghost ash-icon ash-close"><Icon name="close"/></button></div>
      {#if inspectionKind!=='artifact'}
        {#if assessmentInspection}{@const result=assessmentInspection.result}
          <div class="section"><h3>{assessmentInspection.kind} · {assessmentInspection.status}</h3><p>{new Date(assessmentInspection.createdAt).toLocaleString()}</p>{#if result}<p>{result.reason}</p><details><summary>Assessment output</summary><pre>{result.output}</pre></details>{#if result.model}<details><summary>Provider result</summary><pre>{JSON.stringify(result.model,null,2)}</pre></details>{/if}{/if}</div>
          <ContextView captured={assessmentInspection.request} onSource={id=>void openAssessmentSource(id)} onChange={id=>void inspect(id,'change')}/>
          <details class="section"><summary>Capture revisions</summary><pre>{JSON.stringify(assessmentInspection.capture,null,2)}</pre></details>
        {:else if changeInspection}
          <div class="section"><h3>Application change · {changeInspection.origin}</h3><p>{new Date(changeInspection.createdAt).toLocaleString()}</p>{#each changeInspection.events as event}<p>{event.event}{event.reason?`: ${event.reason}`:''}</p>{/each}
          {#if changeInspection.assessmentId}<button class="ash-button ash-ghost text-button" onclick={()=>void inspect(changeInspection!.assessmentId!,'assessment')}>Inspect assessment</button>{/if}
          {#if changeInspection.sourceArtifactId}<button class="ash-button ash-ghost text-button" onclick={()=>void openSource(changeInspection!.sourceArtifactId!)}>Inspect activity</button>{/if}
          <details open><summary>Recorded change</summary><pre>{JSON.stringify(changeInspection,null,2)}</pre></details></div>
        {:else}<p>Loading history…</p>{/if}
        <button class="ash-button ash-ghost text-button" onclick={()=>void inspect(inspectedId,inspectionKind)}>Refresh inspection</button>
      {:else if inspection}
        {#if inspectionRun?.state.tools}<ToolInspection run={inspectionRun} artifacts={inspection.artifacts} selectedId={inspectedId} onInspect={inspect} onVideo={(id,seconds)=>void openVideo(id,seconds)}/>{/if}
        <span class="eyebrow">SELECTED ARTIFACT</span><code data-testid="inspected-identity">{inspectedId}</code><p>{inspected?.layer} · {inspected?.actor}</p>
        <div class="section"><h3>Originating input</h3><p class="inspect-text">{'text' in inspection.input.payload?inspection.input.payload.text:['image_upload','video_upload'].includes(inspection.input.payload.type)&&'filename' in inspection.input.payload?inspection.input.payload.filename:''}</p><code>{inspection.input.id}</code></div>
        {#if inspection.attachments?.length}<div class="section"><h3>Attachments</h3>{#each inspection.attachments as image (image.id)}<Gallery images={[image]} onOpen={openImages}/><p>{image.filename}<br>{image.metadata.original.width} × {image.metadata.original.height} original · {#if isVideoAttachment(image)}{formatVideoDuration(image.metadata.durationSeconds)} · {image.metadata.hasAudio?'audio included':'no audio'}{:else}{image.metadata.model.width} × {image.metadata.model.height} model input{/if}</p><p>{image.summary??'Description not yet available.'}</p>{#if isVideoAttachment(image)&&image.understanding}<details><summary>Generated transcript and coverage (debug)</summary><pre>{JSON.stringify(image.understanding,null,2)}</pre></details>{/if}{#if image.summaryRun}<p>Description: {image.summaryRun.status}</p><button class="ash-button ash-ghost text-button" onclick={()=>inspect(image.summaryRun!.state.request_artifact_id)}>Inspect description</button>{#if !isActive(image.summaryRun.status)&&image.summaryRun.status!=='completed'}<button class="ash-button ash-ghost text-button" onclick={()=>retryDescription(image).catch(e=>error=e.message)}>Retry description</button>{/if}{/if}<details><summary>Attachment identity and hashes</summary><code>{image.id}</code><pre>{JSON.stringify(image.metadata,null,2)}</pre></details>{/each}</div>{/if}
        {#if inspection.input.payload.type==='incoming_input'}<div class="section"><h3>Source</h3><p>{inspection.input.payload.source.label} · {inspection.input.payload.source.name}</p>{#if inspection.input.payload.occurredAt}<p>Occurred {new Date(inspection.input.payload.occurredAt).toLocaleString()}</p>{/if}{#if inspection.input.payload.source.url}<a href={inspection.input.payload.source.url} target="_blank" rel="noreferrer">Original source</a>{/if}</div>{#each inspection.artifacts as step(step.id)}{#if step.payload.type==='filter_result'}<div class="section"><h3>Filter · {step.payload.outcome}</h3><p>{step.payload.reason}</p></div>{:else if step.payload.type==='route_result'}<div class="section"><h3>Placement{step.payload.choice.ambiguous?' · assumption made':''}</h3><p>{step.payload.choice.title} · {step.payload.choice.destination==='new'?'New Thread':'Existing Thread'}</p><p>{step.payload.choice.reason}</p>{#if step.payload.choice.assumption}<p>{step.payload.choice.assumption}</p>{/if}<button class="ash-button ash-ghost text-button" onclick={()=>void selectThread(step.payload.type==='route_result'?step.payload.threadId:'')}>Open destination Thread</button></div>{:else if step.payload.type==='act_plan'}<div class="section"><h3>Action and presentation</h3><p>{step.payload.reason}</p><p>{step.payload.action?'Work requested':'No work needed'} · {step.payload.showSource?'Source visible':'Source internal'} · {step.payload.showResponse?'Response selected':'No response selected'}</p></div>{:else if step.payload.type==='engine_error'}<p class="failure">{step.payload.message}</p>{/if}{/each}{#if inspection.runs.length}<div class="section"><h3>Work</h3>{#each inspection.runs as work(work.id)}<button class="ash-button ash-ghost text-button" onclick={()=>inspectedId=work.state.request_artifact_id}>{work.status}{work.retryOfId?' · retry':''} · Inspect Run</button>{/each}</div>{/if}{/if}
        <details class="section"><summary>Artifact chain</summary>{#each inspection.artifacts as item (item.id)}<button class="ash-button chain-item" class:chosen={item.id === inspectedId} onclick={() => inspectedId = item.id}><strong>{item.layer} · {item.payload.type}</strong><code>{item.id}</code><small>Source: {item.sourceId ?? 'Input root'}</small></button>{/each}</details>
        {#if inspectionRun}<div class="section"><h3>Run · {inspectionRun.status}</h3>{#if inspection.input.payload.type==='incoming_input'}<button class="ash-button ash-ghost text-button" onclick={()=>void runAction(inspectionRun!,isActive(inspectionRun!.status)?'cancel':'retry')}>{isActive(inspectionRun.status)?'Stop work':'Retry work'}</button>{/if}<code>{inspectionRun.id}</code>{#if inspectionRun.retryOfId}<p>Retry of <code>{inspectionRun.retryOfId}</code></p>{/if}<p>Accepted {new Date(inspectionRun.createdAt).toLocaleTimeString()}<br>Started {inspectionRun.startedAt ? new Date(inspectionRun.startedAt).toLocaleTimeString() : 'Not started'}<br>Ended {inspectionRun.endedAt ? new Date(inspectionRun.endedAt).toLocaleTimeString() : 'Not settled'}</p><details><summary>Checkpoint</summary><pre>{JSON.stringify(inspectionRun.state,null,2)}</pre></details></div>{/if}
        {#if captured}<ContextView {captured} onSource={id=>void openSource(id)}/>{/if}
        {#if captured?.tools}<RetrievedContext results={captured.tools.results.map(item=>item.result)} onSource={id=>void openSource(id)}/>{/if}
        {#if inspectionRun?.state.model}{@const execution = inspectionRun.state.model}<div class="section"><h3>Provider result</h3><p>{execution.model ?? captured?.model} · {execution.status ?? 'No terminal result recorded'}</p>{#if execution.usage}<p>{execution.usage.inputTokens.toLocaleString()} input tokens · {execution.usage.outputTokens.toLocaleString()} output tokens<br>{execution.usage.cachedInputTokens.toLocaleString()} cached input · {execution.usage.reasoningTokens.toLocaleString()} reasoning tokens</p>{:else}<p>Usage unavailable for this attempt.</p>{/if}{#if execution.requestId}<code>Request: {execution.requestId}</code>{/if}{#if execution.responseId}<code>Response: {execution.responseId}</code>{/if}</div>{/if}
        {#if inspected?.payload.type==='video_model_request'&&inspected.payload.media}{@const input=inspected.payload}<div class="section"><h3>Supplied video evidence</h3><p>{input.media!.start.toFixed(2)}–{input.media!.end.toFixed(2)}s of the original timeline · {input.media!.fps} FPS requested</p>{#key inspected.id}<!-- svelte-ignore a11y_media_has_caption --><video class="evidence-video" controls src={'/api/attachments/'+input.attachmentId+'/evidence/'+inspected.id}></video>{/key}<p>Inspect the supplied clip here; timestamps in generated results remain approximate.</p></div>{/if}<details class="section"><summary>Artifact payload</summary><pre>{JSON.stringify(inspected?.payload,null,2)}</pre></details><button class="ash-button ash-ghost text-button" onclick={() => inspect(inspectedId)}>Refresh inspection</button>
      {:else}<p>Loading Artifact…</p>{/if}
    </div></aside></Rail>
  {/if}
</div>
</div>
{#if viewer}<Viewer images={viewer.images.map(currentImage)} startIndex={viewer.index} startSeconds={viewer.startSeconds??0} onClose={()=>viewer=null} onRetry={retryDescription}/>{/if}
{#if settings}<Settings {api} thread={detail?.thread??null} {threads} initialOwner={settings} initialTab={settingsTab} initialRule={proposedRule} onChanged={refresh} {captureMic} onCaptureMic={value=>{captureMic=value;localStorage.setItem('ash-recording-microphone',String(value));}} onClose={()=>settings=null}/>{/if}
<style>
  .main-column.covered{display:none}
  .recording-draft-status{font-size:.8rem;color:var(--muted);margin:0 4px 8px}.recording-draft-status:empty{display:none}.recording-draft-status button{border:0;background:transparent;color:var(--accent);font:inherit;text-decoration:underline;padding:0 5px}
  .attachment-actions{display:flex;gap:4px;align-items:center}

  .draft-duration{position:absolute;bottom:1px;right:1px;border-radius:2px;background:var(--text);color:white;font-size:.8rem;padding:1px 2px}

  .evidence-video{width:100%;max-height:250px;background:var(--text)}
  .recording-status{display:flex;align-items:center;gap:10px;padding:10px 24px;font-size:.8rem;flex-wrap:wrap;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--danger)}.recording-status button{background:color-mix(in srgb,var(--control) 35%,transparent);border:1px solid var(--divider);border-radius:5px;font-size:.8rem;padding:5px 8px}.recording-notice{font-size:.8rem;padding:7px 24px;color:var(--text)}.record-button.recording{color:var(--danger)!important}.draft-thumb{position:relative}.draft-play{position:absolute;inset:0;display:grid;place-items:center;color:white;text-shadow:0 1px 4px color-mix(in srgb,var(--shadow) 100%,transparent);font-size:16px}.draft-hover-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2}@media(prefers-reduced-motion:reduce){.draft-hover-video{display:none}}

  .header-controls{display:flex;gap:8px;align-items:center}.header-actions{display:flex;align-items:flex-end;flex-direction:column;gap:9px}.settings-button{border:1px solid var(--divider);border-radius:6px;padding:5px 9px;background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--muted);font-size:.8rem;-webkit-app-region:no-drag}.topic-strip{display:flex;flex-wrap:wrap;gap:5px;padding:0 30px 10px}.topic-strip span{background:color-mix(in srgb,var(--control) 35%,transparent);color:var(--text);padding:5px 9px;border-radius:5px;font-size:.8rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .archived-label{display:inline-block;font-size:.8rem;color:var(--muted);margin-top:5px}
  .preview-shell{height:100vh;min-height:400px;display:flex;flex-direction:column}.shell{display:flex;flex:1;min-height:0;overflow:hidden}.main-column{position:relative;display:flex;flex-direction:column;flex:1;min-width:300px}header{padding:25px 30px 16px;display:flex;align-items:center;gap:14px;-webkit-app-region:drag}.heading{flex:1;min-width:0}h1{font-family:var(--font);font-weight:400;font-size:23px;letter-spacing:-.5px;margin:6px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.eyebrow{font-size:.8rem;font-weight:525;letter-spacing:1.8px;color:var(--muted)}.icon-button{border:0;background:transparent;display:flex;color:var(--muted);padding:6px;-webkit-app-region:no-drag}.connection{font-size:.8rem;display:flex;gap:6px;align-items:center;white-space:nowrap;color:var(--muted)}.connection i,.model-dot{display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%}.connection .offline{background:color-mix(in srgb,var(--control) 48%,transparent)}.model-banner{padding:0 30px 12px;font-size:.8rem;color:var(--muted);display:flex;gap:7px;align-items:center}.model-banner span:last-child{color:#969d90}
  .transcript{flex:1;overflow:auto;padding:0 max(24px,calc((100% - 730px)/2));scrollbar-width:thin;overflow-anchor:none}.messages{display:flow-root}.bottom-spacer{pointer-events:none}.empty{text-align:center;margin:65px 0;color:var(--muted)}.empty-glyph{font-size:45px;color:var(--muted)}.empty h2{font-family:var(--font);font-weight:400;color:var(--text);font-size:27px;margin:22px 0 13px}.empty p{font-size:.9rem;line-height:1.8}
  .composer{position:relative;flex-shrink:0;padding:12px 24px 18px}.composer form{max-width:730px;margin:auto;border:1px solid var(--divider);border-radius:14px;background:color-mix(in srgb,var(--control) 35%,transparent);padding:12px;transition:border-color .15s}.composer textarea{display:block;width:100%;border:0;outline:none;resize:none;min-height:30px;max-height:min(240px,30vh);overflow-y:auto;background:transparent;color:var(--text);line-height:1.6;padding:3px 4px;font-size:1rem}.composer-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:5px}.composer-actions span{font-size:.8rem;color:var(--muted)}.composer-actions button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--divider);border-radius:50%;padding:6px;color:var(--accent);background:var(--tint);flex-shrink:0}.composer-actions .primary{background:var(--accent);color:white}.composer-actions .attach{background:transparent;border-color:transparent}.composer-actions .stop{color:var(--warning);background:color-mix(in srgb,var(--control) 35%,transparent);border-color:var(--divider)}.jump-latest{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);border:1px solid var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent);border-radius:20px;padding:8px 14px;font-size:.8rem;color:var(--accent);box-shadow:0 3px 12px color-mix(in srgb,var(--shadow) 8%,transparent);white-space:nowrap}
  .draft-images{display:flex;gap:8px;flex-wrap:wrap;padding:0 0 9px}.draft-image{display:flex;align-items:center;gap:7px;border:1px solid var(--divider);border-radius:7px;max-width:240px;padding:5px;background:color-mix(in srgb,var(--control) 35%,transparent);min-width:0}.draft-thumb{width:43px;height:43px;border:0;background:color-mix(in srgb,var(--control) 35%,transparent);border-radius:4px;padding:0;overflow:hidden;flex-shrink:0}.draft-thumb img{width:100%;height:100%;object-fit:cover}.draft-meta{display:grid;gap:3px;min-width:0}.draft-meta strong{font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:525}.draft-meta span{font-size:.8rem;color:var(--muted);max-width:155px;overflow-wrap:anywhere}.draft-meta button{font-size:.8rem;border:0;background:transparent;color:var(--accent);padding:0;text-align:left}.remove-image{border:0;background:transparent;color:var(--muted);font-size:16px;align-self:flex-start;padding:0 3px}.upload-error{border-color:var(--divider)}.upload-error .draft-meta span{color:var(--danger)}.drop-overlay{position:absolute;inset:12px;border:2px dashed var(--accent);border-radius:15px;z-index:8;background:color-mix(in srgb,var(--control) 35%,transparent);pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--accent)}.drop-overlay strong{font:525 1.4rem/1.25 var(--font)}.drop-overlay span{font-size:.9rem}
  .test-controls{max-width:730px;margin:9px auto 0;font-size:.8rem;color:var(--muted)}.test-controls label{margin-right:10px}.test-controls select{margin-top:9px;font-size:.8rem;background:color-mix(in srgb,var(--control) 35%,transparent);border:1px solid var(--divider);border-radius:4px;padding:5px}summary{cursor:pointer}.error{margin:0 24px;padding:10px 14px;background:color-mix(in srgb,var(--control) 35%,transparent);border-radius:6px;color:var(--danger);font-size:.9rem}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.text-button{border:0;background:transparent;color:var(--accent);font-size:.8rem;padding:8px 0;text-decoration:underline;text-underline-offset:3px}
  .inspector{width:360px;flex-shrink:0;border-left:1px solid var(--divider);background:color-mix(in srgb,var(--control) 35%,transparent);padding:24px;overflow:auto;font-size:.8rem;color:var(--text)}.inspector-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.inspector h2{font-size:15px;font-weight:525;color:var(--text);margin:0}.inspector-heading button{border:0;background:transparent;color:var(--muted);font-size:22px}.inspector h3{font-size:.9rem;font-weight:525;color:var(--text);margin:0 0 10px}.inspector code{display:block;font-size:.8rem;overflow-wrap:anywhere;margin-top:7px;color:var(--muted)}.inspector p{line-height:1.7}.section{border-top:1px solid var(--divider);padding-top:18px;margin-top:20px}.inspect-text{white-space:pre-wrap;overflow-wrap:anywhere}.chain-item{display:block;width:100%;text-align:left;border:1px solid var(--divider);background:transparent;border-radius:6px;padding:10px;margin-bottom:7px;color:var(--muted)}.chain-item.chosen{background:color-mix(in srgb,var(--control) 35%,transparent);border-color:var(--divider)}.chain-item strong{font-size:.8rem;font-weight:525}.chain-item small{display:block;font-size:.8rem;margin-top:6px;overflow-wrap:anywhere}.inspector details{margin-top:12px}.inspector pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;line-height:1.6;color:var(--text)}
  @media(max-width:1050px){.inspector{position:fixed;right:0;top:44px;bottom:0;z-index:4;box-shadow:-12px 0 30px color-mix(in srgb,var(--shadow) 8%,transparent)}.transcript{padding:0 22px}header{padding-left:22px}.composer-actions span{max-width:220px}}@media(prefers-reduced-motion:reduce){.composer form{transition:none}}
</style>
