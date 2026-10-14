import test from 'node:test';
import assert from 'node:assert/strict';
import { openAIModel, type OpenAIRequest, type OpenAIModelSettings } from './openai.ts';
import { sse, successEvents, providerResponse } from '../../../../../tests/helpers/openai.ts';
import { type ModelExecution } from '@ash/shared';
import { randomUUID } from 'node:crypto';

const request:OpenAIRequest = {type:'model_request',provider:'openai',model:'test-openai-model',
  options:{api:'responses',store:false,maxOutputTokens:1024,timeoutMs:1000,reasoningEffort:'low'},
  messages:[{role:'system',content:'Be concise.'},{role:'user',content:'Hi'}],selection:{instructions:[],artifacts:[],omitted:[],maxCharacters:12000}};
const settings:OpenAIModelSettings = {apiKey:'synthetic-credential',model:request.model,options:request.options,
  reserve:async()=>60000,info:async()=>({provider:'openai',model:request.model})};
async function collect(fetcher:typeof fetch, config=settings, signal=new AbortController().signal) {
  const events:Array<string|ModelExecution> = [];
  for await (const event of openAIModel(config,fetcher).stream(request,signal)) {
    if (typeof event !== 'string' && 'kind' in event) throw new Error('Unexpected tool output in a historical text request');
    events.push(event);
  }
  return events;
}
test('Responses adapter sends the frozen request, exposes text and allowlisted metadata only',async()=>{
  let calls = 0;
  const events = await collect(async(input,init)=>{
    calls++;
    assert.equal(String(input),'https://api.openai.com/v1/responses');
    const body=JSON.parse(init!.body as string);
    assert.deepEqual(body,{model:request.model,input:request.messages,stream:true,store:false,max_output_tokens:1024,reasoning:{effort:'low'}});
    assert.equal(new Headers(init!.headers).get('authorization'),'Bearer synthetic-credential');
    return sse([{type:'response.reasoning_text.delta',delta:'private hidden content'},...successEvents('Hello 👋')]);
  });
  assert.equal(calls,1);
  assert.deepEqual(events.filter(e=>typeof e==='string'),['Hello 👋']);
  assert.deepEqual(events.at(-1),{responseId:'resp_test',model:'test-openai-model-2026-10-10',status:'completed',usage:{inputTokens:24,outputTokens:8,totalTokens:32,cachedInputTokens:4,reasoningTokens:2}});
  assert.ok(events.some(e=>typeof e!=='string' && e.requestId==='req_test'));
  assert.ok(!JSON.stringify(events).includes('private hidden content'));
});
test('refusal text is visible and an empty completed reply is valid',async()=>{
  const response=providerResponse('');
  const refusal={...response,output:[{type:'message',content:[{type:'refusal',refusal:'Cannot help with that.'}]}]};
  const events=await collect(async()=>sse([{type:'response.refusal.delta',delta:'Cannot help with that.'},{type:'response.completed',response:refusal}]));
  assert.ok(events.includes('Cannot help with that.'));
  await collect(async()=>sse(successEvents('')));
});
test('HTTP and connection errors never auto-retry or retain provider dumps',async()=>{
  for (const status of [401,403,404,429,500]) {
    let calls=0;
    await assert.rejects(collect(async()=>{calls++;return new Response(JSON.stringify({error:{message:'secret provider dump',type:'test',code:'test'}}),{status,headers:{'content-type':'application/json','x-request-id':'req_fail'}});}),error=>{
      assert.ok(error instanceof Error);assert.ok(!error.message.includes('secret'));return true;
    });
    assert.equal(calls,1);
  }
  let calls=0;
  await assert.rejects(collect(async()=>{calls++;throw new Error('private network details');}),/could not be completed/);
  assert.equal(calls,1);
});
test('partial failures, missing completion and mismatched final content cannot complete',async()=>{
  for (const ending of [[],[{type:'error',message:'private provider dump'}],
    [{type:'response.failed',response:providerResponse('partial','failed')}],
    [{type:'response.incomplete',response:providerResponse('partial','incomplete')}],
    [{type:'response.completed',response:providerResponse('Different final output')}]] ) {
    await assert.rejects(collect(async()=>sse([{type:'response.output_text.delta',delta:'partial'},...ending])));
  }
});
test('abort propagates to the HTTP request and an overall deadline ends a stalled stream',async()=>{
  let aborted=false;
  const stall:typeof fetch = async(_input,init)=>new Promise((_resolve,reject)=>{
    init!.signal!.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'));},{once:true});
  });
  const controller=new AbortController();
  const pending=collect(stall,settings,controller.signal);
  setTimeout(()=>controller.abort(),30);
  await assert.rejects(pending,/stopped/);assert.equal(aborted,true);
  await assert.rejects(collect(stall,{...settings,reserve:async()=>25}),/time limit/);
  let reserved=0;
  await assert.rejects(collect(stall,{...settings,reserve:async()=>{reserved++;return 1000;}},AbortSignal.abort()));
  assert.equal(reserved,0);
});
test('retries keep frozen options and reject a different provider or over-budget request',()=>{
  const model=openAIModel({...settings,options:{...request.options,reasoningEffort:'high'}});
  assert.deepEqual(model.configuration('normal',request).options,request.options);
  assert.throws(()=>model.configuration('normal',{...request,model:'other-model'}),/original/);
  assert.throws(()=>model.configuration('normal',{...request,options:{...request.options,maxOutputTokens:2048}}),/output limit/);
  assert.throws(()=>model.configuration('fail'),/deterministic/);
});
test('image wire requests include frozen descriptions and bytes; unreadable images consume no calls',async()=>{
  let reserved=0,calls=0;
  const image={type:'image' as const,attachmentId:randomUUID(),image:{hash:'a'.repeat(64),mimeType:'image/png' as const,sizeBytes:8,width:2,height:2},detail:'high' as const,description:'[Image] Generated description: a square.'};
  const imageRequest:OpenAIRequest={...request,messages:[{role:'user',content:[image]}]};
  const model=openAIModel({...settings,reserve:async()=>{reserved++;return 60000;}},async(_url,init)=>{
    calls++;const body=JSON.parse(init!.body as string);
    assert.deepEqual(body.input,[{role:'user',content:[{type:'input_text',text:image.description},{type:'input_image',image_url:'data:image/png;base64,cGl4ZWxz',detail:'high'}]}]);
    return sse(successEvents());
  });
  for await(const _ of model.stream(imageRequest,new AbortController().signal,async()=> 'data:image/png;base64,cGl4ZWxz')){}
  assert.equal(calls,1);assert.equal(reserved,1);
  await assert.rejects(async()=>{for await(const _ of model.stream(imageRequest,new AbortController().signal,async()=>{throw new Error('Missing image');})){};},/Missing image/);
  assert.equal(calls,1);assert.equal(reserved,1);
});
test('description uses the dedicated short model call while sharing the reservation path',async()=>{
  let reserved=0;
  const model=openAIModel({...settings,reserve:async()=>{reserved++;return 60000;}},async(_url,init)=>{
    const body=JSON.parse(init!.body as string);assert.equal(body.model,'gpt-6-luna');assert.equal(body.max_output_tokens,256);assert.equal(body.store,false);assert.equal(body.reasoning.effort,'none');return sse(successEvents('A blue circle.'));
  });
  const caption={...request,...model.summaryConfiguration(),purpose:'image_summary' as const};
  for await(const _ of model.stream(caption,new AbortController().signal)){}
  assert.equal(reserved,1);assert.equal(model.configuration('normal').model,'test-openai-model');
});
