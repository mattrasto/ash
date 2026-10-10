import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Artifact, Run, Instruction } from '@prisma/client';
import { selectContext } from './select.ts';
const time = new Date('2026-10-09T12:00:00Z');
const instruction: Instruction = {id:randomUUID(),key:'response',name:'Base',text:'Be useful.',createdAt:time,updatedAt:time};
const threadId = randomUUID();
function surface(text:string, speaker:'user'|'ash', sourceId:string, runId:string|null = null, offset=0):Artifact {
  return {id:randomUUID(),layer:'surface',threadId,sourceId,runId,actor:speaker,payload:{type:'message',initial_thread_id:threadId,speaker,content:[{type:'text',text}]},createdAt:new Date(time.getTime()+offset),updatedAt:time};
}
function run(inputArtifactId:string,status:string,offset:number):Run {
  return {id:randomUUID(),inputArtifactId,threadId,retryOfId:null,status,state:{},error:null,requestKey:randomUUID(),requestHash:'test',createdAt:time,startedAt:time,endedAt:new Date(time.getTime()+offset)};
}
test('context selects latest completed attempt without replacing it with a later failed retry',()=>{
  const input = randomUUID(), next = randomUUID();
  const first = run(input,'completed',1), second = run(input,'completed',2), failed = run(input,'failed',3);
  const user = surface('First','user',input), a = surface('Old','ash',randomUUID(),first.id,1), b = surface('Selected','ash',randomUUID(),second.id,2), c = surface('Partial','ash',randomUUID(),failed.id,3), followup = surface('Next','user',next,null,4);
  const result = selectContext([c,followup,a,user,b],[first,second,failed],instruction);
  assert.deepEqual(result.messages.map(m=>m.content),['Be useful.','First','Selected','Next']);
  assert.deepEqual(new Map(result.selection.omitted.map(o=>[o.id,o.reason])),new Map([[a.id,'superseded'],[c.id,'not-completed']]));
  assert.deepEqual(result.selection.artifacts.map(a=>a.messageIndex),[1,2,3]);
});
test('bounded context omits a whole older exchange and retains current input',()=>{
  const input = randomUUID(), responseRun = run(input,'completed',1);
  const user = surface('Old request','user',input), answer = surface('Old answer','ash',randomUUID(),responseRun.id,1), current = surface('Current','user',randomUUID(),null,2);
  const result = selectContext([user,answer,current],[responseRun],instruction,30);
  assert.deepEqual(result.messages.map(m=>m.content),['Be useful.','Current']);
  assert.equal(result.selection.omitted.length,2);
  assert.ok(result.selection.omitted.every(item=>item.reason==='context-limit'));
});
test('an unanswered input contributes no invented assistant message',()=>{
  const input = surface('Still here','user',randomUUID());
  assert.deepEqual(selectContext([input],[],instruction).messages.map(m=>m.role),['system','user']);
});
