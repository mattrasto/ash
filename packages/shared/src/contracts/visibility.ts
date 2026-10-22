import { z } from 'zod';
import type { RequestPayload } from './threads.ts';
const instant=z.string().datetime({offset:true}).refine(value=>{const date=new Date(value);return Number.isFinite(date.getTime())&&date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999;},'Use a valid datetime in calendar years 1–9999.');
export const ThreadLifecycle=z.object({
  version:z.number().int().default(0), controls:z.number().int().default(0), activity:z.number().int().default(0),
  seen:z.number().int().default(0), unread:z.number().int().default(0), unreadAt:instant.nullable().default(null),
  messages:z.number().int().default(0), namedCount:z.number().int().default(0), titleMode:z.enum(['manual','automatic']).default('manual'),
  kind:z.enum(['pending','immediate','until','indefinite','failed']).default('indefinite'), deadline:instant.nullable().default(null),
  origin:z.enum(['manual','automatic']).nullable().default(null),
  pendingAt:instant.nullable().default(null), changedAt:instant.nullable().default(null), attemptedAt:instant.nullable().default(null),
  sourceId:z.string().uuid().nullable().default(null), changeId:z.string().uuid().nullable().default(null),
  drafts:z.record(z.string().uuid(),z.object({revision:z.number().int().nonnegative(),present:z.boolean()}).strict()).default({}),
  lastCommand:z.object({id:z.string().uuid(),hash:z.string()}).nullable().default(null),
  undo:z.object({title:z.string(),titleMode:z.enum(['manual','automatic']),isArchived:z.boolean(),isPinned:z.boolean(),origin:z.enum(['manual','automatic']).nullable()}).nullable().default(null),
});
export type ThreadLifecycle=z.infer<typeof ThreadLifecycle>;
export const DraftPresence=z.object({clientId:z.string().uuid(),revision:z.number().int().nonnegative(),present:z.boolean()}).strict();
export type DraftPresence=z.infer<typeof DraftPresence>;
export const hasDraft=(lifecycle:ThreadLifecycle)=>Object.values(lifecycle.drafts).some(draft=>draft.present);
export const ThreadChange=z.object({
  requestId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),
  title:z.string().trim().min(1).max(160).optional(),isArchived:z.boolean().optional(),isPinned:z.boolean().optional(),automaticName:z.literal(true).optional(),recalculate:z.literal(true).optional(),undo:z.literal(true).optional(),
}).strict().refine(v=>['title','isArchived','isPinned','automaticName','recalculate','undo'].some(k=>k in v),'Choose a Thread change.')
.refine(v=>!v.undo||Object.keys(v).length===3,'Undo is a separate command.').refine(v=>!v.automaticName||v.title===undefined,'Choose one name owner.');
export type ThreadChange=z.infer<typeof ThreadChange>;
const eventFields={type:z.literal('thread_event'),origin:z.enum(['manual','automatic','activity','undo']),reason:z.string().optional()};
export const ThreadEvent=z.discriminatedUnion('event',[
  z.object({...eventFields,event:z.literal('archived')}).strict(),
  z.object({...eventFields,event:z.literal('unarchived')}).strict(),
  z.object({...eventFields,event:z.literal('renamed'),previousTitle:z.string(),title:z.string()}).strict(),
 z.object({...eventFields,event:z.enum(['pinned','unpinned'])}).strict(),
 z.object({...eventFields,event:z.literal('name_mode'),previousMode:z.enum(['manual','automatic']),mode:z.enum(['manual','automatic'])}).strict(),
]);
export type ThreadEvent=z.infer<typeof ThreadEvent>;
export const VisibilityChoice=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('immediate'),reason:z.string().min(1)}).strict(),
  z.object({kind:z.literal('indefinite'),reason:z.string().min(1)}).strict(),
  z.object({kind:z.literal('until'),deadline:instant,reason:z.string().min(1)}).strict(),
]);
export const NameChoice=z.object({title:z.string().trim().min(1).max(160),reason:z.string().min(1)}).strict();
export const AssessmentResult=z.object({type:z.literal('thread_assessment_result'),kind:z.enum(['visibility','naming']),status:z.enum(['applied','discarded','failed','interrupted']),output:z.string(),reason:z.string(),model:z.record(z.unknown()).optional()}).strict();
export interface AssessmentView {id:string;kind:string;status:string;createdAt:string;finishedAt:string|null}
export function fibonacciThreshold(count:number){let a=1,b=2,last=0;while(a<=count){last=a;[a,b]=[b,a+b];}return last;}

export interface AssessmentDetail extends AssessmentView {
 threadId:string; applicationSourceIds:string[]; capture:Record<string,unknown>; request:RequestPayload; result:z.infer<typeof AssessmentResult>|null;
}
export interface ApplicationChangeView {
 id:string; threadId:string; origin:ThreadEvent['origin']; command:ThreadChange|null; events:ThreadEvent[];
 sourceArtifactId:string|null; assessmentId:string|null; createdAt:string;
}
