import { z } from 'zod';

export const ThreadMode = z.enum(['chat','adapt']);
export type ThreadMode = z.infer<typeof ThreadMode>;
export const SetThreadMode = z.object({mode:ThreadMode,expectedMode:ThreadMode}).strict();
export const AdaptProgress = z.object({
  workspaceId:z.string().uuid(),phase:z.enum(['preparing','coding','waiting','checkpointing','ready','failed','cancelled']),
  requestArtifactId:z.string().uuid().optional(),message:z.string().max(2000),checkpointId:z.string().uuid().optional(),
}).strict();
export type AdaptProgress = z.infer<typeof AdaptProgress>;
export const AdaptCheckpoint = z.object({
  id:z.string().uuid(),baseRevision:z.string().regex(/^[a-f0-9]{40,64}$/),tree:z.string().regex(/^[a-f0-9]{40,64}$/),
  patch:z.string().max(2*1024*1024),checks:z.string().max(32000),createdAt:z.string().datetime(),
}).strict();
export type AdaptCheckpoint = z.infer<typeof AdaptCheckpoint>;
export interface AdaptWorkspaceView {
  id:string;threadId:string;baseRevision:string;status:string;createdAt:string;updatedAt:string;
  checkpoint:AdaptCheckpoint|null;preview?:AdaptPreviewState;application?:AdaptApplicationView;
}
export interface AdaptInfo {
  available:boolean;label:string;reason?:string;
  applicationReason?:string;
  capabilities:{steering:boolean;prewarming:boolean;nativePreview:boolean;forceDestroy:boolean;localApply?:boolean};
}

export const AdaptPreviewCommand=z.object({action:z.enum(['run','stop','refresh']),submissionId:z.string().uuid()}).strict();
export type AdaptPreviewCommand=z.infer<typeof AdaptPreviewCommand>;
export interface AdaptPreviewState {
  phase:'stopped'|'preparing'|'running'|'failed';running?:boolean;checkpointId?:string;tree?:string;message:string;
}

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const AdaptPreparation=z.object({type:z.literal('adapt_preparation'),candidateId:z.string().uuid(),workspaceId:z.string().uuid(),checkpointId:z.string().uuid(),action:z.enum(['apply','restore'])}).strict();
export type AdaptPreparation=z.infer<typeof AdaptPreparation>;
export const AdaptCandidateEvidence=z.object({
  type:z.literal('adapt_candidate'),candidateId:z.string().uuid(),workspaceId:z.string().uuid(),checkpointId:z.string().uuid().nullable(),
  action:z.enum(['apply','restore']),targetVersion:z.string().max(160),versionId:z.string().uuid(),sourceTree:z.string(),
  buildDigest:digest,policy:z.literal('renderer-release-v1'),checks:z.string().max(16000),
}).strict();
export type AdaptCandidateEvidence=z.infer<typeof AdaptCandidateEvidence>;
export const AdaptApplicationEvidence=z.object({
  type:z.literal('adapt_application'),candidateId:z.string().uuid(),decisionId:z.string().uuid(),
  fromVersion:z.string(),toVersion:z.string(),outcome:z.enum(['applied','restored','rolled_back','failed','stale']),message:z.string().max(2000),
}).strict();
export type AdaptApplicationEvidence=z.infer<typeof AdaptApplicationEvidence>;
export const PrepareAdaptApplication=z.object({submissionId:z.string().uuid(),checkpointId:z.string().uuid(),action:z.enum(['apply','restore']).default('apply')}).strict();
export interface AdaptApplicationView {
  candidateId?:string;checkpointId?:string;action?:'apply'|'restore';decisionId?:string;evidence?:AdaptCandidateEvidence;
  phase:'idle'|'preparing'|'ready'|'awaiting_approval'|'applying'|'applied'|'restored'|'rolled_back'|'failed'|'stale'|'declined';
  message:string;installedVersion:string;canRestore:boolean;needsRefresh?:boolean;conflicts?:string[];
}

export const AdaptRefreshRequest=z.object({submissionId:z.string().uuid(),workspaceId:z.string().uuid(),version:z.string().max(160),checkpoint:AdaptCheckpoint,baseline:AdaptCheckpoint.optional()}).strict();
export type AdaptRefreshRequest=z.infer<typeof AdaptRefreshRequest>;
export const AdaptRefreshResult=z.object({version:z.string().max(160),checkpoint:AdaptCheckpoint,baseline:AdaptCheckpoint,conflicts:z.array(z.string().max(2048)).max(256)}).strict();
export type AdaptRefreshResult=z.infer<typeof AdaptRefreshResult>;
export const RefreshAdaptWorkspace=z.object({submissionId:z.string().uuid(),checkpointId:z.string().uuid(),version:z.string().max(160)}).strict();
