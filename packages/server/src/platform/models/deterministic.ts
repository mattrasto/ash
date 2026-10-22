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
    if(request.purpose?.startsWith('engine_')) {
      const packet=JSON.parse(String(request.messages.at(-1)!.content)),text=String(packet.input.text).toLowerCase();
      if(request.purpose==='engine_filter'){yield JSON.stringify({type:'filter_result',outcome:/spam|unsubscribe|promotion/.test(text)?'drop':'pass',reason:'Deterministic synthetic relevance assessment.'});return;}
      if(request.purpose==='engine_route'){
        const words=text.match(/[a-z0-9]{3,}/g)??[];
        const candidates=(packet.candidates as {id:string;title:string;excerpts:{text:string}[]}[]).map(c=>({...c,score:words.filter(w=>(c.title+' '+c.excerpts.map(e=>e.text).join(' ')).toLowerCase().includes(w)).length})).sort((a,b)=>b.score-a.score);
        const best=candidates[0],ambiguous=!!best&&best.score>0&&candidates[1]?.score===best.score;
        yield JSON.stringify({destination:best?.score?'existing':'new',threadId:best?.score?best.id:null,title:best?.score?best.title:String(packet.input.text).slice(0,70),reason:'Deterministic synthetic matching; no external model was called.',ambiguous,assumption:ambiguous?'Assumed the first equally matching continuing matter is the intended destination.':''});return;
      }
      const internal=/internal work/.test(text),silent=/no presentation/.test(text),respond=/respond|summari[sz]e|\?/.test(text);
      yield JSON.stringify({type:'act_plan',action:internal||respond,showSource:!internal&&!silent&&!/respond only/.test(text),showResponse:respond&&!internal,reason:'Deterministic synthetic action and presentation assessment.'});return;
    }
    if(request.purpose==='thread_visibility'){
      const packet=JSON.parse(String(request.messages.at(-1)!.content));
      const latest=packet.items.filter((item:any)=>item.payload.type==='message'&&item.payload.speaker==='user').at(-1);
      const text=latest?.payload.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join(' ')??'';
      yield JSON.stringify(/\bVIS_TEST_DUE\b/.test(text)?{kind:'until',deadline:new Date(Date.parse(packet.now)+10000).toISOString(),reason:'Synthetic ten-second archive target.'}:/\bVIS_TEST_DONE\b/.test(text)?{kind:'immediate',reason:'Synthetic completed matter.'}:{kind:'indefinite',reason:'Offline deterministic assessment keeps Threads visible.'});return;
    }
    if(request.purpose==='thread_naming'){
      const packet=JSON.parse(String(request.messages.at(-1)!.content));
      const first=packet.items.find((item:any)=>item.payload.type==='message'&&item.payload.speaker==='user');
      const text=first?.payload.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join(' ').replace(/\s+/g,' ').trim();
      const title=packet.title==='Untitled'?(text?Array.from(text).slice(0,79).join('')+(Array.from(text).length>79?'…':''):'Media Thread'):packet.title;
      yield JSON.stringify({title,reason:'Offline deterministic naming fixture; no external model was called.'});return;
    }
    if(request.purpose==='image_summary') {
      const content=request.messages.at(-1)?.content;
      const image=Array.isArray(content)?content.find(block=>block.type==='image'):undefined;
      yield `Deterministic test description: ${image?.type==='image'?`${image.image.width} × ${image.image.height}`:'uploaded'} image. No visual analysis or external model call was performed.`;
      return;
    }
    const inputs = request.messages.filter(message => message.role === 'user');
    const previous = request.messages.filter(message => message.role === 'assistant').length;
    const userText=modelContentText(inputs.at(-1)!.content);
    if(request.tools?.definitions.some(tool=>tool.name==='decisions.ask')&&/^ask me\b/i.test(userText)){
      if(!request.tools.previousOutputIds.length){yield {kind:'output',calls:[{callId:'ordinary_question',name:'decisions.ask',arguments:JSON.stringify({question:userText.replace(/^ask me\s*/i,'')||'Which folder should I use?',reason:'Your answer is needed to continue.'})}]};return;}
      yield `Saved answer: ${request.tools.results.at(-1)?.result.content.map(c=>c.type==='text'?c.text:'').join('')}.`;yield {kind:'output',calls:[]};return;
    }
    const ordinary=request.tools?.resources.filter(r=>r.kind==='decision')??[];
    if(ordinary.length===1&&request.tools?.definitions.some(tool=>tool.name==='decisions.answer')){
      const question=JSON.parse(ordinary[0].label);
      const option=question.options.find((o:{id:string;label:string})=>[o.id,o.label].some(v=>v.toLowerCase()===userText.trim().toLowerCase()));
      if((option||/^answer:\s*\S/i.test(userText))&&!request.tools.previousOutputIds.length){yield {kind:'output',calls:[{callId:'ordinary_answer',name:'decisions.answer',arguments:JSON.stringify({decisionId:ordinary[0].id,value:option?.id??userText.replace(/^answer:\s*/i,'')})}]};return;}
    }
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
