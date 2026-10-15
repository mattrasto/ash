<script lang="ts">
  import { modelContentText, type RequestPayload } from '@ash/shared';
  let {captured,onSource}:{captured:RequestPayload;onSource:(id:string)=>void}=$props();
  let copyStatus=$state('');
  const omitted=$derived(captured.selection.omissions ?? {history:captured.selection.omitted.filter(item=>item.reason==='context-limit').length,notCompleted:captured.selection.omitted.filter(item=>item.reason==='not-completed').length,superseded:captured.selection.omitted.filter(item=>item.reason==='superseded').length});
  async function copy() {try{await window.ashMedia.copyText(captured.messages.map(message=>`${message.role}:\n${modelContentText(message.content)}`).join('\n\n'));copyStatus='Copied';}catch{copyStatus='Could not copy context.';}}
</script>
<section aria-label="Captured context">
  <h3>Captured model request</h3><p>{captured.provider} / {captured.model}</p>
  <details open><summary>Instructions · {captured.selection.instructions.length}</summary>
    {#each captured.selection.instructions as item,index}<div class="item"><strong>{index+1}. {item.scope??'global'} · {item.name??item.key??'Instruction'}</strong><code>{item.id}</code><p>{modelContentText(captured.messages[item.messageIndex]?.content??'')}</p>{#if item.ownerId}<code>Owner: {item.ownerId}</code>{/if}</div>{/each}
  </details>
  {#if captured.selection.topics}<details><summary>Available Topics · {captured.selection.topics.length}</summary><p>Scope available for retrieval when this request was captured.</p>{#each captured.selection.topics as topic}<div class="topic"><strong>{topic.name}</strong><code>{topic.id}</code></div>{:else}<p>No cross-thread Topic retrieval.</p>{/each}</details>{/if}
  <details><summary>Context limits</summary><p>{captured.selection.maxCharacters.toLocaleString()} character limit</p><p>{omitted.history} history messages omitted · {omitted.notCompleted} incomplete answers · {omitted.superseded} superseded answers</p></details>
  <details open><summary>Model-visible messages · {captured.messages.length}</summary>
    {#each captured.messages as message,index}
      {@const instruction=captured.selection.instructions.find(item=>item.messageIndex===index)}
      {@const source=captured.selection.artifacts.find(item=>item.messageIndex===index)}
      <div class="item"><strong>{index+1}. {instruction?`${instruction.scope??'global'} instructions`:captured.selection.composition?.messageIndex===index?'Composition rules':message.role==='assistant'?'Ash history':message.role==='user'?(captured.purpose?.startsWith('engine_')?'Incoming evidence':modelContentText(message.content).startsWith('External source:')?'External source':'User history'):message.role}</strong><p>{modelContentText(message.content)}</p>
        {#if source}<button class="source" onclick={()=>onSource(source.id)}>Open source message</button><code>{source.id}</code>{/if}
        {#if Array.isArray(message.content)}{#each message.content as block}{#if block.type==='image'}<img class="captured-image" src={`/api/attachments/${block.attachmentId}/model`} alt={block.description}/><small>Pixels supplied · {block.image.width} × {block.image.height}</small><code>{block.image.hash}</code>{/if}{/each}{/if}
      </div>
    {/each}
  </details>
  <button class="source" onclick={copy}>Copy text-only context</button><span role="status">{copyStatus}</span>
  <details><summary>Captured identities and metadata</summary><pre>{JSON.stringify(captured.selection,null,2)}</pre></details>
  <details><summary>Generation options</summary><pre>{JSON.stringify(captured.options,null,2)}</pre></details>
</section>
<style>
  section{border-top:1px solid #dbe2d1;padding-top:18px;margin-top:20px;font-size:11px;color:#6a755f}h3{font-size:12px;font-weight:600;color:#596b4d;margin:0 0 10px}p{line-height:1.7}details{margin-top:14px}summary{cursor:pointer;color:#526649}.item{background:#f9faf5;border:1px solid #dfe6d5;border-radius:6px;padding:11px;margin:10px 0}.item strong{font-size:10px}.item p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}.topic{margin:12px 0}code{display:block;font-size:9px;overflow-wrap:anywhere;margin-top:7px;color:#8a957f}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:9px;line-height:1.6}.source{border:0;background:transparent;color:#58784b;font-size:10px;padding:8px 0;text-decoration:underline;text-underline-offset:3px}img{display:block;max-width:100%;max-height:190px;object-fit:contain;margin:10px auto}small{font-size:9px;color:#7b8a6d}span[role=status]{margin-left:10px;font-size:10px}
</style>
