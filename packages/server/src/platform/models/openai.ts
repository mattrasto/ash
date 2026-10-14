import OpenAI from 'openai';
import type { Response as OpenAIResponse, ResponseInput, ResponseInputContent } from 'openai/resources/responses/responses';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import { ModelExecution, RequestPayload, ToolCall, type ModelInfo } from '@ash/shared';
import { ModelFailure, type ModelAdapter } from './adapter.ts';

export type OpenAIRequest = Extract<RequestPayload, {provider:'openai'}>;
export interface OpenAIModelSettings {
  apiKey: string; model: string; options: OpenAIRequest['options'];
  // Reservation is durable before dispatch. A failed or ambiguous call consumes a slot.
  reserve: () => Promise<number>;
  info: () => Promise<ModelInfo>;
}
function metadata(response: OpenAIResponse): ModelExecution {
  const usage = response.usage;
  return ModelExecution.parse({responseId:response.id,model:response.model,status:response.status,
    ...(usage ? {usage:{inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,totalTokens:usage.total_tokens,
      cachedInputTokens:usage.input_tokens_details?.cached_tokens ?? 0,reasoningTokens:usage.output_tokens_details?.reasoning_tokens ?? 0}} : {})});
}
function visibleText(response: OpenAIResponse) {
  return response.output.flatMap(item => item.type === 'message' ? item.content.flatMap(part =>
    part.type === 'output_text' ? [part.text] : part.type === 'refusal' ? [part.refusal] : []) : []).join('');
}
function failure(error: unknown): ModelFailure {
  if (error instanceof ModelFailure) return error;
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) return new ModelFailure('provider_auth', 'OpenAI rejected the credential or model access. Check the backend configuration.');
    if (error.status === 429) return new ModelFailure('provider_rate_limit', 'OpenAI rate or quota limit reached. Retry later.');
    if (error.status === 400 || error.status === 404 || error.status === 422) return new ModelFailure('provider_request', 'OpenAI rejected the selected model or request settings.');
  }
  return new ModelFailure('provider_failed', 'The OpenAI response could not be completed. Retry explicitly to try again.');
}

// The injected fetch is for protocol tests; live configuration always uses api.openai.com.
export function openAIModel(settings: OpenAIModelSettings, testFetch?: typeof fetch): ModelAdapter {
  const client = new OpenAI({apiKey:settings.apiKey,baseURL:'https://api.openai.com/v1',maxRetries:0,
    logLevel:'off',...(testFetch ? {fetch:testFetch} : {})});
  return {
    configuration(mode, previous) {
      if (mode !== 'normal') throw new ModelFailure('test_mode_unavailable', 'Test response behavior is only available with the deterministic model.');
      if (previous) {
        if (previous.provider !== 'openai' || previous.model !== settings.model ||
          previous.options.maxOutputTokens > settings.options.maxOutputTokens) {
          throw new ModelFailure('provider_unavailable', 'Retry requires a session with the original provider/model and a sufficient output limit.');
        }
        return {provider:previous.provider,model:previous.model,options:previous.options};
      }
      return {provider:'openai',model:settings.model,options:settings.options};
    },
    summaryConfiguration(previous) {
      const configuration={provider:'openai' as const,model:'gpt-6-luna',options:{api:'responses' as const,store:false as const,maxOutputTokens:256,timeoutMs:20000,reasoningEffort:'none' as const}};
      if(previous && (previous.provider!=='openai' || previous.model!==configuration.model || previous.purpose!=='image_summary'))
        throw new ModelFailure('provider_unavailable','Description retry requires its original provider and model.');
      return previous ? {provider:previous.provider as 'openai',model:previous.model,options:(previous as OpenAIRequest).options} : configuration;
    },
    info:settings.info,
    async *stream(request, signal, imageUrl, replay) {
      if (request.provider !== 'openai') throw new ModelFailure('provider_unavailable', 'This request requires the deterministic model.');
      if(request.purpose==='image_summary')this.summaryConfiguration(request);else this.configuration('normal',request);
      signal.throwIfAborted();
      // Resolve/verify every frozen image before consuming a paid-call slot.
      const input:ResponseInput=await Promise.all(request.messages.map(async message=>{
        if(typeof message.content==='string')return {role:message.role,content:message.content};
        const content:ResponseInputContent[]=[];
        for(const block of message.content) {
          if(block.type==='text')content.push({type:'input_text',text:block.text});
          else {
            if(!imageUrl)throw new ModelFailure('image_unavailable','Saved image storage is unavailable.');
            content.push({type:'input_text',text:block.description},{type:'input_image',image_url:await imageUrl(block),detail:block.detail});
          }
        }
        return {role:message.role,content};
      }));
      const definitions = request.tools?.definitions ?? [];
      if (request.tools) {
        input.push({role:'system',content:request.tools.instructions});
        for (const id of request.tools.previousOutputIds) {
          const saved = replay?.outputs.find(output => output.id === id);
          if (!saved || saved.items.some(item => !item || typeof item !== 'object' || !['message','reasoning','function_call'].includes(String((item as {type?:string}).type))))
            throw new ModelFailure('provider_continuation', 'Required provider continuation is unavailable or unsupported.');
          input.push(...toResponseInputItems(saved.items as OpenAIResponse['output']));
          for (const item of request.tools.results.filter(result => result.outputId === id))
            input.push({type:'function_call_output',call_id:item.callId,output:JSON.stringify(item.result)});
        }
      }
      signal.throwIfAborted();
      const remainingMs = await settings.reserve();
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(Math.max(1,Math.min(request.options.timeoutMs,settings.options.timeoutMs,remainingMs)));
      const abort = AbortSignal.any([signal,timeout]);
      let stream: Awaited<ReturnType<typeof client.responses.create>> | undefined;
      try {
        const result = await client.responses.create({
          model:request.model,input,stream:true,store:request.options.store,
          max_output_tokens:request.options.maxOutputTokens,
          ...(request.tools ? {tools:definitions.map((definition,index)=>({type:'function' as const,name:`ash_${index}`,description:definition.description,parameters:definition.inputSchema,strict:true})),parallel_tool_calls:true,include:['reasoning.encrypted_content' as const]} : {}),
          ...(request.options.reasoningEffort ? {reasoning:{effort:request.options.reasoningEffort}} : {}),
        },{signal:abort,maxRetries:0}).withResponse();
        stream = result.data;
        if (result.request_id) yield ModelExecution.parse({requestId:result.request_id});
        let text = '';
        const argumentStreams = new Map<string,string>();
        for await (const event of result.data) {
          abort.throwIfAborted();
          if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
            text += event.delta;
            yield event.delta;
          } else if (event.type === 'response.function_call_arguments.delta') {
            const value = (argumentStreams.get(event.item_id) ?? '') + event.delta;
            if (value.length > 32768) throw new ModelFailure('provider_call_limit','A proposed tool call exceeded the argument limit.');
            argumentStreams.set(event.item_id,value);
          } else if (event.type === 'response.created') {
            yield metadata(event.response);
          } else if (event.type === 'response.completed' || event.type === 'response.failed' || event.type === 'response.incomplete') {
            yield metadata(event.response);
            // Never treat truncated output, a lost stream, or an error as successful completion.
            if (event.type === 'response.failed') throw new ModelFailure('provider_failed', 'OpenAI failed to finish the response.');
            if (event.type === 'response.incomplete') throw new ModelFailure('provider_incomplete', 'OpenAI returned an incomplete response (output limit or content filtering).');
            if (event.response.status !== 'completed' || visibleText(event.response) !== text) throw new ModelFailure('provider_stream_incomplete', 'The response stream did not contain the complete saved reply.');
            if (request.tools) {
              if (event.response.output.some(item=>!['message','reasoning','function_call'].includes(item.type)))
                throw new ModelFailure('provider_continuation','The provider returned an unsupported continuation item.');
              const calls = event.response.output.filter(item=>item.type==='function_call').map(item=>{
                if ((item.status && item.status!=='completed') || (argumentStreams.has(item.id!) && argumentStreams.get(item.id!)!==item.arguments))
                  throw new ModelFailure('provider_stream_incomplete','Tool arguments did not match the completed response.');
                const index = /^ash_(\d+)$/.exec(item.name)?.[1];
                return ToolCall.parse({callId:item.call_id,name:index!==undefined?definitions[Number(index)]?.name??item.name:item.name,arguments:item.arguments});
              });
              if (new Set(calls.map(call=>call.callId)).size!==calls.length) throw new ModelFailure('provider_protocol','The provider repeated a call identity in one response.');
              // Reasoning summary/content and encrypted payloads stay exclusively in private replay storage.
              if (calls.length && event.response.output.some(item=>item.type==='reasoning'&&!item.encrypted_content))
                throw new ModelFailure('provider_continuation','The provider omitted required encrypted continuation.');
              yield {kind:'output',calls,continuation:event.response.output};
            }
            return;
          } else if (event.type === 'error') {
            throw new ModelFailure('provider_failed', 'OpenAI reported a streaming error.');
          }
        }
        throw new ModelFailure('provider_stream_incomplete', 'The OpenAI connection ended before completion.');
      } catch (error) {
        if (signal.aborted) throw new ModelFailure('provider_aborted', 'The response was stopped.');
        if (timeout.aborted) throw new ModelFailure('provider_timeout', 'The OpenAI response exceeded the request or session time limit.');
        if (error instanceof OpenAI.APIError && error.requestID) yield ModelExecution.parse({requestId:error.requestID});
        throw failure(error);
      } finally {
        // Returning early after cancellation/persistence failure also stops reading provider output.
        if (stream && 'controller' in stream) stream.controller.abort();
      }
    },
  };
}
