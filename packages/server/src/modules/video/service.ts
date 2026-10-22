import { mediaActivity } from '../visibility/state.ts';
import {randomUUID,createHash} from 'node:crypto';
import {Prisma,type PrismaClient,type Attachment,type Run} from '@prisma/client';
import {VideoPlan,VideoModelRequest,VideoModelResponse,VideoUnderstandingPayload,VideoMetadata,RunState,VIDEO_ANALYSIS_LIMITS,
  type VideoAnalysisResult,type VideoUnderstandingPayload as SavedVideo} from '@ash/shared';
import {VIDEO_RESPONSE_SCHEMA,type VideoProvider} from '../../platform/models/gemini-video.ts';
import {ModelFailure} from '../../platform/models/adapter.ts';
import {ImageStorage,AttachmentError} from '../attachments/storage.ts';
import {referenceImages} from '../attachments/service.ts';
import {VIDEO_BOUNDARY,RECORDING_ACTION_ITEMS,ensureVideoInstructions} from './instructions.ts';
import {prepareVideoSegment} from './media.ts';

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Analysis={payload:SavedVideo;artifactId:string;runId:string};
type Owner={runId:string;callId:string};
type Command={operation:'caption'|'describe'|'question';start?:number;end?:number;fps?:1|5;question?:string};
function empty():VideoAnalysisResult{return {caption:'',answer:'',actionItems:'',transcript:[],matches:[],limitations:[]};}
export class VideoAnalysis {
  private jobs=new Map<string,{controller:AbortController;promise:Promise<void>}>();
  private toolJobs=new Map<string,{controller:AbortController;promise:Promise<Analysis>;consumers:number}>();
  private tail:Promise<unknown>=Promise.resolve();
  private stopping=false;
  constructor(readonly db:PrismaClient,readonly storage:ImageStorage,readonly provider:VideoProvider,readonly autoDispatch=true){}
  private async plan(tx:Tx,attachment:Attachment,command:Command,previous?:Run):Promise<VideoPlan>{
    let plan:VideoPlan;
    if(previous){
      const saved=await tx.artifact.findUniqueOrThrow({where:{id:RunState.parse(previous.state).request_artifact_id}});
      plan=VideoPlan.parse(saved.payload);
    }else{
      await ensureVideoInstructions(tx);
      const source=VideoMetadata.parse(attachment.metadata),start=command.start??0,end=Math.min(command.end??source.durationSeconds,source.durationSeconds),fps=command.fps??1;
      if(command.end!==undefined&&command.end>source.durationSeconds+.001)throw new AttachmentError(400,'Choose an interval inside the video.');
      if(start>=end||start>=source.durationSeconds)throw new AttachmentError(400,'Choose an interval inside the video.');
      if(command.operation!=='caption'&&end-start>VIDEO_ANALYSIS_LIMITS.toolSeconds)throw new AttachmentError(400,'Choose an interval of at most ten minutes for this tool call.');
      if(fps===5&&end-start>VIDEO_ANALYSIS_LIMITS.detailSeconds)throw new AttachmentError(400,'Detailed inspection needs an interval of at most 30 seconds.');
      const instruction=await tx.instruction.findUniqueOrThrow({where:{key:command.operation==='caption'?'video-caption':'video-understanding'}});
      let context:VideoPlan['context']=null;
      if(command.operation!=='caption'&&attachment.summaryRunId){
        const summary=await tx.run.findUnique({where:{id:attachment.summaryRunId}});
        const responseId=summary?RunState.parse(summary.state).response_artifact_id:null;
        if(responseId){
          const row=await tx.artifact.findUnique({where:{id:responseId}}),parsed=VideoUnderstandingPayload.safeParse(row?.payload);
          if(parsed.success){
            const text=JSON.stringify({caption:parsed.data.result.caption,transcript:parsed.data.result.transcript.filter(s=>s.end>=start&&s.start<=end),limitations:parsed.data.result.limitations});
            context={summaryRunId:summary!.id,resultArtifactId:responseId,text:text.length>19800?text.slice(0,19800)+'\n[Generated context truncated; inspect the source for complete narration.]':text};
          }
        }
      }
      plan=VideoPlan.parse({type:'video_analysis',attachmentId:attachment.id,operation:command.operation,provider:this.provider.provider,model:this.provider.model,
        source:{original:source.original,playback:source.playback,durationSeconds:source.durationSeconds,hasAudio:source.hasAudio,recorded:!!source.recorded,incomplete:!!source.incomplete},
        range:{start,end},fps,question:command.question??'',context,instruction:{id:instruction.id,key:instruction.key!,text:instruction.text},
        limits:{chunkSeconds:VIDEO_ANALYSIS_LIMITS.chunkSeconds,maxChunks:VIDEO_ANALYSIS_LIMITS.maxChunks,timeoutMs:VIDEO_ANALYSIS_LIMITS.timeoutMs,
          requestTimeoutMs:VIDEO_ANALYSIS_LIMITS.requestTimeoutMs,maxOutputTokens:VIDEO_ANALYSIS_LIMITS.maxOutputTokens}});
    }
    return plan;
  }
  async create(tx:Tx,attachment:Attachment,key:string,command:Command={operation:'caption'},previous?:Run){
    const plan=await this.plan(tx,attachment,command,previous);
    const requestHash=hash(plan);
    const id=randomUUID(),requestId=randomUUID(),now=new Date();
    const run=await tx.run.create({data:{id,inputArtifactId:attachment.inputArtifactId,threadId:null,retryOfId:previous?.id,status:'queued',
      requestKey:key,requestHash,state:{request_artifact_id:requestId,response_artifact_id:null},createdAt:now}});
    await tx.artifact.create({data:{id:requestId,layer:'act',sourceId:attachment.inputArtifactId,runId:id,actor:'ash',payload:json(plan),createdAt:now,updatedAt:now}});
    await referenceImages(tx,requestId,[attachment.id]);
    if(command.operation==='caption')await tx.attachment.update({where:{id:attachment.id},data:{summaryRunId:id}});
    return run;
  }
  dispatch(id:string){
    if(this.stopping||this.jobs.has(id))return;
    const controller=new AbortController();
    const promise=this.tail.then(()=>this.execute(id,controller.signal)).finally(()=>this.jobs.delete(id));
    this.jobs.set(id,{controller,promise});this.tail=promise.catch(()=>{});
    void promise.catch(()=>console.error(JSON.stringify({event:'video-analysis-worker-error',runId:id})));
  }
  private async wait(id:string,signal:AbortSignal){
    signal.throwIfAborted();const job=this.jobs.get(id);
    if(!job)return;
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
      job.promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
    signal.throwIfAborted();
  }
  async forTool(attachmentId:string,command:Command,signal:AbortSignal,owner?:Owner):Promise<Analysis>{
    if(this.stopping)throw new AttachmentError(503,'Video analysis is stopping.');
    let attachment=await this.db.attachment.findUniqueOrThrow({where:{id:attachmentId}});
    if(attachment.summaryRunId)await this.wait(attachment.summaryRunId,signal);
    signal.throwIfAborted();
    attachment=await this.db.attachment.findUniqueOrThrow({where:{id:attachmentId}});
    const plan=await this.db.$transaction(tx=>this.plan(tx,attachment,command));
    if(!owner)throw new AttachmentError(400,'A captured tool call is required for video analysis.');
    const cacheKey=hash(plan),cached=await this.db.artifact.findFirst({where:{AND:[{payload:{path:['cacheKey'],equals:cacheKey}},{payload:{path:['type'],equals:'video_understanding'}}]},orderBy:{createdAt:'desc'}});
    if(cached)return {payload:VideoUnderstandingPayload.parse(cached.payload),artifactId:cached.id,runId:cached.runId!};
    const key=owner.runId+':'+cacheKey;
    let job=this.toolJobs.get(key);
    if(!job){
      const controller=new AbortController(),promise=this.performTool(plan,owner,cacheKey,controller.signal).finally(()=>this.toolJobs.delete(key));
      job={controller,promise,consumers:0};this.toolJobs.set(key,job);
    }
    job.consumers++;
    try{return await new Promise<Analysis>((resolve,reject)=>{
      const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      job!.promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
      if(signal.aborted)abort();
    });}finally{job.consumers--;if(signal.aborted&&job.consumers===0)job.controller.abort();}
  }
  private async performTool(plan:VideoPlan,owner:Owner,cacheKey:string,signal:AbortSignal):Promise<Analysis>{
    const run=await this.db.run.findUniqueOrThrow({where:{id:owner.runId}}),state=RunState.parse(run.state);
    const call=state.tools?.calls.find(c=>c.id===owner.callId);
    if(run.status!=='running'||!call)throw new ModelFailure('video_tool_scope','The video tool call is no longer active.');
    const rootId=randomUUID(),now=new Date();
    await this.db.$transaction(async tx=>{
      await tx.$queryRawUnsafe('SELECT id FROM runs WHERE id=$1::uuid FOR UPDATE',run.id);
      if(!await tx.run.findFirst({where:{id:run.id,status:'running'}}))throw new ModelFailure('video_interrupted','Video analysis stopped.');
      await tx.artifact.create({data:{id:rootId,layer:'act',sourceId:call.callArtifactId,runId:run.id,threadId:run.threadId,actor:'ash',payload:json(plan),createdAt:now,updatedAt:now}});
      await referenceImages(tx,rootId,[plan.attachmentId]);
    });
    const {result,coverage,requestIds,failure,truncated}=await this.perform(run,rootId,plan,signal);
    signal.throwIfAborted();
    if(failure&&!coverage.length)throw failure instanceof ModelFailure?failure:new ModelFailure('video_analysis_failed','Video analysis could not complete. The source is saved.');
    const id=randomUUID(),endedAt=new Date(),complete=!failure&&!truncated&&coverage.at(-1)?.end===plan.range.end;
    const payload=VideoUnderstandingPayload.parse({type:'video_understanding',attachmentId:plan.attachmentId,result,coverage,requestIds,timing:'estimated',complete,...(complete?{cacheKey}:{})});
    await this.db.$transaction(async tx=>{
      await tx.$queryRawUnsafe('SELECT id FROM runs WHERE id=$1::uuid FOR UPDATE',run.id);
      if(!await tx.run.findFirst({where:{id:run.id,status:'running'}}))throw new ModelFailure('video_interrupted','Video analysis stopped.');
      await tx.artifact.create({data:{id,layer:'act',sourceId:rootId,runId:run.id,threadId:run.threadId,actor:'ash',payload:json(payload),createdAt:endedAt,updatedAt:endedAt}});
      await referenceImages(tx,id,[plan.attachmentId]);
    });
    return {payload,artifactId:id,runId:run.id};
  }
  private async execute(id:string,outer:AbortSignal){
    if(outer.aborted)return;
    if(!(await this.db.run.updateMany({where:{id,status:'queued',threadId:null},data:{status:'running',startedAt:new Date()}})).count)return;
    const run=await this.db.run.findUniqueOrThrow({where:{id}}),state=RunState.parse(run.state),root=await this.db.artifact.findUniqueOrThrow({where:{id:state.request_artifact_id}});
    const plan=VideoPlan.parse(root.payload);
    const {result,coverage,requestIds,failure,truncated}=await this.perform(run,root.id,plan,outer);
    const status=outer.aborted?'cancelled':failure?'failed':'completed';
    await this.db.$transaction(async tx=>{
      const endedAt=new Date(),responseId=coverage.length?randomUUID():null;
      const error=failure?{code:failure instanceof ModelFailure?failure.code:'video_analysis_failed',message:failure instanceof ModelFailure?failure.message:'Video analysis could not complete. The source is saved.'}:undefined;
      if(!(await tx.run.updateMany({where:{id,status:'running'},data:{status,endedAt,state:json({...state,response_artifact_id:responseId}),...(error?{error}:{} )}})).count)return;
      if(responseId){
        const payload=VideoUnderstandingPayload.parse({type:'video_understanding',attachmentId:plan.attachmentId,result,coverage,requestIds,timing:'estimated',complete:!failure&&!truncated&&coverage.at(-1)?.end===plan.range.end});
        await tx.artifact.create({data:{id:responseId,layer:'act',sourceId:root.id,runId:id,actor:'ash',payload:json(payload),createdAt:endedAt,updatedAt:endedAt}});
        if(plan.operation==='caption')await mediaActivity(tx,plan.attachmentId,responseId);
        await referenceImages(tx,responseId,[plan.attachmentId]);
        if(plan.operation==='caption')await tx.attachment.updateMany({where:{id:plan.attachmentId,summaryRunId:id},data:{summary:result.caption}});
      }
    });
  }
  private async perform(run:Run,rootId:string,plan:VideoPlan,outer:AbortSignal){
    const signal=AbortSignal.any([outer,AbortSignal.timeout(plan.limits.timeoutMs)]);
    let result=empty(),coverage:Array<{start:number;end:number}>=[],requestIds:string[]=[],failure:unknown;
    const recording=plan.operation==='caption'&&plan.source.recorded&&plan.source.hasAudio;
    const segments:Array<{start:number;end:number;caption:string;actionItems:string}>=[];
    try{
      if(plan.provider!==this.provider.provider||plan.model!==this.provider.model)throw new ModelFailure('video_provider_changed','The saved video analysis uses a different provider configuration.');
      for(let start=plan.range.start;start<plan.range.end;start+=plan.limits.chunkSeconds){
        signal.throwIfAborted();
        if(coverage.length>=plan.limits.maxChunks){result.limitations.push('Processing limit reached; remaining video was not inspected.');break;}
        const end=Math.min(start+plan.limits.chunkSeconds,plan.range.end);
        const media=await prepareVideoSegment(this.storage,plan,start,end,signal);
        const task=plan.operation==='caption'?plan.instruction.text:plan.instruction.text+'\n'+(plan.operation==='question'?'Answer this question or find matching moments: '+plan.question:'Give a detailed description.');
        const prompt=VIDEO_BOUNDARY+'Times must be seconds relative to THIS supplied clip, starting at zero; its length is '+(end-start)+' seconds. '
          +(plan.source.recorded?'This is a user-recorded demonstration. ':'This is imported media. ')+task
          +(recording?'\n'+RECORDING_ACTION_ITEMS:'\nLeave actionItems empty.')
          +(plan.context?'\nPreviously generated context (fallible; original-clip timestamps): '+plan.context.text:'');
        const output=await this.request(run,rootId,plan,{operation:plan.operation,prompt,media},signal,requestIds);
        if(plan.operation==='caption'&&!output.caption.trim())throw new ModelFailure('video_caption_empty','Video analysis returned no visual caption.');
        if(recording&&output.actionItems===undefined)throw new ModelFailure('video_action_items_missing','Video analysis returned no action-item result. Retry analysis to prepare the draft.');
        if(plan.operation!=='caption'&&!output.answer.trim())throw new ModelFailure('video_answer_empty','Video analysis returned no answer.');
        const shifted=structuredClone(output);
        for(const item of [...shifted.transcript,...shifted.matches]){
          if(item.end<item.start||item.start<0||item.end>end-start+.2)throw new ModelFailure('video_bad_timing','Video analysis returned timestamps outside the inspected segment.');
          item.start+=media.sourceOffset;item.end=Math.min(end,item.end+media.sourceOffset);
        }
        if(!plan.source.hasAudio&&shifted.transcript.length)throw new ModelFailure('video_silent_transcript','A silent video returned narration; that transcript was rejected.');
        if(shifted.transcript.some((s,i)=>i>0&&s.start<shifted.transcript[i-1].start))throw new ModelFailure('video_bad_timing','The video transcript was not in chronological order.');
        result.caption+=(result.caption?'\n':'')+shifted.caption;
        result.answer+=(result.answer?'\n\n':'')+(shifted.answer?'[Original video '+start.toFixed(2)+'–'+end.toFixed(2)+'s]'
          +(media.sourceOffset>0?'\n[Answer timestamps are relative to this supplied clip: add '+media.sourceOffset.toFixed(2)+'s for original video time. Evidence citations use original video time.]':'')
          +'\n'+shifted.answer:'');
        result.transcript.push(...shifted.transcript);result.matches.push(...shifted.matches);result.limitations.push(...shifted.limitations);
        result.actionItems=recording?(shifted.actionItems??''):'';
        segments.push({start,end,caption:shifted.caption,actionItems:result.actionItems});
        coverage.push({start,end});
        if(JSON.stringify(result).length>VIDEO_ANALYSIS_LIMITS.resultCharacters)throw new ModelFailure('video_result_limit','Video analysis reached its output bound; earlier segments remain available.');
      }
      if(plan.operation==='caption'&&coverage.length>1){
        const context=recording?JSON.stringify({segments,transcript:result.transcript}):result.caption.slice(0,60000);
        if(context.length>85000)throw new ModelFailure('video_recording_context_limit','The recording is too long to consolidate action items completely. The transcript and source remain available.');
        const combined=await this.request(run,rootId,plan,{operation:'combine-caption',media:null,prompt:VIDEO_BOUNDARY+
          'Condense these generated segment captions into one 2–3 sentence caption of the whole inspected video. Preserve uncertainty. '
          +(recording?RECORDING_ACTION_ITEMS+'Read all segments in chronological order and resolve corrections across segments. ':'Leave actionItems empty. ')
          +'Leave answer, transcript and matches empty. Generated segment evidence:\n'+context},signal,requestIds);
        if(!combined.caption.trim())throw new ModelFailure('video_caption_empty','Video analysis returned no combined caption.');
        if(recording&&combined.actionItems===undefined)throw new ModelFailure('video_action_items_missing','Video analysis returned no consolidated action items.');
        result.caption=combined.caption;
        result.actionItems=recording?(combined.actionItems??''):'';
      }
    }catch(error){failure=error;}
    const truncated=result.caption.length>6000||result.answer.length>16000||result.transcript.length>4000||result.matches.length>256;
    if(failure||truncated||coverage.at(-1)?.end!==plan.range.end)result.actionItems='';
    result.limitations=[...new Set([...result.limitations,...(truncated?['Aggregate result truncated; inspect the captured segment responses or narrow the interval.']:[]),'Timestamps are model estimates; they are not verified audio/frame alignment.',
      'Video sampling requested at '+plan.fps+' FPS. Brief transitions between sampled frames may be missed; provider-selected frames are not individually exposed.',
      ...(plan.source.incomplete?['The source recording is incomplete.']:[]),...(failure?['Analysis did not complete; only the listed intervals were processed.']:[])])].slice(0,100);
    // Keep bounded partial evidence without implying the rest of the source was observed.
    result.caption=result.caption.slice(0,6000);result.answer=result.answer.slice(0,16000);result.transcript=result.transcript.slice(0,4000);result.matches=result.matches.slice(0,256);
    return {result,coverage,requestIds,failure,truncated};
  }
  private async request(run:Run,rootId:string,plan:VideoPlan,input:Pick<VideoModelRequest,'operation'|'prompt'|'media'>,signal:AbortSignal,requestIds:string[]){
    const request=VideoModelRequest.parse({type:'video_model_request',attachmentId:plan.attachmentId,provider:plan.provider,model:plan.model,...input,
      responseSchema:VIDEO_RESPONSE_SCHEMA,
      options:{api:'interactions',store:false,thinkingLevel:'low',maxOutputTokens:plan.limits.maxOutputTokens,timeoutMs:plan.limits.requestTimeoutMs,responseSchemaVersion:2}});
    const id=randomUUID(),now=new Date(),path=request.media?await this.storage.checkedFile(plan.attachmentId,request.media.file,signal):undefined;
    signal.throwIfAborted();await this.db.$transaction(async tx=>{
      if(!await tx.run.findFirst({where:{id:run.id,status:'running'}}))throw new ModelFailure('video_interrupted','Video analysis stopped.');
      await tx.artifact.create({data:{id,layer:'act',sourceId:rootId,runId:run.id,threadId:run.threadId,actor:'ash',payload:json(request),createdAt:now,updatedAt:now}});
      await referenceImages(tx,id,[plan.attachmentId]);
    });
    requestIds.push(id);
    const output=await this.provider.analyze(request,path,signal);
    signal.throwIfAborted();
    const response=VideoModelResponse.parse({type:'video_model_response',requestId:id,...output}),responseId=randomUUID(),endedAt=new Date();
    await this.db.$transaction(async tx=>{await tx.$queryRawUnsafe('SELECT id FROM runs WHERE id=$1::uuid FOR UPDATE',run.id);if(!await tx.run.findFirst({where:{id:run.id,status:'running'}}))throw new ModelFailure('video_interrupted','Video analysis stopped.');await tx.artifact.create({data:{id:responseId,layer:'act',sourceId:id,runId:run.id,threadId:run.threadId,actor:'ash',payload:json(response),createdAt:endedAt,updatedAt:endedAt}});});
    if(!output.result)throw new ModelFailure('video_invalid_result','Video analysis returned incomplete or invalid structured output; the visible output is retained for inspection.');
    return output.result;
  }
  async stop(){this.stopping=true;for(const job of [...this.jobs.values(),...this.toolJobs.values()])job.controller.abort();await Promise.allSettled([...this.jobs.values(),...this.toolJobs.values()].map(j=>j.promise));}
}
