import type { ModelExecution, ModelInfo, ModelMode, RequestPayload } from '@ash/shared';

export class ModelFailure extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type ModelConfiguration = Pick<Extract<RequestPayload, {provider:'deterministic'}>, 'provider'|'model'|'options'>
  | Pick<Extract<RequestPayload, {provider:'openai'}>, 'provider'|'model'|'options'>;
export interface ModelAdapter {
  configuration(mode: ModelMode, previous?: RequestPayload): ModelConfiguration;
  info(): Promise<ModelInfo>;
  stream(request: RequestPayload, signal: AbortSignal): AsyncIterable<string | ModelExecution>;
}
