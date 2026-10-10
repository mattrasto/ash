export const providerResponse = (text = 'Hello from OpenAI.', status = 'completed') => ({
  id:'resp_test',model:'test-openai-model-2026-10-10',status,
  output:[{id:'msg_test',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}],
  usage:{input_tokens:24,output_tokens:8,total_tokens:32,input_tokens_details:{cached_tokens:4},output_tokens_details:{reasoning_tokens:2}},
});
export function sse(events: object[]) {
  return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{
    headers:{'content-type':'text/event-stream','x-request-id':'req_test'},
  });
}
export function successEvents(text = 'Hello from OpenAI.') {
  return [{type:'response.created',response:{...providerResponse('', 'in_progress'),usage:null}},
    {type:'response.output_text.delta',delta:text},
    {type:'response.completed',response:providerResponse(text)}];
}
