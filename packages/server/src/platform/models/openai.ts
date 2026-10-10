import OpenAI from 'openai';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { ModelExecution, RequestPayload, type ModelInfo } from '@ash/shared';
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
    info:settings.info,
    async *stream(request, signal) {
      if (request.provider !== 'openai') throw new ModelFailure('provider_unavailable', 'This request requires the deterministic model.');
      this.configuration('normal',request);
      signal.throwIfAborted();
      const remainingMs = await settings.reserve();
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(Math.max(1,Math.min(request.options.timeoutMs,settings.options.timeoutMs,remainingMs)));
      const abort = AbortSignal.any([signal,timeout]);
      let stream: Awaited<ReturnType<typeof client.responses.create>> | undefined;
      try {
        const result = await client.responses.create({
          model:request.model,input:request.messages,stream:true,store:request.options.store,
          max_output_tokens:request.options.maxOutputTokens,
          ...(request.options.reasoningEffort ? {reasoning:{effort:request.options.reasoningEffort}} : {}),
        },{signal:abort,maxRetries:0}).withResponse();
        stream = result.data;
        if (result.request_id) yield ModelExecution.parse({requestId:result.request_id});
        let text = '';
        for await (const event of result.data) {
          abort.throwIfAborted();
          if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
            text += event.delta;
            yield event.delta;
          } else if (event.type === 'response.created') {
            yield metadata(event.response);
          } else if (event.type === 'response.completed' || event.type === 'response.failed' || event.type === 'response.incomplete') {
            yield metadata(event.response);
            // Never treat truncated output, a lost stream, or an error as successful completion.
            if (event.type === 'response.failed') throw new ModelFailure('provider_failed', 'OpenAI failed to finish the response.');
            if (event.type === 'response.incomplete') throw new ModelFailure('provider_incomplete', 'OpenAI returned an incomplete response (output limit or content filtering).');
            if (event.response.status !== 'completed' || visibleText(event.response) !== text) throw new ModelFailure('provider_stream_incomplete', 'The response stream did not contain the complete saved reply.');
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
