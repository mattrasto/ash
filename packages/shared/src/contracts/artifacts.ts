import { z } from 'zod';
const uuid=z.string().uuid();
export const IncomingSource=z.object({name:z.string().trim().min(1).max(100),eventId:z.string().trim().min(1).max(300),label:z.string().trim().min(1).max(160),url:z.string().url().max(2000).refine(value=>/^https?:/.test(value)).optional()}).strict();
export const ReceiveItem=z.object({id:uuid,source:IncomingSource,text:z.string().min(1).max(8000).refine(value=>value.trim().length>0),occurredAt:z.string().datetime({offset:true}).optional(),targetThreadId:uuid.optional()}).strict();
export type ReceiveItem=z.infer<typeof ReceiveItem>;
export const IncomingPayload=ReceiveItem.omit({id:true}).extend({type:z.literal('incoming_input')}).strict();
export const EngineStage=z.enum(['filter','route','assess']);
export const FilterResult=z.object({type:z.literal('filter_result'),outcome:z.enum(['pass','drop']),reason:z.string().trim().min(1).max(1000)}).strict();
export const RouteChoice=z.object({destination:z.enum(['existing','new']),threadId:uuid.nullable(),title:z.string().trim().min(1).max(160),reason:z.string().trim().min(1).max(1000),assumption:z.string().max(1000),ambiguous:z.boolean()}).strict().refine(v=>v.destination==='new'?v.threadId===null:v.threadId!==null,'Existing placement needs a Thread; new placement must not specify one.').refine(v=>!v.ambiguous||v.assumption.trim().length>0,'Ambiguous placement requires a recorded assumption.');
export const RouteResult=z.object({type:z.literal('route_result'),choice:RouteChoice,threadId:uuid,explicit:z.boolean()}).strict();
export const ActPlan=z.object({type:z.literal('act_plan'),action:z.boolean(),showSource:z.boolean(),showResponse:z.boolean(),reason:z.string().trim().min(1).max(1000)}).strict().refine(v=>!v.showResponse||v.action,'A response requires action.');
export const EngineError=z.object({type:z.literal('engine_error'),stage:z.string(),code:z.string(),message:z.string(),output:z.string().max(16000).optional()}).strict();
export const EngineOutcome=z.union([FilterResult,RouteResult,ActPlan,EngineError]);
export const IntakeState=z.object({stage:z.enum(['filter','route','assess','dispatch','done']),parentId:uuid,currentRequestId:uuid.nullable(),threadId:uuid.nullable(),planId:uuid.nullable(),sourceSurfaceId:uuid.nullable(),runId:uuid.nullable()}).strict();
export const IntakeStatus=z.enum(['queued','processing','waiting_capacity','completed','dropped','failed','interrupted']);
export interface IncomingView {id:string;status:z.infer<typeof IntakeStatus>;state:z.infer<typeof IntakeState>;error:string|null;createdAt:string;updatedAt:string;input:z.infer<typeof IncomingPayload>;runStatus?:string|null}
