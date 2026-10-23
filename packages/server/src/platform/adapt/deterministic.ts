import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CodingBinding,HarnessObservation,RequiredInput } from '../../modules/adapt/contract.ts';
import { git } from '../../modules/adapt/source.ts';
const exec=promisify(execFile);
const latestInput=(text:string)=>text.slice(Math.max(0,text.lastIndexOf('[user]\n')));
type FixtureSession={key:string;environment:string;text?:string;createdAt:number;cancelled?:boolean;closed?:boolean;question?:RequiredInput;answer?:unknown};
/** Explicit offline demo/verification binding. Never selected as a live-provider fallback. */
export function deterministicCoding(root:string):CodingBinding{
  const save=async(id:string,value:unknown)=>{if(!/^[a-zA-Z0-9:_-]+$/.test(id))throw new Error('Invalid fixture identity');await mkdir(root,{recursive:true});const path=join(root,id+'.json'),temporary=path+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);};
  const read=async(id:string)=>JSON.parse(await readFile(join(root,id+'.json'),'utf8')) as FixtureSession;
  return {id:'deterministic-coding',label:'Offline coding fixture · no external calls',capabilities:{steering:false,prewarming:false,forceDestroy:false},
    environment:{id:'fixture-environment',async prepare(key,source,checkpoint,generation){
      const id='env-'+key.replaceAll(':','-'),directory=join(root,id);await mkdir(directory,{recursive:true});
      try{await readFile(join(directory,'.git','HEAD'));}catch{
        const archive=join(root,id+'.tar.gz');await writeFile(archive,source.archive);await exec('tar',['-xzf',archive,'-C',directory]);
        await git(directory,['init','-q']);await git(directory,['-c','core.compression=0','add','--all']);await git(directory,['-c','user.name=Ash','-c','user.email=fixture@localhost','commit','-qm','Fixture source']);
        if(checkpoint?.patch){await writeFile(join(directory,'.git','restore.patch'),checkpoint.patch);await git(directory,['apply','--index',join(directory,'.git','restore.patch')]);}
      }
      return {id,generation};
    },async ready(){return true;},async release(){}},
    harness:{id:'deterministic-harness',model:'ash-coding-fixture-v1',async create(key,lease){const id='session-'+key;await save(id,{key,environment:lease.id,createdAt:Date.now()});return {id};},async find(key){try{await read('session-'+key);return {id:'session-'+key};}catch{return null;}},
      async submit(session,input){const row=await read(session.id);if(row.text)return;row.text=input.text;row.createdAt=Date.now();if(/ask me/i.test(latestInput(input.text)))row.question={id:'question-'+row.key,turnId:'turn-'+row.key,question:'Which label should this change use?',reason:'The coding fixture requires a label.'};await save(session.id,row);},
      async observe(session):Promise<HarnessObservation>{const row=await read(session.id);if(row.cancelled)return {status:'cancelled',text:'',questions:[]};if(row.question&&!row.answer)return {status:'waiting',text:'I need a label before completing this change.',questions:[row.question]};if(Date.now()-row.createdAt<(/slowly/i.test(latestInput(row.text??''))?15000:300))return {status:'working',text:'Preparing the requested source change.',questions:[]};return {status:'completed',text:'The offline coding fixture saved a source change. Inspect Changes and Checks before continuing.',questions:[]};},
      async answer(session,_question,value){const row=await read(session.id);row.answer=value;await save(session.id,row);},async cancel(session){const row=await read(session.id);row.cancelled=true;await save(session.id,row);},
      async checkpoint(session){const row=await read(session.id),directory=join(root,row.environment);await writeFile(join(directory,'packages/client/src/renderer/ADAPT_FIXTURE.md'),'Offline Adapt fixture\n\n'+(row.answer?JSON.stringify(row.answer):'Completed')+'\n');
        if(/renderer fixture/i.test(latestInput(row.text??''))){const path=join(directory,'packages/client/src/renderer/features/threads/Chat.svelte'),source=await readFile(path,'utf8');if(!source.includes('<h2>What’s on your mind?</h2>'))throw Error('Renderer fixture heading changed.');await writeFile(path,source.replace('<h2>What’s on your mind?</h2>','<h2>Adapt renderer fixture.</h2>'));}
        if(/placeholder fixture/i.test(latestInput(row.text??''))){const path=join(directory,'packages/client/src/renderer/features/threads/Sidebar.svelte');await writeFile(path,(await readFile(path,'utf8')).replace('<small>DEV</small>','<small>PARALLEL</small>'));}
        if(/conflicting renderer fixture/i.test(latestInput(row.text??''))){const path=join(directory,'packages/client/src/renderer/features/threads/Chat.svelte');await writeFile(path,(await readFile(path,'utf8')).replace('Adapt renderer fixture.','Conflicting renderer fixture.'));}
        if(/resolve merge fixture/i.test(latestInput(row.text??''))){const path=join(directory,'packages/client/src/renderer/features/threads/Chat.svelte'),source=await readFile(path,'utf8');await writeFile(path,source.replace(/^<<<<<<<[^\n]*\n([\s\S]*?)^=======\n[\s\S]*?^>>>>>>>[^\n]*(?:\n|$)/gm,'$1').replace('<h2>Conflicting renderer fixture.</h2>','<h2>Resolved renderer fixture.</h2>'));}
        await git(directory,['add','packages/client/src/renderer']);return {tree:await git(directory,['write-tree']),patch:(await exec('git',['diff','--cached','--binary','HEAD'],{cwd:directory})).stdout,checks:'Offline fixture only. Source patch reconstruction was checked; no live coding or app checks were run.'};},
      async close(session){const row=await read(session.id);row.closed=true;await save(session.id,row);},
    }};
}
