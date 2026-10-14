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
    const userText=modelContentText(inputs.at(-1)!.content);
    if(request.tools?.resources.some(resource=>resource.kind==='topic') && ['topic.search','topic.read'].every(name=>request.tools!.definitions.some(tool=>tool.name===name)) && /topic|prior threads/i.test(userText)) {
      await delay(mode==='slow'?1000:80,undefined,{signal});
      const round=request.tools.previousOutputIds.length;
      if(round===0) {
        yield 'I’ll search the linked Topic threads for the requested text.';
        yield {kind:'output',calls:[{callId:'topic_search',name:'topic.search',arguments:JSON.stringify({query:userText.match(/["“]([^"”]+)["”]/)?.[1]??userText})}]};return;
      }
      const references=request.tools.results.filter(result=>result.outputId===request.tools!.previousOutputIds.at(-1)).flatMap(result=>result.result.references);
      const artifactId=references[0]?.location.artifactId;
      if(round===1&&typeof artifactId==='string') {
        yield 'I found a matching thread. I’ll read its saved excerpt.';
        yield {kind:'output',calls:[{callId:'topic_read',name:'topic.read',arguments:JSON.stringify({artifactId,offset:0})}]};return;
      }
      yield references.length ? `The captured evidence is in ${references.map(ref=>`[${ref.label}](ash-source:${ref.citationId??encodeURIComponent(ref.id)})`).join(' and ')}. This is a deterministic retrieval demonstration; no external model was called.` : 'No readable match was returned. Inspect the saved results for errors or omissions.';
      yield {kind:'output',calls:[]};return;
    }
    if (request.tools?.definitions.some(tool=>tool.name==='filesystem.read') && /where|implement|source|file|search|code/i.test(modelContentText(inputs.at(-1)!.content))) {
      await delay(mode==='slow'?1000:80,undefined,{signal});
      const root=request.tools.resources.find(resource=>resource.kind==='filesystem')?.id;
      const round=request.tools.previousOutputIds.length;
      const call=(name:string,args:unknown,index=0)=>({callId:`test_${round}_${index}`,name,arguments:JSON.stringify(args)});
      if(root&&round===0) {
        yield 'I’ll locate the source files and inspect the relevant implementation.';
        yield {kind:'output',calls:[call('filesystem.list',{path:root}),call('filesystem.glob',{path:root,pattern:'**/*.ts'},1)]};return;
      }
      if(root&&round===1) {
        const userText=modelContentText(inputs.at(-1)!.content);
        const query=/cancel/i.test(userText)?'cancel':userText.match(/["“]([^"”]+)["”]/)?.[1]??'function';
        yield 'I’m searching the current source contents.';
        yield {kind:'output',calls:[call('filesystem.search',{path:root,query,pattern:'**/*.ts'})]};return;
      }
      if(round===2) {
        const references=request.tools.results.at(-1)?.result.references??[];
        const distinct=references.filter((ref,index)=>references.findIndex(other=>other.location.path===ref.location.path)===index).slice(0,2);
        if(distinct.length) {
          yield 'I found matching source lines. I’ll read the surrounding code.';
          yield {kind:'output',calls:distinct.map((ref,index)=>call('filesystem.read',{path:ref.location.path,startLine:Math.max(1,Number(ref.location.startLine)-4),maxLines:35},index))};return;
        }
      }
      const lastOutput=request.tools.previousOutputIds.at(-1);
      const references=request.tools.results.filter(result=>result.outputId===lastOutput).flatMap(result=>result.result.references);
      yield references.length ? `The matching implementation is in ${references.map(ref=>`[${ref.label}](ash-source:${encodeURIComponent(ref.citationId ?? ref.id)})`).join(' and ')}.\n\nThese citations open the captured source excerpts. This is a deterministic tool demonstration; no external model was called.` : 'The bounded search did not find a readable match. Inspect the tool results for errors or omissions, or narrow the filename/query.';
      yield {kind:'output',calls:[]};return;
    }
    const text = `Test response ${inputs.length}\n\nYou said: ${modelContentText(inputs.at(-1)!.content)}\n\nContext: ${inputs.length} user message${inputs.length === 1 ? '' : 's'} and ${previous} completed repl${previous === 1 ? 'y' : 'ies'}. This is a deterministic response; no model service was called.`;
    const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
    for (let index = 0; index < chunks.length; index++) {
      await delay(mode === 'slow' ? 300 : 35, undefined, {signal});
      if (mode === 'fail' && index === 2) throw new ModelFailure('deterministic_failure', 'The test model stopped after a partial response.');
      yield chunks[index];
    }
  },
};
