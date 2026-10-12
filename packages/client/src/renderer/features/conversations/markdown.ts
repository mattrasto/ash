import { Marked } from 'marked';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const markdown=new Marked({gfm:true,breaks:true,renderer:{
  html({text}){return escape(text);},
  image({text}){return `<span class="image-reference">[Image: ${escape(text)}]</span>`;},
  link({href,tokens}) {
    const label=this.parser.parseInline(tokens);
    try {const url=new URL(href);if(['https:','http:'].includes(url.protocol) && !url.username && !url.password)return `<a href="${escape(url.href)}" rel="noreferrer">${label}</a>`;}catch{}
    return label;
  },
  code({text,lang}){return `<div class="code-block"><div class="code-heading"><span>${escape((lang??'').split(/\s/)[0])}</span><button type="button" data-copy-code>Copy code</button></div><pre><code>${escape(text)}</code></pre></div>`;},
}});
export function renderMarkdown(text:string) {return markdown.parse(text,{async:false});}
