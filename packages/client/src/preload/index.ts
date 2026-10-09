import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('ashPreferences', {
  getCompact: (): Promise<boolean> => ipcRenderer.invoke('preferences:get'),
  setCompact: (value: boolean): Promise<void> => ipcRenderer.invoke('preferences:set', value),
});
