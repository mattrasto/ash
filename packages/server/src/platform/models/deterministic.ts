import { setTimeout as delay } from 'node:timers/promises';
import type { RequestPayload } from '@ash/shared';

export class ModelFailure extends Error { code = 'deterministic_failure'; }
export interface ModelAdapter { stream(request: RequestPayload, signal: AbortSignal): AsyncIterable<string> }
export const deterministicModel: ModelAdapter = {
  async *stream(request, signal) {
    const { mode } = request.options;
    if (mode === 'fail-before') throw new ModelFailure('The test model failed before producing output.');
    if (mode === 'empty') return;
    const inputs = request.messages.filter(message => message.role === 'user');
    const previous = request.messages.filter(message => message.role === 'assistant').length;
    const text = `Test response ${inputs.length}\n\nYou said: ${inputs.at(-1)!.content}\n\nContext: ${inputs.length} user message${inputs.length === 1 ? '' : 's'} and ${previous} completed repl${previous === 1 ? 'y' : 'ies'}. This is a deterministic response; no model service was called.`;
    const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
    for (let index = 0; index < chunks.length; index++) {
      await delay(mode === 'slow' ? 300 : 35, undefined, {signal});
      if (mode === 'fail' && index === 2) throw new ModelFailure('The test model stopped after a partial response.');
      yield chunks[index];
    }
  },
};
