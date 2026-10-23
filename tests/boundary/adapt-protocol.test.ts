import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managedCodex} from '../../packages/server/src/platform/adapt/codex.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Adapt managed API protocol',async t=>{
  await scenarioStep(t,'adapt-managed-protocol',async()=>{
    const requests:unknown[]=[];let dispatchKey:string|null=null;
    const binding=managedCodex('offline-protocol-fixture',async(_url,options)=>{
      requests.push(JSON.parse(String(options?.body)));dispatchKey=new Headers(options?.headers).get('idempotency-key');
      return new Response('{}',{headers:{'content-type':'application/json'}});
    });
    await binding.harness.submit({id:'session-fixture'},{text:'Inspect the native screenshot.',images:['data:image/png;base64,fixture']},'run-fixture');
    assert.deepEqual(requests,[{events:[{type:'agent.session.input.message',input:[{role:'user',content:[{type:'input_text',text:'Inspect the native screenshot.'},{type:'input_image',image_url:'data:image/png;base64,fixture'}]}]}]}]);assert.equal(dispatchKey,'run-fixture');
    const observationBinding=managedCodex('offline-protocol-fixture',async url=>{
      const path=new URL(String(url)).pathname;
      const body=path.endsWith('/turns')?{data:[{id:'private-turn',status:'completed',usage:{input_tokens:10,output_tokens:5,total_tokens:15,input_tokens_details:{cached_tokens:2},output_tokens_details:{reasoning_tokens:1}}}],has_more:false}:path.endsWith('/items')?{data:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Source ready.'}]}],has_more:false}:{id:'sess-private-operational-handle',agent:{model:'gpt-6.1-sol'},status:'idle',required_actions:[]};
      return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
    });
    const observation=await observationBinding.harness.observe({id:'sess-private-operational-handle'});
    assert.equal(observation.status,'completed');assert.equal(observation.text,'Source ready.');assert.equal(observation.model?.usage?.totalTokens,15);
    assert.ok(!JSON.stringify(observation).includes('sess-private'));assert.ok(!JSON.stringify(observation).includes('private-turn'));
    // A real live regression rejected Responses API's image `detail` field here.
    const gone=managedCodex('offline-protocol-fixture',async()=>new Response(JSON.stringify({error:{message:'Missing session.',type:'not_found_error'}}),{status:404,headers:{'content-type':'application/json'}}));
    await gone.harness.cancel({id:'session-gone'},'cancel-fixture');await gone.harness.close({id:'session-gone'});
  });
});
