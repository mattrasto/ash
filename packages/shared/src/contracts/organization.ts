import { z } from 'zod';

const id = z.string().uuid();
export const CreateTopic = z.object({id, name:z.string().trim().min(1).max(160)}).strict();
export const ChangeTopic = z.object({expectedUpdatedAt:z.string().datetime(), name:z.string().trim().min(1).max(160).optional(), deleted:z.literal(true).optional()}).strict()
  .refine(value => (value.name !== undefined) !== (value.deleted !== undefined), 'Choose one Topic change.');
export const ChangeMembership = z.object({expectedVersion:z.number().int().nonnegative(), topicIds:z.array(id).max(100)}).strict()
  .refine(value => new Set(value.topicIds).size === value.topicIds.length, 'Duplicate Topics.');
export const InstructionOwner = z.discriminatedUnion('scope', [
  z.object({scope:z.literal('global'), key:z.enum(['response','image-description','video-caption','video-understanding','engine-filter','engine-route','engine-assess'])}).strict(),
  z.object({scope:z.literal('topic'), id}).strict(),
  z.object({scope:z.literal('thread'), id}).strict(),
]);
export type InstructionOwner = z.infer<typeof InstructionOwner>;
export const SaveInstruction = z.object({owner:InstructionOwner, text:z.string().max(12000),
  expected:z.object({id,updatedAt:z.string().datetime()}).strict().nullable()}).strict()
  .refine(value => value.owner.scope !== 'global' || value.owner.key !== 'image-description' || value.text.length <= 3000, 'Image description guidance must fit its 4,000-character context.');
export interface InstructionView {id:string;name:string;text:string;updatedAt:string}
export interface OwnedInstruction {owner:InstructionOwner;document:InstructionView|null}
export interface TopicView {id:string;name:string;updatedAt:string;threadIds:string[]}
export interface LinkedTopic {id:string;name:string;linkedAt:string}
export interface MembershipView {version:number;topics:LinkedTopic[]}
export const TopicSearch = z.object({query:z.string().trim().min(1).max(160)}).strict();
export const TopicRead = z.object({artifactId:id,offset:z.number().int().min(0).max(1_000_000).default(0)}).strict();
export const TopicExcerpt=z.object({
  artifactId:id,threadId:id,threadTitle:z.string(),speaker:z.enum(['user','ash','source']),sourceLabel:z.string().optional(),createdAt:z.string().datetime(),
  text:z.string(),offset:z.number().int().nonnegative(),totalCharacters:z.number().int().nonnegative(),truncated:z.boolean(),
  images:z.array(z.object({id,summaryRunId:id.nullable(),descriptionAvailable:z.boolean()}).strict()),
}).strict();
export type TopicExcerpt=z.infer<typeof TopicExcerpt>;
export const TopicRetrievalResult=z.object({
  kind:z.enum(['search','read']),topics:z.array(z.object({id}).strict()),query:z.string().optional(),results:z.array(TopicExcerpt),
  scanned:z.number().int().nonnegative(),scanLimited:z.boolean(),truncated:z.boolean(),
}).strict();
export type TopicRetrievalResult=z.infer<typeof TopicRetrievalResult>;
