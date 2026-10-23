import {z} from 'zod';
import {VideoFile} from './attachments.ts';
import {ToolJson} from './tools.ts';

export const VIDEO_ANALYSIS_LIMITS={chunkSeconds:120,maxChunks:30,timeoutMs:900000,requestTimeoutMs:180000,
  maxOutputTokens:16384,toolSeconds:600,detailSeconds:30,contextCharacters:4000,resultCharacters:120000} as const;
const id=z.string().uuid();
export const VideoInterval=z.object({start:z.number().finite().nonnegative(),end:z.number().finite().nonnegative()}).strict()
  .refine(v=>v.end>v.start,'Choose a positive video interval.');
export const VideoTranscriptSegment=z.object({start:z.number().finite().nonnegative(),end:z.number().finite().nonnegative(),text:z.string().max(6000)}).strict();
export const VideoObservation=VideoTranscriptSegment.extend({evidence:z.enum(['visual','speech','both'])}).strict();
export const VideoAnalysisResult=z.object({caption:z.string().max(6000),answer:z.string().max(16000),actionItems:z.string().max(3000).optional(),
  transcript:z.array(VideoTranscriptSegment).max(4000),matches:z.array(VideoObservation).max(256),limitations:z.array(z.string().max(1000)).max(100)}).strict();
export type VideoAnalysisResult=z.infer<typeof VideoAnalysisResult>;
export const VideoSource=z.object({original:VideoFile,playback:VideoFile,durationSeconds:z.number().finite().positive(),
  hasAudio:z.boolean(),recorded:z.boolean(),incomplete:z.boolean()}).strict();
export const VideoPlan=z.object({type:z.literal('video_analysis'),attachmentId:id,operation:z.enum(['caption','describe','question']),
  provider:z.enum(['google','deterministic']),model:z.string().max(200),source:VideoSource,range:VideoInterval,
  fps:z.union([z.literal(1),z.literal(5)]),question:z.string().max(2000),
  context:z.object({summaryRunId:id,resultArtifactId:id,text:z.string().max(20000)}).strict().nullable(),
  instruction:z.object({id,key:z.string(),text:z.string().max(12000)}).strict(),
  limits:z.object({chunkSeconds:z.number().positive(),maxChunks:z.number().int().positive(),timeoutMs:z.number().int().positive(),
    requestTimeoutMs:z.number().int().positive(),maxOutputTokens:z.number().int().positive()}).strict(),
}).strict();
export type VideoPlan=z.infer<typeof VideoPlan>;
export const VideoModelRequest=z.object({type:z.literal('video_model_request'),attachmentId:id,provider:z.enum(['google','deterministic']),
  model:z.string().max(200),operation:z.enum(['caption','describe','question','combine-caption']),prompt:z.string().max(100000),
  responseSchema:z.record(z.string(), ToolJson),
  media:z.object({file:VideoFile,sourceOffset:z.number().nonnegative(),start:z.number().nonnegative(),end:z.number().positive(),
    fps:z.union([z.literal(1),z.literal(5)]),resolution:z.literal('high'),transform:z.enum(['playback','clip-v1'])}).strict().nullable(),
  options:z.object({api:z.literal('interactions'),store:z.literal(false),thinkingLevel:z.literal('low'),maxOutputTokens:z.number().int().positive(),
    timeoutMs:z.number().int().positive(),responseSchemaVersion:z.union([z.literal(1),z.literal(2)])}).strict(),
}).strict();
export type VideoModelRequest=z.infer<typeof VideoModelRequest>;
export const VideoModelResponse=z.object({type:z.literal('video_model_response'),requestId:id,result:VideoAnalysisResult.nullable(),visibleText:z.string().max(120000),
  execution:z.object({model:z.string().max(200),responseId:z.string().max(256).optional(),inputTokens:z.number().int().nonnegative().optional(),
    outputTokens:z.number().int().nonnegative().optional(),thoughtTokens:z.number().int().nonnegative().optional()}).strict(),
  fileCleanup:z.enum(['not-needed','deleted','expiry-fallback'])}).strict();
export type VideoModelResponse=z.infer<typeof VideoModelResponse>;
export const VideoUnderstanding=z.object({caption:z.string().max(6000),actionItems:z.string().max(3000).optional(),complete:z.boolean().default(true),transcript:z.array(VideoTranscriptSegment).max(4000),
  limitations:z.array(z.string().max(1000)).max(100),coverage:z.array(VideoInterval).max(30),timing:z.literal('estimated'),
  resultArtifactId:id,requestIds:z.array(id).max(31)}).strict();
export type VideoUnderstanding=z.infer<typeof VideoUnderstanding>;
export const VideoUnderstandingPayload=z.object({type:z.literal('video_understanding'),attachmentId:id,
  result:VideoAnalysisResult,coverage:z.array(VideoInterval).max(30),requestIds:z.array(id).max(31),timing:z.literal('estimated'),
  complete:z.boolean().default(true),cacheKey:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type VideoUnderstandingPayload=z.infer<typeof VideoUnderstandingPayload>;
export const DescribeVideo=z.object({attachmentId:id,startSeconds:z.number().finite().nonnegative().optional(),
  endSeconds:z.number().finite().positive().optional(),fps:z.union([z.literal(1),z.literal(5)]).default(1)}).strict();
export const AskVideo=DescribeVideo.extend({question:z.string().trim().min(1).max(2000)}).strict();
