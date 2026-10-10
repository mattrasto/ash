import { MessagePayload, RequestPayload, messageText } from '@ash/shared';
import type { Artifact, Instruction, Run } from '@prisma/client';

export const CONTEXT_CHARACTERS = 12000;
export function selectContext(artifacts: Artifact[], runs: Run[], instruction: Instruction, maxCharacters = CONTEXT_CHARACTERS): Pick<RequestPayload, 'messages' | 'selection'> {
  const ordered = [...artifacts].sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const byRun = new Map(runs.map(run => [run.id, run]));
  const completed = new Map<string, Run>();
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    const previous = completed.get(run.inputArtifactId);
    if (!previous || run.endedAt!.getTime() > previous.endedAt!.getTime() || (run.endedAt!.getTime() === previous.endedAt!.getTime() && run.id > previous.id)) completed.set(run.inputArtifactId, run);
  }
  const omitted: RequestPayload['selection']['omitted'] = [];
  const groups = new Map<string, Artifact[]>();
  for (const artifact of ordered) {
    const payload = MessagePayload.parse(artifact.payload);
    if (payload.speaker === 'user') groups.set(artifact.sourceId!, [artifact]);
  }
  for (const artifact of ordered) {
    const payload = MessagePayload.parse(artifact.payload);
    if (payload.speaker !== 'ash') continue;
    const run = byRun.get(artifact.runId!);
    if (!run || run.status !== 'completed') omitted.push({id:artifact.id, reason:'not-completed'});
    else if (completed.get(run.inputArtifactId)?.id !== run.id) omitted.push({id:artifact.id, reason:'superseded'});
    else groups.get(run.inputArtifactId)?.push(artifact);
  }
  const turns = [...groups.values()];
  let used = instruction.text.length;
  const selected = new Set<string>();
  for (let index = turns.length - 1; index >= 0; index--) {
    const group = turns[index];
    const size = group.reduce((n,a) => n + messageText(MessagePayload.parse(a.payload)).length, 0);
    if (used + size <= maxCharacters) { used += size; group.forEach(a => selected.add(a.id)); }
    else group.forEach(a => omitted.push({id:a.id, reason:'context-limit'}));
  }
  // The current input is bounded at acceptance; never silently omit it.
  if (turns.length && !selected.has(turns.at(-1)![0].id)) throw new Error('Current input and base instructions exceed the context limit');
  const messages: RequestPayload['messages'] = [{role:'system', content:instruction.text}];
  const sources: RequestPayload['selection']['artifacts'] = [];
  for (const artifact of ordered) {
    if (!selected.has(artifact.id)) continue;
    const payload = MessagePayload.parse(artifact.payload);
    sources.push({id:artifact.id, messageIndex:messages.length});
    messages.push({role:payload.speaker === 'user' ? 'user' : 'assistant', content:messageText(payload)});
  }
  return {messages, selection:{instructions:[{id:instruction.id, key:instruction.key!, messageIndex:0}], artifacts:sources, omitted, maxCharacters}};
}
