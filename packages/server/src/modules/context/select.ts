import { MessagePayload, RequestPayload, modelContentText, imageDescription, IMAGE_LIMITS, type AttachmentView, type ModelContent } from '@ash/shared';
import type { Artifact, Instruction, Run } from '@prisma/client';

export const CONTEXT_CHARACTERS = 12000;
export function selectContext(artifacts: Artifact[], runs: Run[], instruction: Instruction, maxCharacters = CONTEXT_CHARACTERS, attachments:AttachmentView[]=[], supportsImages=true): Pick<RequestPayload, 'messages' | 'selection'> {
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
  const contents=new Map<string,ModelContent>(),assets=new Map(attachments.map(a=>[a.id,a]));
  const images:NonNullable<RequestPayload['selection']['images']>=[];
  let imageCount=0,imageBytes=0;
  for (let index = turns.length - 1; index >= 0; index--) {
    const group = turns[index];
    let nextCount=imageCount,nextBytes=imageBytes;
    const nextImages:typeof images=[];
    for(const artifact of group) {
      const payload=MessagePayload.parse(artifact.payload);
      if(!payload.content.some(block=>block.type==='image')){contents.set(artifact.id,payload.content.flatMap(block=>block.type==='text'?[block.text]:[]).join(''));continue;}
      const content:Exclude<ModelContent,string>=[];
      for(const block of payload.content) {
        if(block.type==='text'){content.push(block);continue;}
        const asset=assets.get(block.attachmentId);
        if(!asset)throw new Error('A saved image reference is unavailable.');
        const recent=turns.length-1-index<IMAGE_LIMITS.historyTurns;
        const fits=nextCount<IMAGE_LIMITS.contextCount && nextBytes+asset.metadata.model.sizeBytes<=IMAGE_LIMITS.contextBytes;
        const inline=supportsImages && recent && fits;
        const description=imageDescription(asset);
        if(inline){content.push({...block,image:asset.metadata.model,detail:'high',description});nextCount++;nextBytes+=asset.metadata.model.sizeBytes;}
        else content.push({type:'text',text:description+'\n[Pixels not included. Use the image again for visual details.]'});
        nextImages.push({id:asset.id,artifactId:artifact.id,representation:inline?'image':'description',reason:!supportsImages?'text-only':!recent?'history-window':!fits?'image-budget':'recent',summaryRunId:asset.summary?asset.summaryRun?.id??null:null});
        if(index===turns.length-1 && supportsImages && !inline)throw new Error('The current message exceeds the image context budget.');
      }
      contents.set(artifact.id,content);
    }
    const size = group.reduce((n,a) => n + modelContentText(contents.get(a.id)!).length, 0);
    if (used + size <= maxCharacters) { used += size; group.forEach(a => selected.add(a.id));imageCount=nextCount;imageBytes=nextBytes;images.push(...nextImages); }
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
    messages.push({role:payload.speaker === 'user' ? 'user' : 'assistant', content:contents.get(artifact.id)!});
  }
  return {messages, selection:{instructions:[{id:instruction.id, key:instruction.key!, messageIndex:0}], artifacts:sources, omitted, maxCharacters,...(images.length?{images}:{})}};
}
