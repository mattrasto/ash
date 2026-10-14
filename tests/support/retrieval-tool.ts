import type { ToolResult } from '../../packages/shared/src/index.ts';
import { registerTool, type ToolContext } from '../../packages/server/src/modules/tools/contract.ts';

/** A service adapter example for non-filesystem retrieval; also used by dispatcher tests. */
export function retrievalTool(searchForRun: (runId: string, query: string, signal: AbortSignal) => Promise<ToolResult>) {
  return registerTool({
    definition: {
      name: 'fixture.search', version: 1, description: 'Search captured, authorized fixture context.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
      effects: ['read'], concurrency: 'independent', repeatability: 'safe', limits: { timeoutMs: 5000, resultBytes: 32768 },
    },
    parse(input): { query: string } {
      if (!input || typeof input !== 'object' || Object.keys(input).join() !== 'query' ||
        !('query' in input) || typeof input.query !== 'string' || !input.query.length || input.query.length > 256)
        throw new TypeError('Expected a bounded query string.');
      return { query: input.query };
    },
    async prepare(args, context) {
      return { args, action: { operation: 'fixture.search', effects: ['read'],
        resources: [{ kind: 'fixture', id: context.runId, label: 'Captured retrieval scope' }] } };
    },
    execute: (prepared, context: ToolContext) => searchForRun(context.runId, prepared.args.query, context.signal),
  });
}
