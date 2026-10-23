export {};
declare global {
  interface Window {
    ashNavigation?:{onThread(callback:(id:string)=>void):()=>void;onPrepareRestart(callback:()=>Promise<boolean>):()=>void};
    ashRecording:import('@ash/shared').RecordingBridge;
    ashMedia:{copyText(text:string):Promise<void>;openLink(url:string):Promise<void>;imageAction(id:string,action:'copy'|'save'):Promise<'copied'|'saved'|'cancelled'>}; }
}
