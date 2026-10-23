import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Instance,AdaptCheckpoint,AdaptPreviewCommand,AdaptPreviewState } from '@ash/shared';
import { AdaptError,type PreviewController } from '../../modules/adapt/contract.ts';

/** The development launcher owns native processes/data; provider SDKs never enter it. */
export function localPreview(instance:Instance):PreviewController {
  const available=process.platform==='darwin';
  const invoke=(action:string,payload:unknown):Promise<AdaptPreviewState>=>new Promise((resolve,reject)=>{
    const require=createRequire(join(instance.checkout,'package.json'));
    const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(instance.checkout,'scripts/dev/adapt-preview-cli.ts'),action,join(instance.root,'instance.json')],{cwd:instance.checkout,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:join(instance.root,'tmp')}});
    let output='',error='';const timer=setTimeout(()=>{child.kill();reject(new AdaptError(503,'Preview control timed out. Refresh to reconcile its state.'));},8000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>32000)child.kill();});child.stderr.on('data',chunk=>{error+=chunk;if(error.length>32000)child.kill();});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new AdaptError(409,error.trim().slice(0,1000)||'Preview control failed.'));try{resolve(JSON.parse(output));}catch{reject(new AdaptError(503,'Preview status is unavailable.'));}});
    child.stdin.end(JSON.stringify(payload));
  });
  return {available,status:workspaceId=>invoke('status',{workspaceId}),sync:workspace=>invoke('sync',{workspaceId:workspace.id,threadId:workspace.threadId,checkpoint:workspace.checkpoint}),command:(workspace:{id:string;threadId:string;checkpoint:AdaptCheckpoint|null},command:AdaptPreviewCommand)=>{
    if(!available)throw new AdaptError(409,'Native UI previews require macOS in this development build.');
    return invoke('request',{workspaceId:workspace.id,threadId:workspace.threadId,checkpoint:workspace.checkpoint,command});
  }};
}
