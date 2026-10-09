import { app, BrowserWindow, session, ipcMain } from 'electron';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
const preferencePath = join(app.getPath('userData'), 'ash-preferences.json');
ipcMain.handle('preferences:get', async () => {
  try { return JSON.parse(await readFile(preferencePath, 'utf8')).compact === true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
});
ipcMain.handle('preferences:set', async (event, compact: unknown) => {
  if (event.sender !== win.webContents || typeof compact !== 'boolean') throw new Error('Invalid client preference');
  await writeFile(preferencePath, JSON.stringify({compact}), {mode:0o600});
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
