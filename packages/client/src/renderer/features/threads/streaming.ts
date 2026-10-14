import { renderMarkdown } from './markdown.ts';

// Reconcile the sanitized Markdown tree, retaining settled nodes and their selection.
// Asha's word/line cascade is bounded here so fast responses never build a long queue.
export class StreamingMarkdown {
  private text='';
  private next=0;
  private pending=new Map<HTMLElement,ReturnType<typeof setTimeout>>();
  constructor(private host:HTMLElement) {}
  prime(text:string){this.dispose();this.host.innerHTML=renderMarkdown(text);this.text=text;}
  update(text:string,animate:boolean){
    if(text===this.text)return;
    if(!text.startsWith(this.text)){this.prime(text);return;}
    this.text=text;
    const target=document.createElement('template');target.innerHTML=renderMarkdown(text);
    const fading=animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reconcile(this.host,target.content,fading,false);
    for(const [node,timer] of this.pending)if(!this.host.contains(node)){clearTimeout(timer);this.pending.delete(node);}
  }
  dispose(){for(const timer of this.pending.values())clearTimeout(timer);this.pending.clear();this.next=0;}
  private reveal(node:HTMLElement,delay:number){
    node.style.display='none';
    this.pending.set(node,setTimeout(()=>{node.style.display='';this.pending.delete(node);},delay));
  }
  private fragment(text:string,line:boolean){
    const fragment=document.createDocumentFragment();
    for(const part of text.split(line?/(\n)/:/(\s+)/)){
      if(!part)continue;
      if(/^\s+$/.test(part)){fragment.append(document.createTextNode(part));continue;}
      const token=document.createElement('span');token.className='stream-token';token.textContent=part;
      const now=performance.now();this.next=Math.min(Math.max(this.next,now),now+400);
      this.reveal(token,this.next-now);this.next+=35;fragment.append(token);
    }
    return fragment;
  }
  private decorate(node:Node,line:boolean):Node {
    if(node.nodeType===Node.TEXT_NODE)return this.fragment(node.textContent??'',line);
    if(!(node instanceof HTMLElement)||['TABLE','BUTTON'].includes(node.tagName))return node;
    const lines=line||node.tagName==='PRE';
    if(['P','LI','H1','H2','H3','H4','BLOCKQUOTE','PRE','HR'].includes(node.tagName)){
      node.classList.add('stream-block');this.reveal(node,Math.max(0,this.next-performance.now()));
    }
    for(const child of Array.from(node.childNodes))node.replaceChild(this.decorate(child,lines),child);
    return node;
  }
  private reconcile(host:Node,target:Node,fade:boolean,line:boolean){
    let hi=0,ti=0;
    const children=Array.from(target.childNodes);
    for(;ti<children.length;ti++){
      const t=children[ti],h=host.childNodes[hi];if(!h)break;
      if(t.nodeType===Node.TEXT_NODE){
        const text=t.textContent??'';let pos=0;
        while(pos<text.length){
          const node=host.childNodes[hi];
          if(!node||!(node.nodeType===Node.TEXT_NODE||node instanceof HTMLElement&&node.classList.contains('stream-token')))break;
          const value=node.textContent??'';
          if(!value||!text.slice(pos).startsWith(value))break;
          pos+=value.length;hi++;
        }
        if(pos===text.length)continue;
        if(pos>0){
          // Remove the mismatching tail before inserting newly parsed content.
          while(host.childNodes.length>hi)host.removeChild(host.lastChild!);
          const tail=fade?this.fragment(text.slice(pos),line):document.createTextNode(text.slice(pos));
          host.appendChild(tail);hi=host.childNodes.length;continue;
        }
        break;
      }
      if(t instanceof HTMLElement && h instanceof HTMLElement && t.tagName===h.tagName){
        // Markdown links can change destination as a chunk arrives; never retain stale attributes.
        for(const attr of Array.from(h.attributes))if(!t.hasAttribute(attr.name)&&!['class','style'].includes(attr.name))h.removeAttribute(attr.name);
        for(const attr of Array.from(t.attributes))if(attr.name!=='class'||!h.classList.contains('stream-block'))h.setAttribute(attr.name,attr.value);
        this.reconcile(h,t,fade&&!['TABLE','BUTTON'].includes(t.tagName),line||t.tagName==='PRE');hi++;continue;
      }
      break;
    }
    while(host.childNodes.length>hi)host.removeChild(host.lastChild!);
    for(;ti<children.length;ti++){const node=children[ti].cloneNode(true);host.appendChild(fade?this.decorate(node,line):node);}
  }
}
