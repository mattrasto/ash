import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('ashMedia',{
  copyText:(text:string):Promise<void>=>ipcRenderer.invoke('media:copy-text',text),
  openLink:(url:string):Promise<void>=>ipcRenderer.invoke('media:open-link',url),
  imageAction:(id:string,action:'copy'|'save'):Promise<'copied'|'saved'|'cancelled'>=>ipcRenderer.invoke('media:image-action',id,action),
});
contextBridge.exposeInMainWorld('ashRecording',{
  begin:(threadId:string,mic:boolean)=>ipcRenderer.invoke('recording:begin',threadId,mic),
  ready:(id:string,mic:boolean)=>ipcRenderer.invoke('recording:ready',id,mic),
  append:(id:string,bytes:ArrayBuffer)=>ipcRenderer.invoke('recording:append',id,bytes),
  finish:(id:string,incomplete=false)=>ipcRenderer.invoke('recording:finish',id,incomplete),
  discard:(id:string)=>ipcRenderer.invoke('recording:discard',id),
  extend:(id:string)=>ipcRenderer.invoke('recording:extend',id),
  upload:(id:string)=>ipcRenderer.invoke('recording:upload',id),
  save:(id:string)=>ipcRenderer.invoke('recording:save',id),
  recover:()=>ipcRenderer.invoke('recording:recover'),
  onControl:(callback:(action:string)=>void)=>{const listener=(_event:unknown,action:string)=>callback(action);ipcRenderer.on('recording:control',listener);return()=>ipcRenderer.removeListener('recording:control',listener);},
  onState:(callback:(state:unknown)=>void)=>{const listener=(_event:unknown,state:unknown)=>callback(state);ipcRenderer.on('recording:state',listener);return()=>ipcRenderer.removeListener('recording:state',listener);},
  control:(action:string)=>ipcRenderer.send('recording:overlay-control',action),
  move:(phase:string,x:number,y:number)=>ipcRenderer.send('recording:overlay-move',phase,x,y),
});

contextBridge.exposeInMainWorld('ashNavigation',{
  onThread:(callback:(id:string)=>void)=>{const listener=(_event:unknown,id:string)=>callback(id);ipcRenderer.on('adapt:thread',listener);return()=>ipcRenderer.removeListener('adapt:thread',listener);},
  onPrepareRestart:(callback:()=>Promise<boolean>)=>{const listener=(_event:unknown,requestId:string)=>{void callback().then(ready=>ipcRenderer.send('app:restart-ready',requestId,ready)).catch(()=>ipcRenderer.send('app:restart-ready',requestId,false));};ipcRenderer.on('app:prepare-restart',listener);return()=>ipcRenderer.removeListener('app:prepare-restart',listener);},
});
