import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Artifact, Run, Instruction } from '@prisma/client';
import { selectContext } from './select.ts';
import { modelContentText, type ImageAttachmentView, type MessagePayload, IMAGE_LIMITS } from '@ash/shared';
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
test('image history budgets degrade to labeled descriptions and text-only consumers keep stable IDs',()=>{
  const descriptor={hash:'a'.repeat(64),mimeType:'image/webp' as const,sizeBytes:1000,width:100,height:100};
  const assets:ImageAttachmentView[]=Array.from({length:12},(_,index)=>({id:randomUUID(),filename:`${index}.png`,metadata:{original:descriptor,model:descriptor,thumbnail:descriptor,transform:'rotate-strip-webp-v1'},createdAt:time.toISOString(),expiresAt:null,inputArtifactId:randomUUID(),summary:`Description ${index}`,summaryRun:null}));
  const artifacts=assets.map((asset,index)=>{
    const row=surface(`Question ${index}`,'user',randomUUID(),null,index);
    (row.payload as unknown as MessagePayload).content.push({type:'image',attachmentId:asset.id});return row;
  });
  const result=selectContext(artifacts,[],instruction,12000,assets);
  assert.equal(result.selection.images!.filter(i=>i.representation==='image').length,6);
  assert.equal(result.selection.images!.find(i=>i.id===assets[0].id)!.reason,'history-window');
  assert.match(modelContentText(result.messages[1].content),/Generated description/);
  assert.match(modelContentText(result.messages[1].content),new RegExp(assets[0].id));
  const textOnly=selectContext(artifacts,[],instruction,12000,assets,false);
  assert.ok(textOnly.selection.images!.every(i=>i.reason==='text-only'));
  assert.ok(textOnly.messages.every(m=>typeof m.content==='string'||m.content.every(b=>b.type==='text')));
  const original=JSON.stringify(result);assets[0].summary='Late replacement';assert.equal(JSON.stringify(result),original);
});
test('newest images consume the history count budget first',()=>{
  const descriptor={hash:'b'.repeat(64),mimeType:'image/png' as const,sizeBytes:100000,width:100,height:100};
  const assets:ImageAttachmentView[]=Array.from({length:12},()=>({id:randomUUID(),filename:'image.png',metadata:{original:descriptor,model:descriptor,thumbnail:descriptor,transform:'rotate-strip-webp-v1'},createdAt:time.toISOString(),expiresAt:null,inputArtifactId:randomUUID(),summary:null,summaryRun:null}));
  const artifacts=Array.from({length:3},(_,i)=>{
    const row=surface('Look','user',randomUUID(),null,i);(row.payload as unknown as MessagePayload).content.push(...assets.slice(i*4,i*4+4).map(a=>({type:'image' as const,attachmentId:a.id})));return row;
  });
  const result=selectContext(artifacts,[],instruction,12000,assets);
  assert.equal(result.selection.images!.filter(i=>i.representation==='image').length,IMAGE_LIMITS.contextCount);
  assert.ok(result.selection.images!.filter(i=>i.artifactId===artifacts[0].id).every(i=>i.reason==='image-budget'));
  assert.ok(result.selection.images!.filter(i=>i.artifactId===artifacts[2].id).every(i=>i.representation==='image'));
  assert.match(modelContentText(result.messages[1].content),/Description unavailable/);
});
test('current input has no image-count cap, while image bytes remain bounded',()=>{
  const descriptor={hash:'c'.repeat(64),mimeType:'image/png' as const,sizeBytes:100000,width:100,height:100};
  const assets:ImageAttachmentView[]=Array.from({length:12},()=>({id:randomUUID(),filename:'image.png',metadata:{original:descriptor,model:descriptor,thumbnail:descriptor,transform:'rotate-strip-webp-v1'},createdAt:time.toISOString(),expiresAt:null,inputArtifactId:randomUUID(),summary:null,summaryRun:null}));
  const row=surface('Look at all twelve','user',randomUUID());
  (row.payload as unknown as MessagePayload).content.push(...assets.map(a=>({type:'image' as const,attachmentId:a.id})));
  const result=selectContext([row],[],instruction,12000,assets);
  assert.equal(result.selection.images!.length,12);
  assert.ok(result.selection.images!.every(i=>i.representation==='image'));
  const oversized=assets.map(a=>({...a,metadata:{...a.metadata,model:{...descriptor,sizeBytes:IMAGE_LIMITS.modelBytes}}}));
  assert.throws(()=>selectContext([row],[],instruction,12000,oversized),/image context budget/);
});
