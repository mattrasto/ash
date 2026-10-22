import type { DraftPresence,ThreadView } from '@ash/shared';

/** Persist only presence and ordering metadata on the server; draft contents stay on this device. */
export class DraftPresenceSync {
 private state:{clientId:string;revision:number;entries:Record<string,{revision:number;present:boolean}>};
 private acknowledged=new Map<string,number>();
 private available=new Set<string>();
 private running:Promise<void>|undefined;
 constructor(private send:(id:string,command:DraftPresence)=>Promise<unknown>){
  const saved=localStorage.getItem('ash-draft-presence');
  this.state=saved?JSON.parse(saved):{clientId:crypto.randomUUID(),revision:0,entries:{}};
 }
 sync(present:Set<string>,threads:ThreadView[],restored=true){
  this.available=new Set(threads.map(thread=>thread.id));
  for(const id of new Set([...present,...Object.keys(this.state.entries)])){
   if(!this.available.has(id))continue;
   const value=present.has(id);
   // An unfinished recovery is not evidence that a previously saved draft was cleared.
   if(!value&&!restored)continue;
   if(this.state.entries[id]?.present!==value)this.state.entries[id]={revision:++this.state.revision,present:value};
  }
  for(const thread of threads){
   const remote=thread.lifecycle?.drafts?.[this.state.clientId],local=this.state.entries[thread.id];
   if(!remote||!local)continue;
   if(remote.revision===local.revision&&remote.present===local.present)this.acknowledged.set(thread.id,local.revision);
   else if(remote.revision>=local.revision){
    this.state.revision=Math.max(this.state.revision,remote.revision)+1;
    this.state.entries[thread.id]={revision:this.state.revision,present:local.present};
   }
  }
  localStorage.setItem('ash-draft-presence',JSON.stringify(this.state));
  if(this.running)return this.running;
  this.running=this.flush().finally(()=>this.running=undefined);return this.running;
 }
 private async flush(){
  for(;;){
   const next=Object.entries(this.state.entries).find(([id,value])=>this.available.has(id)&&this.acknowledged.get(id)!==value.revision);
   if(!next)return;
   const [id,value]=next;
   await this.send(id,{clientId:this.state.clientId,...value});this.acknowledged.set(id,value.revision);
  }
 }
}
