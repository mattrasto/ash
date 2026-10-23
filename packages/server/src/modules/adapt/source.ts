import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,readFile,writeFile,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SourceSnapshot } from './contract.ts';
const exec=promisify(execFile);
export async function gitOutput(checkout:string,args:string[]){return (await exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd:checkout,maxBuffer:16*1024*1024,timeout:30_000,env:{PATH:process.env.PATH,LANG:process.env.LANG,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}})).stdout;}
export async function git(checkout:string,args:string[]){return (await gitOutput(checkout,args)).trim();}
export class AdaptSources {
  constructor(readonly checkout:string,readonly root:string){}
  async revision(){return git(this.checkout,['rev-parse','--verify','refs/heads/master^{commit}']);}
  async tree(revision:string){if(!/^[a-f0-9]{40,64}$/.test(revision))throw new Error('Invalid source revision.');return git(this.checkout,['rev-parse',revision+'^{tree}']);}
  async snapshot(revision:string):Promise<SourceSnapshot>{
    if(!/^[a-f0-9]{40,64}$/.test(revision))throw new Error('Invalid source revision.');
    const names=(await git(this.checkout,['ls-tree','-r','-z','--name-only',revision])).split('\0').filter(Boolean);
    if(names.some(path=>/(^|\/)(\.env($|\.(?!example$))|credentials(?:\.json)?$|[^/]+\.(?:pem|key)$)/i.test(path)))throw new Error('Tracked source contains a credential path; source export is blocked.');
    const tree=await git(this.checkout,['rev-parse',revision+'^{tree}']);
    await mkdir(this.root,{recursive:true,mode:0o700});
    const archivePath=join(this.root,revision+'.tar.gz');
    try{await readFile(archivePath);}catch{
      const temporary=archivePath+'.'+randomUUID();
      try{await git(this.checkout,['archive','--format=tar.gz','--output='+temporary,revision]);await rename(temporary,archivePath);}finally{await rm(temporary,{force:true});}
    }
    const archive=await readFile(archivePath);
    if(archive.length>12*1024*1024)throw new Error('Source archive exceeds this adapter’s upload limit.');
    return {revision,tree,archive};
  }
  /** Git imports only; no candidate scripts, hooks, installs or processes execute here. */
  async materialize(source:SourceSnapshot,candidate:{patch:string;tree:string},directory:string){
    if(Buffer.byteLength(candidate.patch)>2*1024*1024||! /^[a-f0-9]{40,64}$/.test(candidate.tree))throw new Error('Invalid exported checkpoint.');
    await mkdir(directory,{mode:0o700});
    try{
      await exec('tar',['-xzf',join(this.root,source.revision+'.tar.gz'),'-C',directory],{timeout:30_000});
      await git(directory,['init','-q']);await git(directory,['add','--all']);
      if(await git(directory,['write-tree'])!==source.tree)throw new Error('Source archive does not match its recorded Git tree.');
      await writeFile(join(directory,'.git','candidate.patch'),candidate.patch,{mode:0o600});
      if(candidate.patch)await git(directory,['apply','--index','--whitespace=nowarn',join(directory,'.git','candidate.patch')]);
      if(await git(directory,['write-tree'])!==candidate.tree)throw new Error('Exported patch does not match its claimed Git tree.');
    }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
  }
  async unresolved(source:SourceSnapshot,candidate:{patch:string;tree:string},paths:string[],previous?:{patch:string;tree:string}){
    const root=join(this.root,'conflicts-'+randomUUID()),prior=root+'-previous';
    const entry=async(directory:string,tree:string,path:string)=>{
      const records=(await gitOutput(directory,['--literal-pathspecs','ls-tree','-z',tree,'--',path])).split('\0');
      const record=records.find(row=>row.slice(row.indexOf('\t')+1)===path);if(!record)return null;
      const [mode,,id]=record.split('\t')[0].split(' ');return {mode,id};
    };
    try{
      await this.materialize(source,candidate,root);if(previous)await this.materialize(source,previous,prior);
      const conflicts:string[]=[];
      for(const path of paths){
        if(!path.startsWith('packages/client/src/renderer/')||path.split('/').includes('..'))throw Error('Invalid conflict path.');
        const current=await entry(root,candidate.tree,path);if(!current)continue;
        // Inspect Git objects, never candidate working files or symlink targets.
        if(current.mode!=='100644'){conflicts.push(path);continue;}
        if(previous&&(await entry(prior,previous.tree,path))?.id===current.id){conflicts.push(path);continue;}
        const text=await gitOutput(root,['cat-file','blob',current.id]);if(/^<{7} |^>{7} |^={7}$/m.test(text))conflicts.push(path);
      }
      return conflicts;
    }finally{await rm(root,{recursive:true,force:true});await rm(prior,{recursive:true,force:true});}
  }
  async verify(source:SourceSnapshot,candidate:{patch:string;tree:string;checks:string}):Promise<void>{
    const directory=join(this.root,'verify-'+randomUUID());
    try{await this.materialize(source,candidate,directory);}finally{await rm(directory,{recursive:true,force:true});}
  }
}
