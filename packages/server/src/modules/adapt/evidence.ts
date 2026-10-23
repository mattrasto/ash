import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {RunState,ToolArtifact,ToolResult,VideoFrame,type ToolCallState} from '@ash/shared';
import {ToolActionFailure,toolCitationId,type ToolContext} from '../tools/contract.ts';
import {recordingEvidenceRuntime} from '../video/evidence.ts';
import type {VideoAnalysis} from '../video/service.ts';
import {referenceImages} from '../attachments/service.ts';
import {ProviderFailure,type CodingInput,type EvidenceCall} from './contract.ts';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const failure=(code:string,message:string,denied=false):ToolResult=>({status:denied?'denied':'error',content:[],references:[],omissions:[],error:{code,message,retryable:false}});

/** Two recording operations, using existing tool records; the coding harness owns its loop. */
export class RecordingEvidence {
 readonly runtime;
 constructor(readonly video:VideoAnalysis){this.runtime=recordingEvidenceRuntime(video);}
 private get db():PrismaClient{return this.video.db;}
 private async update<T>(id:string,work:(tx:Prisma.TransactionClient,state:ReturnType<typeof RunState.parse>,threadId:string)=>Promise<T>){
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM runs WHERE id=${id}::uuid FOR UPDATE`;
   const run=await tx.run.findUniqueOrThrow({where:{id}});if(run.status!=='running'||!run.threadId)throw new Error('Coding evidence is no longer active.');
   const state=RunState.parse(run.state),value=await work(tx,state,run.threadId);
   await tx.run.update({where:{id},data:{state:json(state)}});return value;
  });
 }
 async execute(runId:string,stepId:string,call:EvidenceCall,signal:AbortSignal):Promise<CodingInput>{
  const args=JSON.stringify(call.arguments);if(args.length>32768)throw new ProviderFailure(false,'evidence_arguments','The coding harness returned oversized evidence arguments.');
  let step=await this.update(runId,async(tx,state,threadId)=>{
   state.tools??={version:1,checkpoint:0,rounds:[],calls:[],resultBytes:0,reservedResultBytes:0,consecutiveErrors:0};
   const previous=state.tools.calls.find(c=>c.id===stepId);
   if(previous){if(previous.call.name!==call.name||previous.call.arguments!==args)throw new ProviderFailure(false,'evidence_call_changed','The coding harness reused an evidence identity with different arguments.');return previous;}
   const requestId=state.adapt?.requestArtifactId??state.request_artifact_id,callArtifactId=randomUUID(),now=new Date();
   const captured={callId:stepId,name:call.name,arguments:args};
   await tx.artifact.create({data:{id:callArtifactId,layer:'act',actor:'ash',runId,threadId,sourceId:requestId,payload:ToolArtifact.parse({type:'tool_call',requestId,call:captured}),createdAt:now,updatedAt:now}});
   const current:ToolCallState={id:stepId,requestId,callArtifactId,call:captured,status:'queued'};
   if(!state.tools.rounds.some(r=>r.requestId===requestId))state.tools.rounds.push({requestId,status:'completed',commentary:'Recording evidence requested by the coding harness.',startedAt:now.toISOString(),endedAt:now.toISOString()});
   state.tools.calls.push(current);state.tools.checkpoint++;return current;
  });
  const run=await this.db.run.findUniqueOrThrow({where:{id:runId}}),handler=this.runtime.tools.find(t=>t.definition.name===call.name);
  if(!handler)throw new ProviderFailure(false,'unsupported_evidence','The coding harness requested an unsupported evidence operation.');
  const context:ToolContext={runId,threadId:run.threadId!,callId:stepId,signal:AbortSignal.any([signal,AbortSignal.timeout(handler.definition.limits.timeoutMs)]),authorize:async action=>this.runtime.authorize(action,context)};
  let result:ToolResult;
  try{
   const prepared=await handler.prepare(call.arguments,context),authorization=await context.authorize(prepared.action);
   if(authorization.outcome!=='allowed')throw new ToolActionFailure(authorization.code,authorization.message,true);
   if(step.resultArtifactId){const saved=ToolArtifact.parse((await this.db.artifact.findUniqueOrThrow({where:{id:step.resultArtifactId}})).payload);if(saved.type!=='tool_result')throw Error('Missing saved recording evidence.');result=saved.result;}
   else{
    await this.update(runId,async(_tx,state)=>{const current=state.tools!.calls.find(c=>c.id===stepId)!;Object.assign(current,{status:'running',action:prepared.action,authorization,startedAt:current.startedAt??new Date().toISOString()});});
    result=ToolResult.parse(await prepared.execute(context));
   }
  }catch(error){
   signal.throwIfAborted();
   result=error instanceof ToolActionFailure?failure(error.code,error.message,error.denied):failure('recording_evidence_unavailable',context.signal.aborted?'Recording inspection timed out. The source is retained.':'Recording evidence could not be read. The source is retained; no missing evidence was observed.');
  }
  if(!step.resultArtifactId){
   result={...result,references:result.references.map((ref,i)=>({...ref,citationId:toolCitationId(stepId,i)}))};
   if(Buffer.byteLength(JSON.stringify(result))>32768)result=failure('recording_result_limit','The recording result exceeded its bound. Request a narrower interval.');
   step=await this.update(runId,async(tx,state,threadId)=>{
    signal.throwIfAborted();const current=state.tools!.calls.find(c=>c.id===stepId)!;if(current.resultArtifactId)return current;
    const resultId=randomUUID(),now=new Date();
    await tx.artifact.create({data:{id:resultId,layer:'act',actor:'ash',runId,threadId,sourceId:current.callArtifactId,payload:ToolArtifact.parse({type:'tool_result',callArtifactId:current.callArtifactId,result}),createdAt:now,updatedAt:now}});
    await referenceImages(tx,resultId,[...new Set(result.references.flatMap(ref=>typeof ref.location.attachmentId==='string'?[ref.location.attachmentId]:[]))]);
    Object.assign(current,{resultArtifactId:resultId,status:result.status==='success'?'completed':result.status,endedAt:now.toISOString(),referenceIds:result.references.map(r=>r.id),citationIds:result.references.flatMap(r=>r.citationId?[r.citationId]:[])});
    state.tools!.resultBytes+=Buffer.byteLength(JSON.stringify(result));state.tools!.checkpoint++;return current;
   });
  }
  const content:CodingInput=[{type:'text',text:JSON.stringify(result)}];
  for(const reference of result.references){
   if(reference.kind!=='video-frame'||typeof reference.location.attachmentId!=='string')continue;
   const frame=VideoFrame.parse(reference.location.frame);
   try{content.push({type:'text',text:reference.label},{type:'image',url:await this.video.storage.dataUrl({type:'image',attachmentId:reference.location.attachmentId,image:frame.image,detail:'high',description:reference.label,frame})});}
   catch{content.push({type:'text',text:reference.label+': the saved screenshot is unavailable or damaged. Its pixels were NOT supplied; request frames again if needed.'});}
  }
  if(Buffer.byteLength(JSON.stringify(content))>3_500_000)throw new ProviderFailure(false,'recording_image_limit','The recording images exceed the coding provider result bound.');
  signal.throwIfAborted();return content;
 }
}
