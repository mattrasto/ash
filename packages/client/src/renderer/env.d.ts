export {};
declare global {
  interface Window {
    ashMedia:{copyText(text:string):Promise<void>;openLink(url:string):Promise<void>;imageAction(id:string,action:'copy'|'save'):Promise<'copied'|'saved'|'cancelled'>}; }
}
