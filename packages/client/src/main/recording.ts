import {app,BrowserWindow,desktopCapturer,ipcMain,screen,session,dialog} from 'electron';
import {mkdir,open,readdir,readFile,writeFile,rm,lstat,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import type {FileHandle} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Uuid,VIDEO_LIMITS,type RecordingState,type RecordingFile} from '@ash/shared';

export function installRecording(win:BrowserWindow,config:{root:string;url:string;background:boolean}) {
  const root=join(config.root,'files','recordings');
  let active:{id:string;threadId:string;file:FileHandle;displayId:number;source:string;mic:boolean;started:number|null;deadline:number;phase:RecordingState['phase'];sourceLost?:boolean}|undefined;
  let overlay:BrowserWindow|undefined,closing=false,quitting=false,beginning=false;
  let overlayDrag:{x:number;y:number;screenX:number;screenY:number}|undefined;
  const uploaded=new Map<string,Promise<unknown>>();
  function trusted(event:Electron.IpcMainInvokeEvent){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||new URL(event.senderFrame.url).origin!==new URL(config.url).origin)throw Error('Invalid recording request.');}
  async function directory(){await mkdir(root,{recursive:true,mode:0o700});for(const path of [config.root,join(config.root,'files'),root]){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid recording storage.');}}
  function current(id:unknown){if(!active||active.id!==Uuid.parse(id))throw Error('This recording is no longer active.');return active;}
  const path=(id:string)=>join(root,Uuid.parse(id));
  async function saved(id:string):Promise<RecordingFile>{await directory();const dir=path(id),s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Recording unavailable.');const metadata=JSON.parse(await readFile(join(dir,'recording.json'),'utf8')) as RecordingFile;Uuid.parse(metadata.id);Uuid.parse(metadata.threadId);if(metadata.id!==id)throw Error('Recording unavailable.');const file=await lstat(join(dir,'capture.webm'));if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)throw Error('Recording unavailable.');return {...metadata,size:file.size};}
  async function persist(file:RecordingFile){const dir=path(file.id),tmp=join(dir,'recording.tmp');await writeFile(tmp,JSON.stringify(file),{mode:0o600});await rename(tmp,join(dir,'recording.json'));}
  function state():RecordingState|null {if(!active)return null;const elapsedMs=active.started===null?0:Math.max(0,performance.now()-active.started),remainingMs=active.started===null?VIDEO_LIMITS.recordingMs:Math.max(0,active.deadline-performance.now());return {id:active.id,threadId:active.threadId,source:active.source,phase:active.phase,mic:active.mic,elapsedMs,remainingMs,warning:active.started!==null&&remainingMs<=VIDEO_LIMITS.warningMs};}
  function update(){const value=state();if(!win.isDestroyed())win.webContents.send('recording:state',value);if(overlay&&!overlay.isDestroyed())overlay.webContents.send('recording:state',value);}
  function requestStop(discard=false){if(!active||active.phase==='finishing')return;active.phase='finishing';update();if(!win.isDestroyed())win.webContents.send('recording:control',discard?'discard':'stop');}
  function extend(){if(!active||active.phase!=='recording')return;active.deadline+=VIDEO_LIMITS.recordingMs;update();}
  function cleared(){active=undefined;overlayDrag=undefined;if(overlay&&!overlay.isDestroyed())overlay.destroy();overlay=undefined;if(!win.isDestroyed())win.webContents.setBackgroundThrottling(!config.background);update();if(quitting)app.quit();else if(closing)win.close();}
  async function showOverlay(){
    if(config.background)return;
    const bounds=screen.getDisplayMatching(win.getBounds()).workArea;
    overlay=new BrowserWindow({width:450,height:112,x:Math.round(bounds.x+(bounds.width-450)/2),y:bounds.y+24,type:'panel',fullscreen:false,fullscreenable:false,maximizable:false,minimizable:false,closable:false,frame:false,transparent:true,resizable:false,movable:true,alwaysOnTop:true,skipTaskbar:true,show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,preload:join(config.root,'build/preload.cjs')}});
    overlay.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});overlay.setAlwaysOnTop(true,'screen-saver');
    overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));overlay.webContents.on('will-navigate',event=>event.preventDefault());
    const html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"></head><body><div class="pill" title="Drag to move recording controls"><span class="grip" aria-hidden="true">⠿</span><div class="label" id="label">Starting recording…</div><div class="row"><span class="dot"></span><span id="time">0:00</span><span id="mic"></span><button id="stop">Stop</button><button id="discard">Discard</button></div><div class="warning" id="warning" hidden><span id="remaining"></span><button id="extend">Extend by 10 min</button></div></div><style>body{margin:0;font:12px -apple-system,system-ui;color:#edf2e7}.pill{touch-action:none;user-select:none;cursor:grab;position:relative;margin:4px;background:#253226f5;border:1px solid #71826b;border-radius:14px;padding:10px 15px;box-shadow:0 3px 14px #0003}.grip{position:absolute;right:12px;top:7px;color:#a9b99e;font-size:16px}.label{padding-right:15px;font-size:10px;color:#b9c9b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:7px}.row{display:flex;gap:12px;align-items:center}.dot{width:7px;height:7px;border-radius:50%;background:#e36b5d}button{-webkit-app-region:no-drag;font:inherit;border:1px solid #63795a;border-radius:6px;padding:4px 10px;background:#354c31;color:#f2f7ed;cursor:pointer}.warning{display:flex;justify-content:space-between;align-items:center;margin-top:8px;color:#ffd7a4}.warning[hidden]{display:none}</style><script>const pill=document.querySelector('.pill');let dragging=false;pill.onpointerdown=e=>{if(e.target.closest('button'))return;e.preventDefault();dragging=true;pill.setPointerCapture(e.pointerId);window.ashRecording.move('start',e.screenX,e.screenY)};pill.onpointermove=e=>{if(dragging)window.ashRecording.move('move',e.screenX,e.screenY)};const endDrag=e=>{if(!dragging)return;dragging=false;window.ashRecording.move('end',e.screenX,e.screenY)};pill.onpointerup=endDrag;pill.onpointercancel=endDrag;pill.onlostpointercapture=endDrag;const format=ms=>Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');window.ashRecording.onState(s=>{if(!s)return;document.getElementById('label').textContent=s.phase==='starting'?'Starting recording…':s.phase==='finishing'?'Finishing recording…':s.source;document.getElementById('time').textContent=format(s.elapsedMs);document.getElementById('mic').textContent=s.mic?'Mic on':'No microphone';document.getElementById('warning').hidden=!s.warning||s.phase!=='recording';document.getElementById('remaining').textContent='Stops in '+format(s.remainingMs);document.getElementById('stop').disabled=s.phase==='finishing';document.getElementById('discard').disabled=s.phase==='finishing'});for(const action of ['stop','discard','extend'])document.getElementById(action).onclick=()=>window.ashRecording.control(action);</script></body></html>`;
    await overlay.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));overlay.showInactive();update();
  }
  const allowed=(wc:Electron.WebContents|null,p:string)=>wc===win.webContents&&!!active&&!config.background&&['display-capture','media'].includes(p);
  session.defaultSession.setPermissionCheckHandler((wc,p,_origin,details)=>allowed(wc,p)&&(p!=='media'||!!active?.mic&&(!('mediaType' in details)||details.mediaType!=='video')));
  session.defaultSession.setPermissionRequestHandler((wc,p,callback,details)=>callback(allowed(wc,p)&&(p!=='media'||!!active?.mic&&(!('mediaTypes' in details)||!details.mediaTypes?.includes('video')))));
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    const capture=active;
    if(!capture||config.background||request.frame!==win.webContents.mainFrame||new URL(request.securityOrigin).origin!==new URL(config.url).origin)return callback({});
    try{const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}}),source=sources.find(s=>s.display_id===String(capture.displayId));if(!source||active!==capture)return callback({});callback({video:source});}catch{callback({});}
  },{useSystemPicker:false});
  ipcMain.handle('recording:begin',async(event,thread:unknown,mic:unknown)=>{
    trusted(event);Uuid.parse(thread);if(typeof mic!=='boolean'||active||beginning)throw Error('A recording is already active.');
    beginning=true;try{
    await directory();const id=randomUUID(),dir=path(id);await mkdir(dir,{mode:0o700});const file=await open(join(dir,'capture.webm'),'wx',0o600),display=screen.getDisplayMatching(win.getBounds());
    active={id,threadId:thread as string,file,displayId:display.id,source:`Display ${screen.getAllDisplays().findIndex(d=>d.id===display.id)+1}`,mic,started:null,deadline:0,phase:'starting'};
    win.webContents.setBackgroundThrottling(false);
    try{await persist({id,threadId:thread as string,filename:`screen-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`,size:0,createdAt:new Date().toISOString(),incomplete:true});await showOverlay();update();return {id};}catch(error){await file.close();await rm(dir,{recursive:true,force:true});cleared();throw error;}
    }finally{beginning=false;}
  });
  ipcMain.handle('recording:ready',async(event,id:unknown,mic:unknown)=>{trusted(event);const capture=current(id);if(typeof mic!=='boolean'||capture.phase!=='starting')throw Error('Recording start was cancelled.');capture.mic=mic;capture.started=performance.now();capture.deadline=capture.started+VIDEO_LIMITS.recordingMs;capture.phase='recording';update();});
  ipcMain.handle('recording:append',async(event,id:unknown,value:unknown)=>{trusted(event);const capture=current(id);if(!(value instanceof ArrayBuffer)||value.byteLength>16*1024*1024)throw Error('Invalid recording chunk.');await capture.file.writeFile(Buffer.from(value));});
  ipcMain.handle('recording:finish',async(event,id:unknown,incomplete:unknown=false)=>{
    trusted(event);if(typeof incomplete!=='boolean')throw Error('Invalid recording outcome.');const capture=current(id);const partial=incomplete||!!capture.sourceLost;
    try{await capture.file.sync();await capture.file.close();const value=await saved(capture.id);if(!value.size){await rm(path(capture.id),{recursive:true,force:true});throw Error('No usable recording was saved.');}await persist({...value,incomplete:partial});return {...value,incomplete:partial};}
    finally{await capture.file.close().catch(()=>{});cleared();}
  });
  ipcMain.handle('recording:discard',async(event,id:unknown)=>{trusted(event);const key=Uuid.parse(id);const wasActive=active?.id===key;try{if(wasActive)await active!.file.close();else await saved(key);await rm(path(key),{recursive:true,force:true});}finally{if(wasActive)cleared();}});
  ipcMain.handle('recording:extend',(event,id:unknown)=>{trusted(event);current(id);extend();});
  ipcMain.on('recording:overlay-control',(event,action:unknown)=>{if(event.sender!==overlay?.webContents||event.senderFrame!==overlay.webContents.mainFrame)return;if(action==='extend')extend();else if(action==='stop'||action==='discard')requestStop(action==='discard');});
  ipcMain.on('recording:overlay-move',(event,phase:unknown,x:unknown,y:unknown)=>{
    if(!overlay||overlay.isDestroyed()||event.sender!==overlay.webContents||event.senderFrame!==overlay.webContents.mainFrame)return;
    if(phase==='end'){overlayDrag=undefined;return;}
    if(typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>100000||Math.abs(y)>100000)return;
    if(phase==='start'){const bounds=overlay.getBounds();overlayDrag={x:bounds.x,y:bounds.y,screenX:x,screenY:y};}
    else if(phase==='move'&&overlayDrag){
      const bounds=overlay.getBounds(),area=screen.getDisplayNearestPoint({x:Math.round(x),y:Math.round(y)}).workArea;
      overlay.setPosition(Math.round(Math.max(area.x,Math.min(area.x+area.width-bounds.width,overlayDrag.x+x-overlayDrag.screenX))),
        Math.round(Math.max(area.y,Math.min(area.y+area.height-bounds.height,overlayDrag.y+y-overlayDrag.screenY))));
    }
  });
  ipcMain.handle('recording:recover',async event=>{trusted(event);await directory();const result:RecordingFile[]=[];for(const entry of await readdir(root)){if(!Uuid.safeParse(entry).success||entry===active?.id)continue;try{const value=await saved(entry);if(Date.now()-Date.parse(value.createdAt)>24*60*60*1000){await rm(path(entry),{recursive:true,force:true});continue;}if(value.size)result.push(value);else await rm(path(entry),{recursive:true,force:true});}catch{}}return result;});
  ipcMain.handle('recording:save',async(event,id:unknown)=>{trusted(event);const key=Uuid.parse(id),value=await saved(key);if(active?.id===key)throw Error('Finish the recording before saving.');const destination=await dialog.showSaveDialog(win,{defaultPath:value.filename,filters:[{name:'Video',extensions:['webm']}]});if(destination.canceled||!destination.filePath)return 'cancelled';const file=await open(join(path(key),'capture.webm'),constants.O_RDONLY|constants.O_NOFOLLOW);try{await pipeline(file.createReadStream(),createWriteStream(destination.filePath,{mode:0o600}));return 'saved';}finally{await file.close().catch(()=>{});}});
  ipcMain.handle('recording:upload',async(event,id:unknown)=>{
    trusted(event);const key=Uuid.parse(id);if(uploaded.has(key))return uploaded.get(key);
    const task=(async()=>{const value=await saved(key);if(active?.id===key)throw Error('Recording has not finished.');const file=await open(join(path(key),'capture.webm'),constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const response=await fetch(new URL(`/api/attachments/${key}`,config.url),{method:'PUT',headers:{'content-type':'application/x-ash-video','x-image-filename':encodeURIComponent(value.filename),'x-recording-incomplete':String(value.incomplete),'x-recording-source':'screen'},body:file.createReadStream() as any,duplex:'half',signal:AbortSignal.timeout(240000)} as RequestInit);
        if(!response.ok){const problem=await response.json().catch(()=>({}));throw Error(problem.error??'Video upload failed. Retry or save the local recording.');}return response.json();
      }finally{await file.close().catch(()=>{});}})();uploaded.set(key,task);try{return await task;}finally{uploaded.delete(key);}
  });
  const timer=setInterval(()=>{if(active?.phase==='recording'&&performance.now()>=active.deadline)requestStop();update();},500);timer.unref();
  const removed=(_event:Electron.Event,display:Electron.Display)=>{if(active?.displayId===display.id){active.sourceLost=true;active.source+=' · disconnected';requestStop();}};
  screen.on('display-removed',removed);
  win.on('close',event=>{if(active){event.preventDefault();closing=true;requestStop();}});
  app.on('before-quit',event=>{if(active){event.preventDefault();quitting=true;requestStop();}});
  win.webContents.on('render-process-gone',()=>{if(active){void active.file.close();active=undefined;overlay?.destroy();overlay=undefined;}});
  return ()=>{clearInterval(timer);screen.removeListener('display-removed',removed);};
}
