import assert from 'node:assert/strict';
import type { Page } from 'playwright';

export async function checkStreaming(page:Page) {
  const result=await page.evaluate(async()=>{
    const modulePath='/src/renderer/features/conversations/streaming.ts';
    const markdownPath='/src/renderer/features/conversations/markdown.ts';
    const {StreamingMarkdown}=await import(modulePath),{renderMarkdown}=await import(markdownPath);
    const host=document.createElement('div');document.body.append(host);host.style.cssText='position:fixed;left:-10000px;width:500px';
    const renderer=new StreamingMarkdown(host);
    const prefix='A settled paragraph.\n\n';renderer.prime(prefix);const first=host.firstChild;
    const tail='## A heading\n\n- **Bold** and *italic*\n- [Link](https://example.com/final)\n\n```ts\nconst a = "safe";\nconsole.log(a);\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>unsafe()</script>\n\n![remote](https://example.com/tracker.png)';
    for(let i=1;i<=tail.length;i++)renderer.update(prefix+tail.slice(0,i),true);
    const retained=host.firstChild===first;
    await new Promise(resolve=>setTimeout(resolve,750));
    const expected=document.createElement('div');expected.innerHTML=renderMarkdown(prefix+tail);
    const exact=host.textContent===expected.textContent;
    const hidden=host.querySelectorAll('[style*="display: none"]').length;
    const safe=!host.querySelector('script,img')&&host.querySelector('a')?.getAttribute('href')==='https://example.com/final';
    const code=host.querySelector('code')?.textContent;
    renderer.prime('[Link](https://example.com/old)');
    // Re-parsing can update attributes of an existing anchor, not just its text.
    renderer.update('[Link](https://example.com/old) and more',true);
    renderer.prime('Restored history');const restored=host.textContent?.trim();
    renderer.update('Restored history '+ 'new '.repeat(100),true);renderer.dispose();host.remove();
    return {retained,exact,hidden,safe,code,restored};
  });
  assert.deepEqual(result,{retained:true,exact:true,hidden:0,safe:true,code:'const a = "safe";\nconsole.log(a);',restored:'Restored history'});
  await page.emulateMedia({reducedMotion:'reduce'});
  try {
    assert.equal(await page.evaluate(async()=>{
      const path='/src/renderer/features/conversations/streaming.ts';const {StreamingMarkdown}=await import(path);
      const host=document.createElement('div'),renderer=new StreamingMarkdown(host);renderer.prime('');renderer.update('Immediate accessible text',true);
      const immediate=host.textContent?.trim()==='Immediate accessible text'&&!host.querySelector('[style*="display: none"]');renderer.dispose();return immediate;
    }),true);
  }finally{await page.emulateMedia({reducedMotion:'no-preference'});}
}
