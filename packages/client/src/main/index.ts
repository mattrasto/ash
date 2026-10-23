import { app, BrowserWindow, session, ipcMain, clipboard, nativeImage, dialog, shell,Menu,powerMonitor } from 'electron';
import { createServer } from 'node:http';
import { readFileSync,writeFileSync,renameSync } from 'node:fs';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import { join } from 'node:path';
import { RecordingOrigin,Uuid, isVideoAttachment, type AttachmentView } from '@ash/shared';
import {installRecording} from './recording.ts';

async function main() {
const config = JSON.parse(readFileSync(process.env.ASH_CLIENT_CONFIG!, 'utf8')) as {
  root: string; label: string; instanceId: string; url: string; windowed: boolean; background: boolean;candidatePreview?:boolean;installedUI?:string;returnToThread?:{instancePath:string;threadId:string};
};
app.setPath('userData', join(config.root, 'electron'));
app.setName(`Ash (${config.label})`);
// Background verification must not activate a regular macOS app or add a Dock icon.
if (config.background && process.platform === 'darwin') app.setActivationPolicy('accessory');
await app.whenReady();
if(config.candidatePreview){
  // Retain Chromium's process sandbox. An outer seatbelt profile prevents its
  // child sandboxes from initializing on macOS; do not disable those sandboxes.
  const deniedProxy=createServer((_request,response)=>response.writeHead(403).end());
  deniedProxy.on('connect',(_request,socket)=>socket.destroy());
  await new Promise<void>(resolve=>deniedProxy.listen(0,'127.0.0.1',resolve));
  const address=deniedProxy.address();if(!address||typeof address==='string')throw Error('Preview proxy failed.');
  await session.defaultSession.setProxy({mode:'fixed_servers',proxyRules:'http://127.0.0.1:'+address.port,proxyBypassRules:'<-loopback>;127.0.0.1:'+new URL(config.url).port});
  app.on('will-quit',()=>deniedProxy.close());
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
  const origin=new URL(config.url).origin,wsOrigin=origin.replace('http:','ws:');
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url);
    callback({cancel:!([origin,wsOrigin].includes(url.origin)||['data:','blob:','devtools:'].includes(url.protocol))});
  });
}
session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
let retained:{bounds:{x:number;y:number;width:number;height:number};fullscreen:boolean}|undefined;
if(!config.candidatePreview)try{const saved=JSON.parse(readFileSync(join(config.root,'desktop-state.json'),'utf8'));if(Object.values(saved.bounds).every(value=>typeof value==='number'&&Number.isFinite(value))&&saved.bounds.width>=740&&saved.bounds.height>=650&&typeof saved.fullscreen==='boolean')retained=saved;}catch{}
const win = new BrowserWindow({
  width: 1040, height: 830,...retained?.bounds, minWidth: 740, minHeight: 650,
  title: `Ash — ${config.label}`, backgroundColor: '#f7f7f2',
  titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 19 },
  fullscreen: !config.background && (retained?.fullscreen??!config.windowed), show: false,
  focusable: !config.background, skipTaskbar: config.background,
  // Keep hidden renderers painting so automation, streaming and screenshots still run.
  webPreferences: { backgroundThrottling: !config.background, contextIsolation: true, sandbox: true, nodeIntegration: false, ...(config.candidatePreview?{}:{preload: join(config.root, 'build/preload.cjs')}) },
});
if(config.candidatePreview)win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
let canRestart=()=>true;
let updating=false;
win.webContents.on('will-prevent-unload',event=>{if(updating)event.preventDefault();});
let recordingOrigin:RecordingOrigin|undefined;
if(!config.candidatePreview){const disposeRecording=installRecording(win,{...config,origin:threadId=>recordingOrigin?.threadId===threadId?recordingOrigin:{threadId}});canRestart=()=>!disposeRecording.busy();win.on('closed',disposeRecording);}
function trusted(event:Electron.IpcMainInvokeEvent) {
  if(config.candidatePreview)throw new Error('Native bridge unavailable in renderer previews.');
  if(event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame || new URL(event.senderFrame.url).origin!==new URL(config.url).origin)throw new Error('Invalid media request');
}
let sceneSuspended=false;
const sceneContext=()=>({visible:config.background||win.isVisible()&&!win.isMinimized(),suspended:sceneSuspended,now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
const sendSceneContext=()=>{if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('scene:context',sceneContext());};
ipcMain.handle('scene:state',event=>{trusted(event);return sceneContext();});
const sceneSuspend=()=>{sceneSuspended=true;sendSceneContext();},sceneResume=()=>{sceneSuspended=false;sendSceneContext();};
powerMonitor.on('suspend',sceneSuspend);powerMonitor.on('resume',sceneResume);
win.on('show',sendSceneContext);win.on('hide',sendSceneContext);win.on('minimize',sendSceneContext);win.on('restore',sendSceneContext);win.on('focus',sendSceneContext);
const sceneClock=setInterval(sendSceneContext,60000);sceneClock.unref();
win.on('closed',()=>{clearInterval(sceneClock);powerMonitor.removeListener('suspend',sceneSuspend);powerMonitor.removeListener('resume',sceneResume);ipcMain.removeHandler('scene:state');});
ipcMain.handle('media:copy-text',async(event,text:unknown)=>{
  trusted(event);if(typeof text!=='string'||text.length>100000)throw new Error('Invalid clipboard text');clipboard.writeText(text);
});
ipcMain.handle('media:open-link',async(event,value:unknown)=>{
  trusted(event);if(typeof value!=='string'||value.length>8000)throw new Error('Invalid link');
  const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid link');
  await shell.openExternal(url.href);
});
ipcMain.handle('media:image-action',async(event,value:unknown,action:unknown)=>{
  trusted(event);const id=Uuid.parse(value);
  if(action!=='copy'&&action!=='save')throw new Error('Invalid image action');
  // Accept only an attachment ID. The renderer cannot choose a URL or filesystem path.
  const endpoint=new URL(`/api/attachments/${id}`,config.url).href;
  const metadata=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!metadata.ok)throw new Error('Image unavailable');
  const attachment=await metadata.json() as AttachmentView;
  if(isVideoAttachment(attachment)&&action==='copy')throw new Error('Video clipboard copying is unavailable.');
  if(action==='copy') {
    const response=await fetch(`${endpoint}/clipboard`,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Image unavailable');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>100*1024*1024)throw new Error('Image too large');
    const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('Image decode failed');
    clipboard.writeImage(image);return 'copied';
  }
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}[attachment.metadata.original.mimeType];
  const name=attachment.filename.replace(/\.[^.]*$/,'')+`.${extension}`;
  const result=await dialog.showSaveDialog(win,{defaultPath:name,filters:[{name:isVideoAttachment(attachment)?'Video':'Image',extensions:[extension]}]});
  if(result.canceled||!result.filePath)return 'cancelled';
  const response=await fetch(`${endpoint}/original`,{redirect:'error',signal:AbortSignal.timeout(240000)});if(!response.ok)throw new Error('Attachment unavailable');
  if(!response.body)throw new Error('Attachment unavailable');
  await pipeline(Readable.fromWeb(response.body as any),createWriteStream(result.filePath,{mode:0o600}));return 'saved';
});
win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
win.webContents.on('will-navigate', (event, url) => {
  if (new URL(url).origin !== new URL(config.url).origin) event.preventDefault();
});
if(config.returnToThread){
  const target=config.returnToThread;
  Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{label:'Adapt',submenu:[{label:'Back to Thread',accelerator:'CmdOrCtrl+Shift+B',click:()=>{void (async()=>{
    const owner=JSON.parse(readFileSync(target.instancePath,'utf8')) as {root:string;id:string;generation:string};
    const runtime=JSON.parse(readFileSync(join(owner.root,'runtime.json'),'utf8')) as {instanceId:string;generation:string;controlUrl?:string};
    const parent=JSON.parse(readFileSync(join(owner.root,'server.json'),'utf8')) as {token:string};
    if(runtime.instanceId!==owner.id||runtime.generation!==owner.generation||!runtime.controlUrl)throw Error('Controlling Ash is not running.');
    const preview=JSON.parse(readFileSync(join(config.root,'server.json'),'utf8')).candidatePreview;
    const origin=RecordingOrigin.parse({threadId:target.threadId,workspaceId:preview?.workspaceId,previewTree:preview?.tree});
    const response=await fetch(runtime.controlUrl+'/open?thread='+Uuid.parse(target.threadId)+'&origin='+encodeURIComponent(JSON.stringify(origin))+(config.background?'&background=true':''),{method:'POST',headers:{authorization:'Bearer '+parent.token},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Controlling Ash could not open the Thread.');
  })().catch(error=>dialog.showErrorBox('Back to Thread',error.message));}}]},{role:'windowMenu'}]));
}
win.webContents.on('page-title-updated',event=>{if(config.candidatePreview||config.installedUI){event.preventDefault();win.setTitle('Ash — '+config.label);}});
ipcMain.on('app:restart-ready',(event,requestId:unknown,ready:unknown)=>{
  if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||typeof requestId!=='string'||typeof ready!=='boolean')return;
  process.send?.({type:'restart-ready',requestId,ready:ready&&canRestart()});
});
process.on('message',(message:unknown)=>{
  const event=message as {type?:string;threadId?:string;requestId?:string;origin?:unknown};
  if(event.type==='prepare-restart'){
    if(!canRestart())process.send?.({type:'restart-ready',requestId:event.requestId,ready:false});
    else win.webContents.send('app:prepare-restart',event.requestId);
  }
  if(event.type==='quit-for-update'&&canRestart()){
    updating=true;session.defaultSession.flushStorageData();
    const saved=join(config.root,'desktop-state.json'),temporary=saved+'.tmp';writeFileSync(temporary,JSON.stringify({bounds:win.getNormalBounds(),fullscreen:win.isFullScreen()}),{mode:0o600});renameSync(temporary,saved);app.quit();
  }
  if(event.type==='release-health')void win.webContents.executeJavaScript("document.readyState==='complete' && !!document.querySelector('[data-testid=connection]')?.textContent?.includes('Connected') && !!document.querySelector('textarea')").then(ready=>process.send?.({type:'release-health',requestId:event.requestId,ready:!!ready})).catch(()=>process.send?.({type:'release-health',requestId:event.requestId,ready:false}));
  if(event.type==='capture'&&config.background&&config.candidatePreview)void win.webContents.capturePage().then(image=>process.send?.({type:'captured',requestId:event.requestId,png:image.toPNG().toString('base64')}));
  if(event.type==='refresh')win.webContents.reload();
  if(event.type==='open'){
    if(event.threadId&&!config.candidatePreview){const id=Uuid.safeParse(event.threadId);if(id.success){const origin=RecordingOrigin.safeParse(event.origin);recordingOrigin=origin.success&&origin.data.threadId===id.data?origin.data:undefined;win.webContents.send('adapt:thread',id.data);}}
    if(!config.background){win.show();win.focus();}
  }
});
await win.loadURL(config.url);
if (!config.background) win.show();
process.send?.({type:'client-ready'});
if (!config.background) app.dock?.setBadge(config.label.slice(0, 3).toUpperCase());
app.on('window-all-closed', () => app.quit());
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
// The supervisor's IPC channel disappearing means this client lost its owner.
process.on('disconnect', () => app.quit());
}
void main().catch(error => { console.error(error); app.quit(); });
