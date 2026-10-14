import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../packages/client/src/renderer/features/threads/markdown.ts';
import { citationResult, parseSourceCitation } from '../../packages/client/src/renderer/features/threads/citations.ts';
test('Markdown renders useful structure without active HTML, unsafe links or remote image fetches',()=>{
  const rendered=renderMarkdown('# Heading\n\n- One\n- Two\n\n```ts\nconst x = "<script>";\n```\n\n<script>alert(1)</script>\n\n![secret](https://example.com/pixel.png)\n\n[bad](javascript:alert%281%29) [good](https://example.com)');
  assert.match(rendered,/<h1>Heading<\/h1>/);assert.match(rendered,/<ul>/);assert.match(rendered,/data-copy-code/);
  assert.ok(!rendered.includes('<script>'));assert.ok(!rendered.includes('<img'));assert.ok(!rendered.includes('href="javascript:'));
  assert.match(rendered,/href="https:\/\/example.com\/"/);assert.match(rendered,/&lt;script&gt;/);
});
test('Source citations preserve opaque IDs and resolve only unambiguous captured results',()=>{
  for(const id of ['artifact/offset/1', 'source '.repeat(70)+'雪/100%', 'x'.repeat(4096), 'artifact/"<script>alert(1)</script>']) {
    const href=`ash-source:${encodeURIComponent(id)}`,rendered=renderMarkdown(`[Evidence](${href})`);
    assert.equal(parseSourceCitation(href),id);
    assert.match(rendered,/data-source-reference=/);assert.ok(!rendered.includes('<script>'));
  }
  assert.equal(parseSourceCitation('ash-source:'),undefined);
  assert.equal(parseSourceCitation('ash-source:%ZZ'),undefined);
  assert.equal(parseSourceCitation('ash-source:'+'x'.repeat(4097)),undefined);
  assert.equal(parseSourceCitation('https://example.com'),undefined);
  const first='cite:11111111-1111-1111-1111-111111111111:1',second='cite:22222222-2222-2222-2222-222222222222:1';
  const calls=[{resultArtifactId:'first',referenceIds:['same'],citationIds:[first]},{resultArtifactId:'second',referenceIds:['same'],citationIds:[second]}];
  assert.equal(citationResult(calls,second),'second');assert.equal(citationResult(calls,first),'first');
  assert.equal(citationResult(calls,'same'),undefined);assert.equal(citationResult(calls,'invented'),undefined);
  assert.equal(citationResult([{resultArtifactId:'legacy',referenceIds:['old/source']}],'old/source'),'legacy');
});
