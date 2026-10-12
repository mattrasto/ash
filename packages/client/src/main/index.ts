import { app, BrowserWindow, session, ipcMain, clipboard, nativeImage, dialog, shell } from 'electron';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Uuid, type AttachmentView } from '@ash/shared';

async function main() {
const config = JSON.parse(readFileSync(process.env.ASH_CLIENT_CONFIG!, 'utf8')) as {
  root: string; label: string; instanceId: string; url: string; windowed: boolean; background: boolean;
};
app.setPath('userData', join(config.root, 'electron'));
app.setName(`Ash (${config.label})`);
await app.whenReady();
session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
const win = new BrowserWindow({
  width: 1040, height: 830, minWidth: 740, minHeight: 650,
  title: `Ash — ${config.label}`, backgroundColor: '#f7f7f2',
  titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 19 },
  fullscreen: !config.windowed, show: false,
  webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(config.root, 'build/preload.cjs') },
});
function trusted(event:Electron.IpcMainInvokeEvent) {
  if(event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame || new URL(event.senderFrame.url).origin!==new URL(config.url).origin)throw new Error('Invalid media request');
}
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
  const response=await fetch(`${endpoint}/${action==='copy'?'clipboard':'original'}`,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Image unavailable');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>100*1024*1024)throw new Error('Image too large');
  if(action==='copy') {
    const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('Image decode failed');
    clipboard.writeImage(image);return 'copied';
  }
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[attachment.metadata.original.mimeType];
  const name=attachment.filename.replace(/\.[^.]*$/,'')+`.${extension}`;
  const result=await dialog.showSaveDialog(win,{defaultPath:name,filters:[{name:'Image',extensions:[extension]}]});
  if(result.canceled||!result.filePath)return 'cancelled';
  await writeFile(result.filePath,bytes,{mode:0o600});return 'saved';
});
win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
win.webContents.on('will-navigate', (event, url) => {
  if (new URL(url).origin !== new URL(config.url).origin) event.preventDefault();
});
await win.loadURL(config.url);
if (config.background) win.showInactive(); else win.show();
process.send?.({type:'client-ready'});
app.dock?.setBadge(config.label.slice(0, 3).toUpperCase());
app.on('window-all-closed', () => app.quit());
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
// The supervisor's IPC channel disappearing means this client lost its owner.
process.on('disconnect', () => app.quit());
}
void main().catch(error => { console.error(error); app.quit(); });
