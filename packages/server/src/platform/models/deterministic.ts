import { setTimeout as delay } from 'node:timers/promises';
import { ModelFailure, type ModelAdapter } from './adapter.ts';
import { modelContentText } from '@ash/shared';

export const deterministicModel: ModelAdapter = {
  configuration(mode, previous) {
    if (previous && previous.provider !== 'deterministic') throw new ModelFailure('provider_unavailable', 'Start an OpenAI session with the original model to retry this response.');
    return {provider:'deterministic',model:'ash-test-v1',options:{mode}};
  },
  async info() { return {provider:'deterministic',model:'ash-test-v1'}; },
  summaryConfiguration(previous) { return this.configuration('normal',previous); },
  async *stream(request, signal) {
    if (request.provider !== 'deterministic') throw new ModelFailure('provider_unavailable', 'This request requires OpenAI.');
    const { mode } = request.options;
    if (mode === 'fail-before') throw new ModelFailure('deterministic_failure', 'The test model failed before producing output.');
    if (mode === 'empty') return;
    if(request.purpose==='image_summary') {
      const content=request.messages.at(-1)?.content;
      const image=Array.isArray(content)?content.find(block=>block.type==='image'):undefined;
      yield `Deterministic test description: ${image?.type==='image'?`${image.image.width} × ${image.image.height}`:'uploaded'} image. No visual analysis or external model call was performed.`;
      return;
    }
    const inputs = request.messages.filter(message => message.role === 'user');
    const previous = request.messages.filter(message => message.role === 'assistant').length;
    const text = `Test response ${inputs.length}\n\nYou said: ${modelContentText(inputs.at(-1)!.content)}\n\nContext: ${inputs.length} user message${inputs.length === 1 ? '' : 's'} and ${previous} completed repl${previous === 1 ? 'y' : 'ies'}. This is a deterministic response; no model service was called.`;
    const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
    for (let index = 0; index < chunks.length; index++) {
      await delay(mode === 'slow' ? 300 : 35, undefined, {signal});
      if (mode === 'fail' && index === 2) throw new ModelFailure('deterministic_failure', 'The test model stopped after a partial response.');
      yield chunks[index];
    }
  },
};
