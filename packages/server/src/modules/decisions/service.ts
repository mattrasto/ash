import { randomUUID, createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Decision } from '@prisma/client';
import { ToolSuspension } from '../tools/contract.ts';
import { CreateDecision, DecisionView, DecisionRequest, DecisionResolution, RunState, AnswerDecision } from '@ash/shared';

export class DecisionError extends Error { constructor(readonly status:number,message:string){super(message);} }
export class DecisionWait extends ToolSuspension { constructor(){super('Work is waiting for a Decision.');} }
export const fingerprint = (value:unknown):string => {
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const json=(v:unknown)=>v as Prisma.InputJsonValue;
export function decisionView(row:Decision){return DecisionView.parse({...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),dueAt:row.dueAt?.toISOString()??null,snoozedUntil:row.snoozedUntil?.toISOString()??null});}
export class Decisions {
  onChanged:()=>void=()=>{};
  constructor(readonly db:PrismaClient){}
  async create(input:unknown){const command=CreateDecision.parse(input);if(command.dueAt)command.dueAt=new Date(command.dueAt).toISOString();return this.db.$transaction(tx=>this.createIn(tx,command));}
  async createIn(tx:Prisma.TransactionClient,command:ReturnType<typeof CreateDecision.parse>){
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${command.id}))::text`;
    const previous=await tx.decision.findUnique({where:{id:command.id}});
    if(previous){const view=decisionView(previous);if(fingerprint({request:view.request,threadId:view.threadId,sourceArtifactId:view.sourceArtifactId,dueAt:view.dueAt})!==fingerprint({request:command.request,threadId:command.threadId,sourceArtifactId:command.sourceArtifactId,dueAt:command.dueAt}))throw new DecisionError(409,'This Decision ID already identifies a different request.');return view;}
    if(command.threadId&&!await tx.thread.findUnique({where:{id:command.threadId}}))throw new DecisionError(404,'Thread not found.');
    if(command.sourceArtifactId&&!await tx.artifact.findUnique({where:{id:command.sourceArtifactId}}))throw new DecisionError(404,'Source not found.');
    const now=new Date();return decisionView(await tx.decision.create({data:{...command,request:json(command.request),dueAt:command.dueAt?new Date(command.dueAt):null,createdAt:now,updatedAt:now}}));
  }
  async wake(){await this.db.decision.updateMany({where:{status:'snoozed',snoozedUntil:{lte:new Date()}},data:{status:'pending',snoozedUntil:null,updatedAt:new Date()}});}
  async list(threadId?:string){await this.wake();const runs=await this.db.run.findMany({where:threadId?{threadId}:{},select:{id:true,status:true,threadId:true,state:true}});return (await this.db.decision.findMany({where:threadId?{threadId}:{},orderBy:[{dueAt:'asc'},{createdAt:'asc'},{id:'asc'}]})).map(row=>({...decisionView(row),work:runs.filter(run=>RunState.parse(run.state).decisions?.some(d=>d.decisionId===row.id)).map(run=>{const state=RunState.parse(run.state),dependency=state.decisions?.find(d=>d.decisionId===row.id),call=state.tools?.calls.find(c=>c.id===dependency?.stepKey);const permission=decisionView(row).request.kind==='permission';const status=permission&&call?.status==='denied'?'blocked':permission&&call?.status==='error'?'failed':permission&&call?.status==='unknown'?'outcome unknown':permission&&call?.status==='completed'?'completed':run.status;return {id:run.id,status,threadId:run.threadId};})}));}
  async answer(id:string,input:unknown,source:'controls'|'chat'='controls',sourceArtifactId?:string){
    const command=AnswerDecision.parse(input);
    const saved=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM decisions WHERE id=${id}::uuid FOR UPDATE`;
      const row=await tx.decision.findUnique({where:{id}});if(!row)throw new DecisionError(404,'Decision not found.');
      const view=decisionView(row);
      if(view.status==='resolved'){
        const answer=view.resolution;
        if(answer?.kind==='answer'&&fingerprint({value:answer.value,comment:answer.comment,source:answer.source,sourceArtifactId:answer.sourceArtifactId})===fingerprint({value:command.value,comment:command.comment,source,sourceArtifactId}))return view;
        throw new DecisionError(409,'This Decision already has an immutable answer.');
      }
      if(!['pending','snoozed'].includes(view.status))throw new DecisionError(409,'This request was cancelled.');
      const request=view.request;
      if(request.kind==='permission'&&source!=='controls')throw new DecisionError(409,'Permission approval requires the Decision controls.');
      if(source==='chat'){
        const artifact=sourceArtifactId?await tx.artifact.findUnique({where:{id:sourceArtifactId}}):null;
        if(!artifact||artifact.layer!=='input'||artifact.actor!=='user')throw new DecisionError(400,'Chat answers require their original user message.');
      }
      const skipped=request.kind==='question'&&fingerprint(command.value)===fingerprint({skipped:true});
      if(!skipped&&request.form==='text'&&(typeof command.value!=='string'||!command.value.trim()))throw new DecisionError(400,'Enter an answer.');
      if(!skipped&&request.form!=='text'&&!request.options.some(option=>option.id===command.value))throw new DecisionError(400,'Choose one of the reviewed responses.');
      const resolution=DecisionResolution.parse({kind:'answer',...command,source,...(sourceArtifactId?{sourceArtifactId}:{}),resolvedAt:new Date().toISOString()});
      return decisionView(await tx.decision.update({where:{id},data:{status:'resolved',resolution:json(resolution),snoozedUntil:null,updatedAt:new Date()}}));
    });this.onChanged();return saved;
  }
  async snooze(id:string,until:string|null){
    if(until&&(!Number.isFinite(Date.parse(until))||Date.parse(until)<=Date.now()))throw new DecisionError(400,'Choose a future snooze time.');
    if(!(await this.db.decision.updateMany({where:{id,status:{in:['pending','snoozed']}},data:{status:until?'snoozed':'pending',snoozedUntil:until?new Date(until):null,updatedAt:new Date()}})).count)throw new DecisionError(409,'Only unanswered Decisions can be snoozed.');
    return decisionView(await this.db.decision.findUniqueOrThrow({where:{id}}));
  }
  async resolveClearChat(threadId:string,inputId:string,text:string){
    const pending=(await this.list(threadId)).filter(d=>d.request.kind==='question'&&['pending','snoozed'].includes(d.status));
    let response:{id:string;value:unknown}|undefined;
    if(pending.length===1&&/^skip(?: this| that)?(?: question| decision)?[.!]?$/i.test(text.trim()))response={id:pending[0].id,value:{skipped:true}};
    else {
      const clean=text.trim().replace(/^(?:use|choose|select|answer:)\s*/i,'').replace(/[.!]$/,'').toLowerCase();
      const candidates=pending.flatMap(d=>{const option=d.request.options.find(o=>[o.id,o.label].some(v=>v.toLowerCase()===clean));return option?[{id:d.id,value:option.id}]:d.request.form==='text'&&/^answer:\s*\S/i.test(text)?[{id:d.id,value:text.replace(/^answer:\s*/i,'').trim()}]:[];});
      if(candidates.length===1)response=candidates[0];
    }
    if(response)try {await this.answer(response.id,{submissionId:inputId,value:response.value},'chat',inputId);}
    catch(error){
      // A concurrent answer/cancellation wins without rejecting the accepted chat message.
      if(!(error instanceof DecisionError&&error.status===409))throw error;
    }
  }
  async cancelIn(tx:Prisma.TransactionClient,id:string,reason:string){return tx.decision.updateMany({where:{id,status:{in:['pending','snoozed']}},data:{status:'cancelled',snoozedUntil:null,resolution:json({kind:'cancellation',reason,resolvedAt:new Date().toISOString()}),updatedAt:new Date()}});}
  async cancel(id:string,reason='Input is no longer needed.'){await this.db.$transaction(tx=>this.cancelIn(tx,id,reason));this.onChanged();return decisionView(await this.db.decision.findUniqueOrThrow({where:{id}}));}
  async hold(runId:string,callId:string,request:DecisionRequest,existingQuestionId?:string){
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM runs WHERE id=${runId}::uuid FOR UPDATE`;
      const run=await tx.run.findUniqueOrThrow({where:{id:runId}});if(run.status!=='running')throw new DecisionError(409,'This work has stopped.');
      const state=RunState.parse(run.state),call=state.tools!.calls.find(item=>item.id===callId)!;
      if(existingQuestionId&&request.kind!=='question')throw new DecisionError(400,'Only ordinary questions can be shared this way.');
      let decision=call.decisionId||existingQuestionId?await tx.decision.findUnique({where:{id:call.decisionId??existingQuestionId}}):null;
      if(existingQuestionId&&(!decision||fingerprint(decisionView(decision).request)!==fingerprint(request)))throw new DecisionError(409,'This question does not match the required input.');
      if(!decision&&request.kind==='question'){
        const related=(state.decisions??[]).filter(d=>d.stepKey!==callId);
        for(const dependency of related){const candidate=await tx.decision.findUnique({where:{id:dependency.decisionId}});if(candidate&&fingerprint(decisionView(candidate).request)===fingerprint(request)&&candidate.status!=='cancelled'){decision=candidate;break;}}
      }
      if(decision&&fingerprint(decisionView(decision).request)!==fingerprint(request)){
        await this.cancelIn(tx,decision.id,'The requested action or required input changed.');
        const old=state.decisions?.find(d=>d.decisionId===decision!.id&&d.stepKey===callId);if(old?.status==='waiting')old.status='cancelled';decision=null;
      }
      const view=decision?decisionView(decision):await this.createIn(tx,CreateDecision.parse({id:randomUUID(),threadId:run.threadId,sourceArtifactId:call.callArtifactId,request}));
      call.decisionId=view.id;state.decisions??=[];
      let dependency=state.decisions.find(d=>d.decisionId===view.id&&d.stepKey===callId);
      if(!dependency){dependency={decisionId:view.id,stepKey:callId,status:'waiting'};state.decisions.push(dependency);}
      if(view.status==='resolved') {dependency.status='consumed';dependency.consumedAt??=new Date().toISOString();}
      else if(view.status==='cancelled'){dependency.status='cancelled';}
      else {call.status='waiting';state.tools!.reservedResultBytes-=call.reservedBytes??0;delete call.reservedBytes;}
      await tx.run.update({where:{id:runId},data:{state:json(state)}});return view;
    });
  }
  async cancelWorkIn(tx:Prisma.TransactionClient,runId:string,state:ReturnType<typeof RunState.parse>){
    for(const dependency of state.decisions??[]){
      if(dependency.status!=='waiting')continue;dependency.status='cancelled';
      const question=await tx.decision.findUnique({where:{id:dependency.decisionId}});
      const origin=question?.sourceArtifactId?await tx.artifact.findUnique({where:{id:question.sourceArtifactId}}):null;
      if(!origin||(origin.payload as {type?:string}).type!=='tool_call')continue;
      const others=await tx.run.findMany({where:{id:{not:runId},status:{in:['running','queued','waiting']}}});
      if(!others.some(run=>RunState.parse(run.state).decisions?.some(d=>d.decisionId===dependency.decisionId&&d.status==='waiting')))await this.cancelIn(tx,dependency.decisionId,'The dependent work was cancelled.');
    }
  }
}
