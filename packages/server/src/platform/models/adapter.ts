import type { ModelExecution, ModelInfo, ModelMode, RequestPayload, RequestImage, ToolCall } from '@ash/shared';

export class ModelFailure extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export interface ModelOutput {
  kind: 'output'; calls: ToolCall[];
  /** Backend-only replay material; never pass this event to public views or logging. */
  continuation?: unknown[];
}
export interface ModelReplay { outputs: Array<{ id: string; items: unknown[] }> }
export type ModelConfiguration = Pick<Extract<RequestPayload, {provider:'deterministic'}>, 'provider'|'model'|'options'>
  | Pick<Extract<RequestPayload, {provider:'openai'}>, 'provider'|'model'|'options'>;
export interface ModelAdapter {
  configuration(mode: ModelMode, previous?: RequestPayload): ModelConfiguration;
  summaryConfiguration(previous?: RequestPayload): ModelConfiguration;
  info(): Promise<ModelInfo>;
  stream(request: RequestPayload, signal: AbortSignal, imageUrl?: (image:RequestImage)=>Promise<string>, replay?: ModelReplay): AsyncIterable<string | ModelExecution | ModelOutput>;
}
