import { z } from 'zod';

export const Uuid = z.string().uuid();
export const ModelMode = z.enum(['normal', 'slow', 'fail', 'fail-before', 'empty']);
export type ModelMode = z.infer<typeof ModelMode>;
export const CreateThread = z.object({ id: Uuid, title: z.string().trim().min(1).max(160) }).strict();
export const SendMessage = z.object({ requestKey: Uuid, text: z.string().trim().min(1).max(4000), mode: ModelMode.default('normal') }).strict();
export const RetryRun = z.object({ requestKey: Uuid, mode: ModelMode.default('normal') }).strict();
export const RunStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']);
export type RunStatus = z.infer<typeof RunStatus>;
export const ModelExecution = z.object({
  requestId: z.string().max(256).optional(), responseId: z.string().max(256).optional(), model: z.string().max(200).optional(),
  status: z.enum(['in_progress', 'completed', 'failed', 'incomplete']).optional(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(), cachedInputTokens: z.number().int().nonnegative(), reasoningTokens: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type ModelExecution = z.infer<typeof ModelExecution>;
export const RunState = z.object({ request_artifact_id: Uuid, response_artifact_id: Uuid.nullable(), model: ModelExecution.optional() }).strict();
export const RunError = z.object({ code: z.string(), message: z.string(), details: z.record(z.unknown()).optional() }).strict();
export const InputPayload = z.object({ type: z.literal('text_input'), text: z.string() }).strict();
export const MessagePayload = z.object({
  type: z.literal('message'), initial_thread_id: Uuid, speaker: z.enum(['user', 'ash']),
  content: z.array(z.object({ type: z.literal('text'), text: z.string() }).strict()),
}).strict();
export const OpenAIOptions = z.object({
  api: z.literal('responses'), store: z.literal(false), maxOutputTokens: z.number().int().min(16).max(16384),
  timeoutMs: z.number().int().min(1000).max(180000),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
}).strict();
const requestContent = {
  type: z.literal('model_request'),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }).strict()),
  selection: z.object({
    instructions: z.array(z.object({ id: Uuid, key: z.string(), messageIndex: z.number().int() }).strict()),
    artifacts: z.array(z.object({ id: Uuid, messageIndex: z.number().int() }).strict()),
    omitted: z.array(z.object({ id: Uuid, reason: z.enum(['not-completed', 'superseded', 'context-limit']) }).strict()),
    maxCharacters: z.number().int().positive(),
  }).strict(),
};
export const RequestPayload = z.discriminatedUnion('provider', [
  z.object({...requestContent, provider:z.literal('deterministic'), model:z.literal('ash-test-v1'), options:z.object({mode:ModelMode}).strict()}).strict(),
  z.object({...requestContent, provider:z.literal('openai'), model:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/), options:OpenAIOptions}).strict(),
]);
export type RequestPayload = z.infer<typeof RequestPayload>;
export type MessagePayload = z.infer<typeof MessagePayload>;
export type ArtifactPayload = z.infer<typeof InputPayload> | MessagePayload | RequestPayload;
export interface ThreadView { id: string; title: string; createdAt: string; updatedAt: string }
export interface ArtifactView {
  id: string; layer: string; sourceId: string | null; threadId: string | null; runId: string | null;
  actor: string; payload: ArtifactPayload; createdAt: string; updatedAt: string;
}
export interface RunView {
  id: string; requestKey: string; inputArtifactId: string; threadId: string; retryOfId: string | null;
  status: RunStatus; state: z.infer<typeof RunState>; error: z.infer<typeof RunError> | null;
  createdAt: string; startedAt: string | null; endedAt: string | null;
}
export interface ConversationView { thread: ThreadView; artifacts: ArtifactView[]; runs: RunView[] }
export interface InspectionView { selectedId: string; input: ArtifactView; artifacts: ArtifactView[]; runs: RunView[] }
export interface ModelInfo {
  provider: 'deterministic' | 'openai'; model: string;
  session?: { id: string; callsUsed: number; maxCalls: number; expiresAt: string };
}
export const isActive = (status: string) => status === 'queued' || status === 'running';
export const messageText = (payload: MessagePayload) => payload.content.map(block => block.text).join('');
