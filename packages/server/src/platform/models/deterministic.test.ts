import test from 'node:test';
import assert from 'node:assert/strict';
import type { RequestPayload } from '@ash/shared';
import { deterministicModel } from './deterministic.ts';
const request:RequestPayload = {type:'model_request',provider:'deterministic',model:'ash-test-v1',options:{mode:'normal'},messages:[{role:'system',content:'Test'},{role:'user',content:'Hello'}],selection:{instructions:[],artifacts:[],omitted:[],maxCharacters:12000}};
test('deterministic output is reproducible and cancellation aborts the delay',async()=>{
  async function output() { let value=''; for await (const chunk of deterministicModel.stream(request,new AbortController().signal)) value+=chunk; return value; }
  assert.equal(await output(),await output());
  const controller = new AbortController();
  const iterator = deterministicModel.stream({...request,options:{mode:'slow'}},controller.signal)[Symbol.asyncIterator]();
  const next = iterator.next(); controller.abort();
  await assert.rejects(next,{name:'AbortError'});
});
