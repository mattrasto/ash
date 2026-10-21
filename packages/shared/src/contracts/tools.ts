import { z } from 'zod';

// Provider-neutral, JSON-only records. Opaque provider continuation never belongs here.
export type ToolJson = null | boolean | number | string | ToolJson[] | { [key: string]: ToolJson };
export const ToolJson: z.ZodType<ToolJson> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(ToolJson), z.record(ToolJson),
]));
export const ToolResource = z.object({
  kind: z.string().min(1).max(80), id: z.string().min(1).max(4096), label: z.string().max(4096),
}).strict();
export type ToolResource = z.infer<typeof ToolResource>;
export const ToolAvailabilityIssue = z.object({
  code: z.string().min(1).max(100), message: z.string().min(1).max(1000),
}).strict();
export type ToolAvailabilityIssue = z.infer<typeof ToolAvailabilityIssue>;
export const ToolDefinition = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/), version: z.number().int().positive(),
  description: z.string().min(1).max(8000), inputSchema: z.record(ToolJson),
  effects: z.array(z.string().min(1).max(80)).max(32),
  concurrency: z.enum(['independent', 'exclusive']), repeatability: z.enum(['safe', 'reconcile']),
  limits: z.object({ timeoutMs: z.number().int().positive(), resultBytes: z.number().int().min(512) }).strict(),
}).strict();
export type ToolDefinition = z.infer<typeof ToolDefinition>;
export const ToolAction = z.object({
  operation: z.string().min(1).max(100), resources: z.array(ToolResource).max(256),
  effects: z.array(z.string().min(1).max(80)).max(32),
  facts: z.record(ToolJson).optional(),
}).strict();
export type ToolAction = z.infer<typeof ToolAction>;
export const ToolAuthorization = z.object({
  outcome: z.enum(['allowed', 'denied']), code: z.string().max(100), message: z.string().max(1000),
  configurationRevision: z.string().max(256), evaluator: z.literal('not-performed'),
  resourceAccess:z.enum(['established','capability-only']).optional(),
}).strict();
export type ToolAuthorization = z.infer<typeof ToolAuthorization>;
export const ToolCitationId = z.string().max(100).regex(/^cite:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9][0-9]*$/);
export const ToolReference = z.object({
  kind: z.string().min(1).max(80), id: z.string().min(1).max(4096), label: z.string().max(4096),
  citationId: ToolCitationId.optional(),
  observedAt: z.string().datetime(), contentHash: z.string().max(256).optional(),
  // Each resource kind owns its location shape (e.g. file/lines or Artifact/offset).
  location: z.record(ToolJson),
}).strict();
export type ToolReference = z.infer<typeof ToolReference>;
export const ToolContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('data'), value: ToolJson }).strict(),
  z.object({ type: z.literal('attachment'), attachmentId: z.string().uuid(), label: z.string().max(1000) }).strict(),
]);
const resultBody = {
  content: z.array(ToolContent), references: z.array(ToolReference), omissions: z.array(z.string().max(1000)),
};
export const ToolResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), ...resultBody }).strict(),
  z.object({ status: z.literal('error'), ...resultBody,
    error: z.object({ code: z.string().max(100), message: z.string().max(1000), retryable: z.boolean(), effect:z.enum(['none','unknown']).optional() }).strict(),
  }).strict(),
  z.object({ status: z.literal('denied'), ...resultBody,
    error: z.object({ code: z.string().max(100), message: z.string().max(1000), retryable: z.literal(false) }).strict(),
  }).strict(),
]);
export type ToolResult = z.infer<typeof ToolResult>;
export const ToolCall = z.object({
  callId: z.string().min(1).max(256), name: z.string().min(1).max(256), arguments: z.string().max(32768),
}).strict();
export type ToolCall = z.infer<typeof ToolCall>;
export const ToolLimits = z.object({
  modelCalls: z.number().int().positive(), toolCalls: z.number().int().positive(),
  concurrency: z.number().int().positive(), consecutiveErrors: z.number().int().positive(),
  repeats: z.number().int().positive(), resultBytes: z.number().int().min(512),
  totalResultBytes: z.number().int().min(512), continuationBytes: z.number().int().min(512),
  argumentDepth: z.number().int().min(1).max(64).optional(),
}).strict();
export type ToolLimits = z.infer<typeof ToolLimits>;
export const DEFAULT_TOOL_ARGUMENT_DEPTH = 64;
export const DEFAULT_TOOL_LIMITS: Readonly<ToolLimits> = Object.freeze({
  modelCalls: 8, toolCalls: 12, concurrency: 4, consecutiveErrors: 3, repeats: 3,
  resultBytes: 32768, totalResultBytes: 131072, continuationBytes: 1048576, argumentDepth: DEFAULT_TOOL_ARGUMENT_DEPTH,
});

const ToolId = z.string().uuid();
export const ToolCallState = z.object({
  id: ToolId, requestId: ToolId, callArtifactId: ToolId, call: ToolCall,
  status: z.enum(['queued', 'preparing', 'waiting', 'running', 'completed', 'error', 'denied', 'not-started', 'cancelled', 'interrupted', 'unknown']),
  decisionId: ToolId.optional(),
  action: ToolAction.optional(), authorization: ToolAuthorization.optional(),
  checks: z.array(z.object({ action: ToolAction, authorization: ToolAuthorization }).strict()).max(512).optional(),
  resultArtifactId: ToolId.optional(), startedAt: z.string().datetime().optional(), endedAt: z.string().datetime().optional(),
  referenceIds: z.array(z.string()).optional(),
  citationIds: z.array(ToolCitationId).optional(),
  reservedBytes: z.number().int().nonnegative().optional(),
}).strict();
export type ToolCallState = z.infer<typeof ToolCallState>;
export const ToolRound = z.object({
  requestId: ToolId, outputId: ToolId.optional(), status: z.enum(['queued', 'running', 'completed', 'interrupted']),
  commentary: z.string(), startedAt: z.string().datetime().optional(), endedAt: z.string().datetime().optional(),
  model: z.record(ToolJson).optional(),
}).strict();
export const ToolWorkflow = z.object({
  version: z.literal(1), checkpoint: z.number().int().nonnegative(), rounds: z.array(ToolRound), calls: z.array(ToolCallState),
  availabilityIssues: z.array(ToolAvailabilityIssue).max(64).optional(),
  resultBytes: z.number().int().nonnegative(), consecutiveErrors: z.number().int().nonnegative(),
  reservedResultBytes: z.number().int().nonnegative().default(0),
}).strict();
export type ToolWorkflow = z.infer<typeof ToolWorkflow>;
export const ToolRequest = z.object({
  definitions: z.array(ToolDefinition), resources: z.array(ToolResource), limits: ToolLimits,
  availabilityIssues: z.array(ToolAvailabilityIssue).max(64).optional(),
  instructions: z.string().max(16000),
  // Public continuation projection. Private provider items are referenced by output IDs.
  previousOutputIds: z.array(ToolId), results: z.array(z.object({ outputId: ToolId, callId: z.string(), artifactId: ToolId, result: ToolResult }).strict()),
}).strict();
export const ToolArtifact = z.discriminatedUnion('type', [
  z.object({ type: z.literal('model_output'), requestId: ToolId, commentary: z.string(), calls: z.array(ToolCall),
    continuation: z.object({ hash: z.string(), bytes: z.number().int().nonnegative() }).strict().optional(),
  }).strict(),
  z.object({ type: z.literal('tool_call'), requestId: ToolId, call: ToolCall }).strict(),
  z.object({ type: z.literal('tool_result'), callArtifactId: ToolId, result: ToolResult }).strict(),
]);
export type ToolArtifact = z.infer<typeof ToolArtifact>;
