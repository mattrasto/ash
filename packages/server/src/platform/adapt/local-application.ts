import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import type {Instance,AdaptApplicationView,AdaptRefreshResult} from '@ash/shared';
import {AdaptError,type ApplicationController} from '../../modules/adapt/contract.ts';
export function localApplication(instance:Instance):ApplicationController{
  const supported=()=>{try{const runtime=JSON.parse(readFileSync(join(instance.root,'runtime.json'),'utf8'));return runtime.instanceId===instance.id&&runtime.generation===instance.generation&&runtime.rendererUpdates===true;}catch{return false;}};
  const invoke=<T=AdaptApplicationView>(action:string,input:unknown):Promise<T>=>new Promise((resolve,reject)=>{
    const require=createRequire(join(instance.checkout,'package.json'));
    const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(instance.checkout,'scripts/dev/adapt-release-cli.ts'),action,join(instance.root,'instance.json')],{cwd:instance.checkout,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:join(instance.root,'tmp')}});
    let output='',error='';const timer=setTimeout(()=>{child.kill();reject(new AdaptError(503,'Application control timed out; its saved state will be reconciled.'));},8000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>64000)child.kill();});child.stderr.on('data',chunk=>{error+=chunk;if(error.length>32000)child.kill();});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new AdaptError(409,error.trim().slice(0,1500)||'Application control unavailable.'));try{resolve(JSON.parse(output));}catch{reject(new AdaptError(503,'Application status unavailable.'));}});
    child.stdin.end(JSON.stringify(input));
  });
  return {get available(){return process.platform==='darwin'&&supported();},get unavailableReason(){return process.platform!=='darwin'?'Local UI application requires macOS in this developer build.':!supported()?'Restart the development app to enable local updates.':undefined;},refresh:input=>invoke<AdaptRefreshResult>('refresh',input),status:candidateId=>invoke('status',{candidateId}),prepare:input=>invoke('prepare',input),apply:(candidateId,decisionId)=>invoke('apply',{candidateId,decisionId})};
}
