import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { IncomingPayload, RunState, type ToolJson } from '@ash/shared';

/** Adapts feature evidence to the existing Run transaction and Artifact ownership boundary. */
export function toolEvidenceHost(db: PrismaClient) {
  async function scope(context: { runId: string; threadId: string; callId: string; signal: AbortSignal }, tx: Prisma.TransactionClient = db) {
    context.signal.throwIfAborted();
    const run = await tx.run.findUniqueOrThrow({ where: { id: context.runId } });
    const call = RunState.parse(run.state).tools?.calls.find(call => call.id === context.callId);
    if (run.threadId !== context.threadId || run.status !== 'running' || !call || !['preparing', 'running'].includes(call.status)) throw new Error('Feature execution is outside its active Run.');
    const input = await tx.artifact.findUniqueOrThrow({ where: { id: run.inputArtifactId } });
    const parsed = IncomingPayload.safeParse(input.payload);
    return { inputId: input.id, callArtifactId: call.callArtifactId, event: parsed.success ? parsed.data.event : undefined };
  }
  return { scope,
    async capture(context: { runId: string; threadId: string; callId: string; signal: AbortSignal }, sourceId: string, payload: { type: string; stage: string; data: ToolJson }) {
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM runs WHERE id=${context.runId}::uuid FOR UPDATE`;
        await scope(context, tx);
        const source = await tx.artifact.findUniqueOrThrow({ where: { id: sourceId } });
        if (source.runId !== context.runId || source.threadId !== context.threadId) throw new Error('Feature evidence must have one immediate source in its Run.');
        const now = new Date(), id = randomUUID();
        context.signal.throwIfAborted();
        await tx.artifact.create({ data: { id, layer: 'act', actor: 'ash', runId: context.runId, threadId: context.threadId, sourceId,
          payload: payload as Prisma.InputJsonValue, createdAt: now, updatedAt: now } });
        return id;
      });
    },
  };
}
