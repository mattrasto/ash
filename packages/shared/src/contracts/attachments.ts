import { z } from 'zod';
import type { RunView } from './conversations.ts';

export const IMAGE_LIMITS = { perFile:10*1024*1024, perMessage:20*1024*1024, pixels:20_000_000,
  modelBytes:2*1024*1024, contextBytes:16*1024*1024, contextCount:8, historyTurns:6, draftLifetimeMs:24*60*60*1000 } as const;
export const ImageFile = z.object({hash:z.string().regex(/^[a-f0-9]{64}$/), mimeType:z.enum(['image/png','image/jpeg','image/webp']),
  sizeBytes:z.number().int().positive().max(IMAGE_LIMITS.perFile), width:z.number().int().positive(), height:z.number().int().positive()}).strict();
export type ImageFile = z.infer<typeof ImageFile>;
export const ImageMetadata = z.object({original:ImageFile, model:ImageFile, thumbnail:ImageFile,
  transform:z.literal('rotate-strip-webp-v1')}).strict();
export type ImageMetadata = z.infer<typeof ImageMetadata>;
export interface AttachmentView {
  id:string; filename:string; metadata:ImageMetadata; createdAt:string; expiresAt:string|null;
  inputArtifactId:string; summary:string|null; summaryRun:RunView|null;
}
export const ImageBlock = z.object({type:z.literal('image'),attachmentId:z.string().uuid()}).strict();
export const TextBlock = z.object({type:z.literal('text'),text:z.string()}).strict();
export const RequestImage = ImageBlock.extend({image:ImageFile,detail:z.enum(['auto','high','low']),description:z.string()}).strict();
export type RequestImage = z.infer<typeof RequestImage>;
export const ModelContent = z.union([z.string(),z.array(z.union([TextBlock,RequestImage]))]);
export type ModelContent = z.infer<typeof ModelContent>;
export const modelContentText = (content:ModelContent) => typeof content === 'string' ? content : content.map(block=>block.type==='text' ? block.text : block.description).join('\n');
export function imageDescription(attachment:Pick<AttachmentView,'id'|'filename'|'summary'>) {
  const summary=attachment.summary ? attachment.summary.slice(0,1000)+(attachment.summary.length>1000?' [description truncated]':'') : null;
  return `[Image: ${attachment.filename}] (attachmentId: ${attachment.id})\n${summary ? `Generated description (may omit details): ${summary}` : 'Description unavailable. Do not infer image contents from its filename.'}`;
}
