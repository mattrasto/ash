import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {setTimeout as pause} from 'node:timers/promises';
import {VideoAnalysisResult,type VideoModelRequest,type VideoModelResponse} from '@ash/shared';
import {ModelFailure} from './adapter.ts';

export interface VideoProvider {
  readonly provider:'google'|'deterministic';readonly model:string;
  analyze(request:VideoModelRequest,path:string|undefined,signal:AbortSignal):Promise<Omit<VideoModelResponse,'type'|'requestId'>>;
}
const segment={type:'object',properties:{start:{type:'number'},end:{type:'number'},text:{type:'string'}},required:['start','end','text'],additionalProperties:false};
export const VIDEO_RESPONSE_SCHEMA={type:'object',properties:{caption:{type:'string'},answer:{type:'string'},actionItems:{type:'string'},transcript:{type:'array',items:segment},
  matches:{type:'array',items:{...segment,properties:{...segment.properties,evidence:{type:'string',enum:['visual','speech','both']}},required:[...segment.required,'evidence']}},
  limitations:{type:'array',items:{type:'string'}}},required:['caption','answer','actionItems','transcript','matches','limitations'],additionalProperties:false};
const BASE='https://generativelanguage.googleapis.com';
function trustedUrl(value:string){const u=new URL(value);if(u.origin!==BASE||u.username||u.password)throw new ModelFailure('video_upload_contract','Google returned an unsupported upload location.');return u.toString();}
export function geminiVideoProvider(options:{readKey:()=>Promise<string>;reserve?:()=>Promise<number>;transport?:typeof fetch}):VideoProvider{
  const transport=options.transport??fetch;
  return {provider:'google',model:'gemini-3.8-flash',async analyze(request,path,outerSignal){
    let key:string;try{key=await options.readKey();}catch{throw new ModelFailure('video_key_missing','Set GEMINI_API_KEY in this checkout’s owner-only .env.local to analyze videos.');}
    const allowance=await options.reserve?.()??request.options.timeoutMs;
    const signal=AbortSignal.any([outerSignal,AbortSignal.timeout(Math.max(1,Math.min(allowance,request.options.timeoutMs)))]);
    let remoteName:string|undefined,cleanup:'not-needed'|'deleted'|'expiry-fallback'='not-needed';
    const send=async(url:string,init:RequestInit={},currentSignal=signal)=>{
      const response=await transport(trustedUrl(url),{...init,redirect:'error',headers:{...init.headers,'x-goog-api-key':key},signal:currentSignal});
      if(!response.ok){await response.body?.cancel();const stage=new URL(url).pathname.includes('/interactions')?'model':new URL(url).pathname.includes('/upload/')?'upload':'file';
        throw new ModelFailure(response.status===429?'video_rate_limited':'video_'+stage+'_http_'+response.status,
        response.status===429?'Google rate-limited video analysis. The video is saved; retry explicitly later.':'Google could not complete video analysis (HTTP '+response.status+'). The video is saved.');}
      return response;
    };
    let outcome:Omit<VideoModelResponse,'type'|'requestId'>|undefined;
    try{
      let media:Record<string,unknown>|undefined;
      if(request.media){
        if(!path)throw new ModelFailure('video_source_missing','The captured video input is unavailable.');
        const descriptor=request.media.file;
        if(descriptor.sizeBytes<=8*1024*1024){
          const bytes=await readFile(path);
          if(bytes.length!==descriptor.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==descriptor.hash)throw new ModelFailure('video_source_changed','The captured video bytes changed before dispatch.');
          media={type:'video',data:bytes.toString('base64'),mime_type:descriptor.mimeType};
        }else{
          const started=await send(BASE+'/upload/v1beta/files',{method:'POST',headers:{'content-type':'application/json','x-goog-upload-protocol':'resumable',
            'x-goog-upload-command':'start','x-goog-upload-header-content-length':String(descriptor.sizeBytes),'x-goog-upload-header-content-type':descriptor.mimeType},
            body:JSON.stringify({file:{display_name:'Ash video segment'}})});
          const upload=started.headers.get('x-goog-upload-url');await started.body?.cancel();
          if(!upload)throw new ModelFailure('video_upload_contract','Google did not return a video upload location.');
          const source=createReadStream(path),digest=createHash('sha256');let size=0;
          const stream=source.pipe(new Transform({transform(chunk,_encoding,done){size+=chunk.length;digest.update(chunk);
            done(size>descriptor.sizeBytes?new ModelFailure('video_source_changed','The captured video bytes changed during upload.'):null,chunk);},
            flush(done){done(size!==descriptor.sizeBytes||digest.digest('hex')!==descriptor.hash?new ModelFailure('video_source_changed','The captured video bytes changed during upload.'):null);}}));
          source.on('error',error=>stream.destroy(error));
          let file:any;
          try{file=(await (await send(upload,{method:'POST',headers:{'content-length':String(descriptor.sizeBytes),'x-goog-upload-offset':'0','x-goog-upload-command':'upload, finalize'},
            body:stream as unknown as BodyInit,duplex:'half'} as RequestInit)).json()).file;}
          finally{stream.destroy();source.destroy();}
          if(!/^files\/[a-zA-Z0-9_-]{1,160}$/.test(file?.name??''))throw new ModelFailure('video_upload_contract','Google did not return a usable file identity.');
          remoteName=file.name;
          while(file.state==='PROCESSING'){
            await pause(1000,undefined,{signal});file=await (await send(BASE+'/v1beta/'+remoteName)).json();
          }
          if(file.state!=='ACTIVE'||typeof file.uri!=='string')throw new ModelFailure('video_upload_failed','Google could not prepare the uploaded video segment.');
          media={type:'video',uri:trustedUrl(file.uri),mime_type:descriptor.mimeType};
        }
        Object.assign(media,{resolution:request.media.resolution,processing:{type:'static',fps:request.media.fps}});
      }
      const body={model:request.model,store:false,stream:false,input:[...(media?[media]:[]),{type:'text',text:request.prompt}],
        generation_config:{max_output_tokens:request.options.maxOutputTokens,thinking_level:request.options.thinkingLevel,thinking_summaries:'none'},
        response_format:{type:'text',mime_type:'application/json',schema:request.responseSchema}};
      const response=await send(BASE+'/v1beta/interactions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const raw:any=await response.json().catch(()=>{throw new ModelFailure('video_provider_json','Google returned an unreadable response.');});
      const visibleText=(Array.isArray(raw.steps)?raw.steps:[]).filter((s:any)=>s.type==='model_output').flatMap((s:any)=>Array.isArray(s.content)?s.content:[])
        .filter((c:any)=>c.type==='text'&&typeof c.text==='string').map((c:any)=>c.text).join('\n').slice(0,120000);
      let result:VideoAnalysisResult|null=null;
      if(raw.status==='completed')try{result=VideoAnalysisResult.parse(JSON.parse(visibleText));}catch{}
      const number=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):undefined;
      outcome={result,visibleText,execution:{model:typeof raw.model==='string'?raw.model.slice(0,200):request.model,
        ...(typeof raw.id==='string'?{responseId:raw.id.slice(0,256)}:{}),inputTokens:number(raw.usage?.total_input_tokens),
        outputTokens:number(raw.usage?.total_output_tokens),thoughtTokens:number(raw.usage?.total_thought_tokens)},fileCleanup:'not-needed'};
    }catch(error){
      outerSignal.throwIfAborted();
      if(error instanceof ModelFailure)throw error;
      if(signal.aborted)throw new ModelFailure('video_timeout','Video analysis timed out. The video is saved; retry explicitly.');
      throw new ModelFailure('video_provider_failed','Video analysis could not complete. The video is saved; retry explicitly.');
    }finally{
      if(remoteName){try{const response=await send(BASE+'/v1beta/'+remoteName,{method:'DELETE'},AbortSignal.timeout(8000));await response.body?.cancel();cleanup='deleted';}catch{cleanup='expiry-fallback';}}
    }
    return {...outcome!,fileCleanup:cleanup};
  }};
}

export const deterministicVideoProvider:VideoProvider={provider:'deterministic',model:'ash-video-test-v1',async analyze(request,_path,signal){
  signal.throwIfAborted();const duration=request.media?request.media.end-request.media.start:0;
  const result:VideoAnalysisResult={caption:request.operation==='caption'||request.operation==='combine-caption'?'Synthetic video caption; deterministic mode did not inspect pixels or audio.':'',
    answer:['describe','question'].includes(request.operation)?'Synthetic video tool result; deterministic mode did not inspect pixels or audio.':'',
    actionItems:request.operation==='caption'&&request.prompt.includes('This is a user-recorded demonstration.')?'- Review this recording. (Synthetic test action item; pixels/audio were not inspected.)':'',
    transcript:[],matches:duration>0&&request.operation!=='caption'?[{start:0,end:duration,text:'Synthetic inspected interval, not an observed event.',evidence:'visual'}]:[],
    limitations:['Deterministic test output, not video understanding.']};
  return {result,visibleText:JSON.stringify(result),execution:{model:this.model,inputTokens:0,outputTokens:0,thoughtTokens:0},fileCleanup:'not-needed'};
}};
