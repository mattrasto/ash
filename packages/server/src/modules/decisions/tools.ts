import { z } from 'zod';
import { DecisionRequest, modelContentText, type ToolResult } from '@ash/shared';
import { registerTool, type ToolRuntime } from '../tools/contract.ts';
import { Decisions, DecisionWait } from './service.ts';
const question=z.object({question:z.string().min(1).max(4000),reason:z.string().min(1).max(4000),options:z.array(z.object({id:z.string().min(1),label:z.string().min(1)}).strict()).max(32).nullable().optional()}).strict();
const answer=z.object({decisionId:z.string().uuid(),value:z.union([z.string().min(1).max(4000),z.object({skipped:z.literal(true)}).strict()])}).strict();
const definition=(name:string,description:string,properties:Record<string,any>,required:string[])=>({name,version:1,description,inputSchema:{type:'object',properties,required,additionalProperties:false},effects:['input'],concurrency:'exclusive' as const,repeatability:'safe' as const,limits:{timeoutMs:5000,resultBytes:8192}});
const result=(value:unknown):ToolResult=>({status:'success',content:[{type:'text',text:JSON.stringify(value)}],references:[],omissions:[]});
export function decisionRuntime(decisions:Decisions):ToolRuntime{
  const ask=registerTool({
    definition:definition('decisions.ask','Ask a required ordinary question or choice. Work calling this tool waits durably until answered. Use when a missing user answer is necessary; do not use for permission approvals. A saved answer is immutable. Options have stable IDs.',{question:{type:'string'},reason:{type:'string'},options:{type:['array','null'],items:{type:'object',properties:{id:{type:'string'},label:{type:'string'}},required:['id','label'],additionalProperties:false}}},['question','reason','options']),
    parse:input=>question.parse(input),async prepare(args){return {args,action:{operation:'decisions.ask',resources:[],effects:['input']}};},
    async execute(prepared,context){
      const request=DecisionRequest.parse({kind:'question',question:prepared.args.question,reason:prepared.args.reason,form:prepared.args.options?.length?'choice':'text',options:prepared.args.options??[]});
      const view=await decisions.hold(context.runId,context.callId,request);
      if(['pending','snoozed'].includes(view.status))throw new DecisionWait();
      const value=view.resolution?.kind==='answer'?view.resolution.value:{cancelled:true};
      if(value&&typeof value==='object')return {status:'error',content:[{type:'text',text:'The user skipped or cancelled the required input. Explain which dependent work cannot continue. Do not recreate the same unchanged question.'}],references:[],omissions:[],error:{code:'question_skipped',message:'Required input was skipped or cancelled.',retryable:false,effect:'none'}};
      return result(value);
    },
  });
  const respond=registerTool({
    definition:definition('decisions.answer','Resolve an ordinary pending Decision from a clear user chat reply. Use only when the intended question and answer are unambiguous; otherwise clarify. Never use for permission confirmation. Select choice option IDs rather than labels; use {skipped:true} for an explicit Skip. Answers cannot be edited.',{decisionId:{type:'string'},value:{anyOf:[{type:'string'},{type:'object',properties:{skipped:{type:'boolean',const:true}},required:['skipped'],additionalProperties:false}]}},['decisionId','value']),parse:input=>answer.parse(input),async prepare(args){return {args,action:{operation:'decisions.answer',resources:[],effects:['input']}};},
    async execute(prepared,context){const run=await decisions.db.run.findUniqueOrThrow({where:{id:context.runId}});const input=await decisions.db.artifact.findUniqueOrThrow({where:{id:run.inputArtifactId}});const saved=await decisions.answer(prepared.args.decisionId,{submissionId:input.id,value:prepared.args.value},'chat',input.id);return result(saved.resolution);},
  });
  return {tools:[ask,respond],async resources(_runId,threadId,request){const pending=(await decisions.list(threadId)).filter(d=>['pending','snoozed'].includes(d.status)&&d.request.kind==='question');const text=request?modelContentText(request.messages.filter(m=>m.role==='user').at(-1)?.content??''):'';if(request?.provider!=='openai'&&!pending.length&&!/ask me|decision|choose|clarif/i.test(text))return [];return [{kind:'decisions',id:'required-input',label:'Ask required questions'},...pending.map(d=>({kind:'decision',id:d.id,label:JSON.stringify(d.request)}))];},async authorize(){return {outcome:'allowed',code:'decision_input',message:'Collect ordinary user input.',configurationRevision:'decision-input',evaluator:'not-performed'};}};
}
