<script lang="ts">
  import { TopicRetrievalResult, type ToolResult } from '@ash/shared';
  let {results,onSource}:{results:ToolResult[];onSource:(id:string)=>void}=$props();
  const captures=$derived(results.flatMap(result=>result.content.flatMap(block=>{
    if(block.type!=='data')return [];
    const parsed=TopicRetrievalResult.safeParse(block.value);
    return parsed.success?[{value:parsed.data,omissions:result.omissions}]:[];
  })));
</script>
{#if captures.length}
  <section aria-label="Retrieved Topic context">
    <h3>Retrieved Topic context</h3>
    {#each captures as capture,index}
      <details open>
        <summary>{index+1}. {capture.value.kind==='search'?'Keyword search':'Read excerpt'}{capture.value.query?` · ${capture.value.query}`:''}</summary>
        <p>{capture.value.topics.length} Topics in scope · {capture.value.scanned} messages examined</p>
        {#if capture.value.scanLimited}<p class="limit">Only the newest 200 eligible messages were searched.</p>{/if}
        {#if capture.value.truncated}<p class="limit">Partial results or shortened excerpts.</p>{/if}
        {#each capture.value.results as source}
          <article>
            <strong>{source.threadTitle} · {source.speaker==='ash'?'Ash':source.speaker==='source'?source.sourceLabel??'External source':'You'}</strong>
            <p class="excerpt">{source.text}</p>
            <small>Characters {source.offset.toLocaleString()}–{(source.offset+source.text.length).toLocaleString()} of {source.totalCharacters.toLocaleString()}{source.truncated?' · Excerpt':''}</small>
            {#each source.images as image}<p class="image">Image {image.id}<br>{image.descriptionAvailable?'Saved description; pixels not supplied':'Description unavailable; pixels not supplied'}{image.summaryRunId?` · Description Run ${image.summaryRunId}`:''}</p>{/each}
            <button onclick={()=>onSource(source.artifactId)}>Open original message</button><code>{source.artifactId}</code>
          </article>
        {:else}<p>{capture.value.scanLimited?'No matches in the searched range.':'No excerpts returned.'}</p>{/each}
        {#each capture.omissions.filter(text=>text==='Serialized result byte limit reached.') as omission}<p class="limit">{omission}</p>{/each}
        <details><summary>Topic identities</summary>{#each capture.value.topics as topic}<code>{topic.id}</code>{/each}</details>
      </details>
    {/each}
  </section>
{/if}
<style>
  section{border-top:1px solid #dbe2d1;padding-top:18px;margin-top:20px;font-size:11px;color:#6a755f}h3{font-size:12px;font-weight:600;color:#596b4d;margin:0 0 10px}details{margin-top:14px}summary{cursor:pointer;color:#526649}p{line-height:1.7}article{background:#f9faf5;border:1px solid #dfe6d5;border-radius:6px;padding:11px;margin:10px 0}strong{font-size:10px}.excerpt{white-space:pre-wrap;overflow-wrap:anywhere}.limit,small{color:#867044;font-size:10px}.image{font-size:9px;overflow-wrap:anywhere}button{border:0;background:transparent;color:#58784b;font-size:10px;padding:8px 0;text-decoration:underline;text-underline-offset:3px}code{display:block;font-size:9px;overflow-wrap:anywhere;margin-top:7px;color:#8a957f}
</style>
