import { deterministicModel } from './deterministic.ts';
import type { ModelAdapter } from './adapter.ts';

// The server admits this profile only for disposable tests without a live model session.
export function deterministicForTiming(accelerated: boolean): ModelAdapter {
  if (!accelerated) return deterministicModel;
  return { ...deterministicModel, async *stream(request, signal) {
    for await (const output of deterministicModel.stream(request, signal)) {
      if (request.purpose === 'thread_visibility' && typeof output === 'string') {
        const choice = JSON.parse(output);
        if (choice.kind === 'until') choice.deadline = new Date(Date.now() + 1000).toISOString();
        yield JSON.stringify(choice);
      } else yield output;
    }
  } };
}
