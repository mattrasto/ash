import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../packages/client/src/renderer/features/conversations/markdown.ts';
test('Markdown renders useful structure without active HTML, unsafe links or remote image fetches',()=>{
  const rendered=renderMarkdown('# Heading\n\n- One\n- Two\n\n```ts\nconst x = "<script>";\n```\n\n<script>alert(1)</script>\n\n![secret](https://example.com/pixel.png)\n\n[bad](javascript:alert%281%29) [good](https://example.com)');
  assert.match(rendered,/<h1>Heading<\/h1>/);assert.match(rendered,/<ul>/);assert.match(rendered,/data-copy-code/);
  assert.ok(!rendered.includes('<script>'));assert.ok(!rendered.includes('<img'));assert.ok(!rendered.includes('href="javascript:'));
  assert.match(rendered,/href="https:\/\/example.com\/"/);assert.match(rendered,/&lt;script&gt;/);
});
