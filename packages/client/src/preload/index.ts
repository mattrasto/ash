import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('ashMedia',{
  copyText:(text:string):Promise<void>=>ipcRenderer.invoke('media:copy-text',text),
  openLink:(url:string):Promise<void>=>ipcRenderer.invoke('media:open-link',url),
  imageAction:(id:string,action:'copy'|'save'):Promise<'copied'|'saved'|'cancelled'>=>ipcRenderer.invoke('media:image-action',id,action),
});
