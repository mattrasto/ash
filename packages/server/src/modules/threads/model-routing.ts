import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Prisma, PrismaClient, Thread } from '@prisma/client';
import { ModelRoutingRequest, RequestPayload, RoutingSelection, RoutingState, RunState, ThreadLifecycle, modelContentText, type RoutingAttempt as Attempt, type RoutingSelection as Selection } from '@ash/shared';
import { ModelFailure, type ModelAdapter } from '../../platform/models/adapter.ts';
import { ROUTING_QUESTION, ROUTING_CRITERIA, type RoutingJudge } from '../../platform/models/jev-router.ts';
import { ensureRoutingInstruction } from '../instructions/model-routing.ts';
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const policy='jev-routing-v1' as const;
export class ModelRouting {
  constructor(private db:PrismaClient,private model:ModelAdapter,private judge:RoutingJudge,private timeoutMs=1000){}
  async prepare(tx:Prisma.TransactionClient,thread:Thread,request:RequestPayload):Promise<RequestPayload|ReturnType<typeof ModelRoutingRequest.parse>>{
    if(!this.model.routingConfiguration||request.provider!=='openai'||request.purpose||request.incoming)return request;
    await ensureRoutingInstruction(tx);
    const doc=await tx.instruction.findUniqueOrThrow({where:{key:'model-routing'}});
    const instruction={id:doc.id,text:doc.text,updatedAt:doc.updatedAt.toISOString()};
    const state=RoutingState.parse(ThreadLifecycle.parse(thread.lifecycle).modelRouting??{});
    if(state.override==='private')throw new ModelFailure('private_unavailable','Private inference is not configured. No routing or inference request was sent.');
    if(state.override!=='auto'||state.upgraded){
      const role=state.override==='fast'?'fast':'strong';
      return RequestPayload.parse({...request,...this.model.routingConfiguration(role),routing:{policy,source:state.override==='auto'?'sticky':'override',role,previousUpgraded:state.upgraded,instruction}});
    }
    const started=performance.now();
    // All evidence is already in the saved response context. No retrieval, summaries or tool execution.
    const messages=request.messages.map(message=>({role:message.role,text:modelContentText(message.content)}));
    const tools=request.tools?.definitions.map(tool=>({name:tool.name,description:tool.description}))??[];
    const packet=JSON.stringify({messages,tools,omissions:request.selection.omissions??{},images:request.selection.images??[],videos:request.selection.videos?.map(v=>({representation:v.representation,reason:v.reason}))??[]});
    const missingMedia=request.selection.videos?.some(v=>v.representation==='metadata')||request.selection.images?.some(v=>{
      const block=request.messages.flatMap(m=>typeof m.content==='string'?[]:m.content).find(b=>b.type==='image'&&b.attachmentId===v.id);
      return !block||block.type!=='image'||!block.description||/unavailable|pending/i.test(block.description);
    });
    const contextLimit=packet.length+instruction.text.length+ROUTING_QUESTION.length+1200>8000;
    const attempt:Attempt={policy,previousUpgraded:state.upgraded,overrideVersion:state.version,instruction,question:ROUTING_QUESTION,criteria:ROUTING_CRITERIA,packet:contextLimit?null:packet,preparationMs:performance.now()-started,...(contextLimit?{skipReason:'context_limit' as const}:missingMedia?{skipReason:'media_unavailable' as const}:{})};
    return ModelRoutingRequest.parse({type:'model_routing_request',request,attempt});
  }
  async resolve(runId:string,captureId:string,capture:ReturnType<typeof ModelRoutingRequest.parse>,signal:AbortSignal){
    signal.throwIfAborted();
    const attempt=capture.attempt,started=performance.now();
    let selection:Selection={policy,source:'fallback',role:'strong',previousUpgraded:attempt.previousUpgraded,instruction:attempt.instruction,attemptId:captureId,preparationMs:attempt.preparationMs};
    const deadline=AbortSignal.timeout(Math.max(1,Math.floor(this.timeoutMs-attempt.preparationMs)));
    const abort=AbortSignal.any([signal,deadline]);
    try{
      if(attempt.skipReason)selection.error=attempt.skipReason;
      else if(attempt.preparationMs>=this.timeoutMs)selection.error='routing_timeout';
      else{
        // Race explicitly: a provider that ignores cancellation cannot stall execution or commit late output.
        const result=await new Promise<Awaited<ReturnType<RoutingJudge['assess']>>>((resolve,reject)=>{
          const stop=()=>reject(new Error('routing_aborted'));
          abort.addEventListener('abort',stop,{once:true});
          if(abort.aborted){abort.removeEventListener('abort',stop);stop();return;}
          Promise.resolve().then(()=>this.judge.assess(attempt,abort)).then(resolve,reject).finally(()=>abort.removeEventListener('abort',stop));
        });
        const parsed=RoutingSelection.parse({...selection,...result,source:'jev'});
        const p=parsed.probabilities;
        const fast=parsed.choice==='fast_sufficient'&&p&&p.fast_sufficient>=0.90&&p.fast_sufficient>p.strong_preferred&&p.fast_sufficient>p.uncertain;
        selection={...parsed,role:fast?'fast':'strong'};
      }
    }catch(error){
      if(signal.aborted)throw new ModelFailure('provider_aborted','The response was stopped.');
      selection.error=deadline.aborted?'routing_timeout':error instanceof Error&&error.message==='routing_credentials'?'routing_credentials':'routing_failed';
    }
    signal.throwIfAborted();
    selection.elapsedMs=performance.now()-started;
    return this.db.$transaction(async tx=>{
      // Match acceptance's Thread-before-Run lock order; never hold locks over external work.
      const initial=await tx.run.findUniqueOrThrow({where:{id:runId}});
      await tx.$queryRaw`SELECT id FROM threads WHERE id=${initial.threadId}::uuid FOR UPDATE`;
      // Cancellation/settlement holds Run before its activity trigger locks Thread.
      // Yield to that owner instead of creating a Thread/Run lock inversion.
      const claimed=await tx.$queryRaw<{id:string}[]>`SELECT id FROM runs WHERE id=${runId}::uuid FOR UPDATE SKIP LOCKED`;
      if(!claimed.length)return null;
      const run=await tx.run.findUniqueOrThrow({where:{id:runId}}),state=RunState.parse(run.state);
      if(run.status!=='running'||signal.aborted)return null;
      if(state.request_artifact_id!==captureId)throw new ModelFailure('routing_changed','The saved routing checkpoint changed.');
      const thread=await tx.thread.findUniqueOrThrow({where:{id:run.threadId!}}),lifecycle=ThreadLifecycle.parse(thread.lifecycle),current=RoutingState.parse(lifecycle.modelRouting??{});
      if(current.override==='private')throw new ModelFailure('private_unavailable','Private inference is not configured. No inference request was sent.');
      if(current.override!=='auto')selection={...selection,source:'override',role:current.override==='fast'?'fast':'strong'};
      else if(current.upgraded)selection={...selection,source:'sticky',role:'strong'};
      else if(current.version!==attempt.overrideVersion)selection={...selection,source:'fallback',role:'strong',error:'routing_changed'};
      const request=RequestPayload.parse({...capture.request,...this.model.routingConfiguration!(selection.role),routing:selection});
      const id=randomUUID(),now=new Date();
      await tx.artifact.create({data:{id,layer:'act',sourceId:captureId,threadId:run.threadId,runId,actor:'ash',payload:json(request),createdAt:now,updatedAt:now}});
      const references=[...(request.selection.images??[]).map(i=>i.id),...(request.selection.videos??[]).map(i=>i.id)];
      if(references.length)await tx.artifactAttachment.createMany({data:[...new Set(references)].map(attachmentId=>({artifactId:id,attachmentId}))});
      state.request_artifact_id=id;
      await tx.run.update({where:{id:runId},data:{state:json(state)}});
      if(current.override==='auto'&&selection.role==='strong'){
        lifecycle.modelRouting={...current,upgraded:true};
        await tx.thread.update({where:{id:thread.id},data:{lifecycle:json(lifecycle)}});
      }
      return {id,request};
    });
  }
}
export function retryRoutingRequest(capture:ReturnType<typeof ModelRoutingRequest.parse>):RequestPayload{
  return RequestPayload.parse({...capture.request,routing:{policy,source:'retry',role:'strong',previousUpgraded:capture.attempt.previousUpgraded,instruction:capture.attempt.instruction,error:'interrupted_assessment'}});
}
