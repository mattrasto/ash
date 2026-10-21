import { z } from 'zod';
import { ToolAction, ToolJson } from './tools.ts';
import { CapturedSavePermission } from './permissions.ts';

export const DecisionRequest = z.object({
  kind:z.enum(['question','permission']),question:z.string().trim().min(1).max(4000),reason:z.string().trim().min(1).max(4000),
  form:z.enum(['text','choice','approval']),options:z.array(z.object({id:z.string().min(1).max(100),label:z.string().min(1).max(1000)}).strict()).max(32).default([]),
  action:ToolAction.optional(),arguments:ToolJson.optional(),binding:z.string().optional(),restrictionIds:z.array(z.string().uuid()).default([]),
  evaluationArtifactId:z.string().uuid().optional(),proposal:CapturedSavePermission.optional(),
}).strict().refine(r=>r.form!=='choice'||r.options.length>0,'A choice needs options.')
  .refine(r=>r.kind!=='permission'||(r.form==='approval'&&!!r.action&&!!r.binding),'Permission requests need a reviewed action.')
  .refine(r=>new Set(r.options.map(o=>o.id)).size===r.options.length,'Duplicate options.');
export type DecisionRequest = z.infer<typeof DecisionRequest>;
export const DecisionResolution = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('answer'),submissionId:z.string().uuid(),value:ToolJson,comment:z.string().max(4000).optional(),source:z.enum(['controls','chat']),sourceArtifactId:z.string().uuid().optional(),resolvedAt:z.string().datetime()}).strict(),
  z.object({kind:z.literal('cancellation'),reason:z.string().min(1).max(4000),resolvedAt:z.string().datetime()}).strict(),
]);
export type DecisionResolution = z.infer<typeof DecisionResolution>;
export const CreateDecision = z.object({id:z.string().uuid(),threadId:z.string().uuid().nullable().default(null),sourceArtifactId:z.string().uuid().nullable().default(null),request:DecisionRequest,dueAt:z.string().datetime().nullable().default(null)}).strict();
export const AnswerDecision = z.object({submissionId:z.string().uuid(),value:ToolJson,comment:z.string().max(4000).optional()}).strict();
export const DecisionView = CreateDecision.extend({status:z.enum(['pending','snoozed','resolved','cancelled']),resolution:DecisionResolution.nullable(),snoozedUntil:z.string().datetime().nullable(),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),work:z.array(z.object({id:z.string().uuid(),status:z.string(),threadId:z.string().uuid().nullable()}).strict()).optional()});
export type DecisionView = z.infer<typeof DecisionView>;
export const DecisionDependency = z.object({decisionId:z.string().uuid(),stepKey:z.string(),status:z.enum(['waiting','consumed','cancelled']),consumedAt:z.string().datetime().optional()}).strict();
