import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {VideoModelRequest} from '@ash/shared';
import {geminiVideoProvider,VIDEO_RESPONSE_SCHEMA} from './gemini-video.ts';
const result={caption:'Synthetic caption',answer:'',transcript:[],matches:[],limitations:[]};
const response=()=>Response.json({id:'synthetic-response',model:'gemini-3.8-flash',status:'completed',
  steps:[{type:'thought',content:[{type:'text',text:'PRIVATE_THOUGHT_CANARY'}]},{type:'model_output',content:[{type:'text',text:JSON.stringify(result)}]}],
  usage:{total_input_tokens:100,total_output_tokens:20,total_thought_tokens:3}});
async function fixture(bytes:Buffer){
  const dir=await mkdtemp(join(tmpdir(),'ash-video-provider-')),path=join(dir,'video.mp4');await writeFile(path,bytes);
  const request=VideoModelRequest.parse({type:'video_model_request',attachmentId:randomUUID(),provider:'google',model:'gemini-3.8-flash',operation:'caption',prompt:'Synthetic media only.',responseSchema:VIDEO_RESPONSE_SCHEMA,
    media:{file:{hash:createHash('sha256').update(bytes).digest('hex'),mimeType:'video/mp4',sizeBytes:bytes.length,width:320,height:180},sourceOffset:0,start:0,end:2,fps:1,resolution:'high',transform:'playback'},
    options:{api:'interactions',store:false,thinkingLevel:'low',maxOutputTokens:1024,timeoutMs:10000,responseSchemaVersion:1}});
  return {dir,path,request};
}
test('Gemini wire contract is stateless, bounded and excludes private thoughts',async t=>{
  const f=await fixture(Buffer.from('synthetic inline bytes'));t.after(()=>rm(f.dir,{recursive:true,force:true}));
  let calls=0,reserved=0;
  const provider=geminiVideoProvider({readKey:async()=>'synthetic-private-key',reserve:async()=>{reserved++;return 10000;},transport:async(_url,init)=>{
    calls++;assert.equal(init?.redirect,'error');assert.equal((init?.headers as any)['x-goog-api-key'],'synthetic-private-key');
    const body=JSON.parse(init?.body as string);assert.equal(body.store,false);assert.equal(body.stream,false);assert.equal(body.generation_config.max_output_tokens,1024);
    assert.deepEqual(body.input[0].processing,{type:'static',fps:1});return response();
  }});
  const output=await provider.analyze(f.request,f.path,new AbortController().signal);
  assert.equal(calls,1);assert.equal(reserved,1);assert.deepEqual(output.result,result);assert.equal(output.execution.thoughtTokens,3);
  assert.ok(!JSON.stringify(output).includes('PRIVATE_THOUGHT_CANARY'));assert.ok(!JSON.stringify(output).includes('synthetic-private-key'));
});
test('provider upload streams, polls and deletes; cancellation still deletes the owned file',async t=>{
  const bytes=Buffer.alloc(9*1024*1024,1),f=await fixture(bytes);t.after(()=>rm(f.dir,{recursive:true,force:true}));
  for(const cancel of [false,true]){
    const controller=new AbortController(),steps:string[]=[];
    const provider=geminiVideoProvider({readKey:async()=>'synthetic-key',transport:async(url,init)=>{
      const address=String(url);
      if(init?.method==='DELETE'){steps.push('delete');return new Response(null,{status:200});}
      if(address.includes('/upload/')&&!address.includes('upload_id')){steps.push('start');return new Response(null,{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=synthetic'}});}
      if(address.includes('upload_id')){
        steps.push('upload');let size=0;for await(const chunk of init!.body as any)size+=chunk.length;assert.equal(size,bytes.length);
        return Response.json({file:{name:'files/synthetic',state:'PROCESSING'}});
      }
      if(address.endsWith('/files/synthetic')){steps.push('poll');return Response.json({state:'ACTIVE',uri:'https://generativelanguage.googleapis.com/v1beta/files/synthetic'});}
      steps.push('model');const body=JSON.parse(init?.body as string);assert.ok(body.input[0].uri);assert.equal(body.input[0].data,undefined);
      if(cancel){controller.abort();throw controller.signal.reason;}return response();
    }});
    if(cancel)await assert.rejects(provider.analyze(f.request,f.path,controller.signal));else assert.equal((await provider.analyze(f.request,f.path,controller.signal)).fileCleanup,'deleted');
    assert.deepEqual(steps,['start','upload','poll','model','delete']);
  }
});
test('failed calls are not retried and foreign upload hosts receive neither key nor media',async t=>{
  const f=await fixture(Buffer.alloc(9*1024*1024));t.after(()=>rm(f.dir,{recursive:true,force:true}));
  let calls=0;
  const foreign=geminiVideoProvider({readKey:async()=>'synthetic-key',transport:async()=>{calls++;return new Response(null,{headers:{'x-goog-upload-url':'https://foreign.invalid/upload'}});}});
  await assert.rejects(foreign.analyze(f.request,f.path,new AbortController().signal),/unsupported upload/);assert.equal(calls,1);
  const failed=geminiVideoProvider({readKey:async()=>'synthetic-key',transport:async()=>{calls++;return new Response('RAW_ERROR_CANARY',{status:503});}});
  await assert.rejects(failed.analyze({...f.request,media:null},undefined,new AbortController().signal),error=>error instanceof Error&&/HTTP 503/.test(error.message)&&!error.message.includes('CANARY'));assert.equal(calls,2);
});
test('incomplete structured output retains visible evidence without treating it as a completed result',async()=>{
  const provider=geminiVideoProvider({readKey:async()=>'synthetic-key',transport:async()=>Response.json({model:'gemini-3.8-flash',status:'incomplete',steps:[{type:'model_output',content:[{type:'text',text:'{"caption":"partial'}]}]})});
  const f=await fixture(Buffer.from('fixture'));try{const output=await provider.analyze({...f.request,media:null},undefined,new AbortController().signal);assert.equal(output.result,null);assert.match(output.visibleText,/partial/);}finally{await rm(f.dir,{recursive:true,force:true});}
});
