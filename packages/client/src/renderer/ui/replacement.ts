import { tick } from 'svelte';
import { reducedMotion } from './surface.ts';
const running=new WeakMap<HTMLElement,{cancel:()=>void;visual:HTMLElement}>();

/** Freeze only a visual copy. The live feature tree keeps focus and editor state. */
function snapshot(source:HTMLElement){
  const clone=source.cloneNode(true) as HTMLElement;
  const style=getComputedStyle(source);
  for(const property of ['padding','display','flex-direction','gap','font','color','line-height','box-sizing','border-radius'])clone.style.setProperty(property,style.getPropertyValue(property));
  const sources=[source,...Array.from(source.querySelectorAll<HTMLElement>('*'))];
  const copies=[clone,...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  sources.forEach((original,index)=>{
    const copy=copies[index];if(!copy)return;
    copy.removeAttribute('aria-label');copy.removeAttribute('title');copy.removeAttribute('form');copy.removeAttribute('id');copy.removeAttribute('data-testid');copy.removeAttribute('name');copy.removeAttribute('for');copy.removeAttribute('autofocus');copy.removeAttribute('aria-live');copy.removeAttribute('aria-describedby');copy.removeAttribute('aria-labelledby');copy.removeAttribute('aria-controls');copy.removeAttribute('popover');
    copy.style.removeProperty('--reveal');copy.style.removeProperty('--frost-reveal');
    if(original instanceof HTMLInputElement&&copy instanceof HTMLInputElement){copy.value=original.value;copy.checked=original.checked;}
    if(original instanceof HTMLTextAreaElement&&copy instanceof HTMLTextAreaElement)copy.value=original.value;
    if(original instanceof HTMLSelectElement&&copy instanceof HTMLSelectElement)copy.value=original.value;
    if(original instanceof HTMLCanvasElement&&copy instanceof HTMLCanvasElement){copy.getContext('2d')?.drawImage(original,0,0);}
    if(original instanceof HTMLLabelElement){
      const label=document.createElement('span'),style=getComputedStyle(original);label.className=copy.className;label.style.cssText=copy.style.cssText;
      for(const property of ['display','font','color','line-height','margin','padding','width','height','gap','align-items','flex','cursor'])label.style.setProperty(property,style.getPropertyValue(property));
      label.append(...Array.from(copy.childNodes));copy.replaceWith(label);
    }
    if(original instanceof HTMLVideoElement&&copy instanceof HTMLVideoElement){
      const frame=document.createElement('canvas'),style=getComputedStyle(original);frame.width=original.videoWidth||1;frame.height=original.videoHeight||1;
      frame.style.cssText=`display:${style.display};width:${style.width};height:${style.height};object-fit:${style.objectFit};background:${style.backgroundColor}`;
      try{frame.getContext('2d')?.drawImage(original,0,0);}catch{/* A not-yet-decoded frame keeps its neutral backing. */}
      copy.removeAttribute('autoplay');copy.removeAttribute('src');copy.replaceWith(frame);
    }

  });
  clone.inert=true;clone.ariaHidden='true';clone.classList.add('ash-replacement-copy');
  return {clone,restoreScroll(){sources.forEach((original,index)=>{const copy=copies[index];if(copy){copy.scrollTop=original.scrollTop;copy.scrollLeft=original.scrollLeft;}});}};
}
export async function replaceContent(host:HTMLElement|undefined,update:()=>void|Promise<void>,options:{resize?:boolean}={}){
  if(!host||reducedMotion()){running.get(host!)?.cancel();await update();return;}
  // Capture the current composite before cancelling earlier visual layers.
  const content=host.classList.contains('ash-surface')?host.querySelector<HTMLElement>(':scope > .surface-content')??host:host;
  const before=host.getBoundingClientRect(),contentBox=content.getBoundingClientRect(),copy=snapshot(content),previous=running.get(host);
  const prior=previous?snapshot(previous.visual):undefined;
  if(previous){copy.clone.style.opacity=getComputedStyle(content).opacity;if(prior)prior.clone.style.opacity=getComputedStyle(previous.visual).opacity;}
  const parent=content.parentElement;if(!parent){await update();return;}
  const parentBox=parent.getBoundingClientRect();
  previous?.cancel();
  const originalPosition=parent.style.position;if(getComputedStyle(parent).position==='static')parent.style.position='relative';
  const visual=document.createElement('div');visual.className='ash-replacement-visual';visual.inert=true;visual.ariaHidden='true';
  visual.style.cssText=`position:absolute;left:${contentBox.left-parentBox.left+parent.scrollLeft}px;top:${contentBox.top-parentBox.top+parent.scrollTop}px;width:${contentBox.width}px;height:${contentBox.height}px;margin:0;pointer-events:none;z-index:8;overflow:hidden`;
  parent.append(visual);
  if(prior){prior.clone.style.cssText+=';position:absolute;inset:0;width:100%;height:100%;margin:0';visual.append(prior.clone);prior.restoreScroll();}
  copy.clone.style.cssText+=';position:absolute;inset:0;margin:0;width:100%;height:100%';visual.append(copy.clone);copy.restoreScroll();
  const animations:Animation[]=[];let cancelled=false;
  const cancel=()=>{cancelled=true;animations.forEach(a=>a.cancel());visual.remove();if(running.get(host)?.cancel===cancel){running.delete(host);parent.style.position=originalPosition;}};
  running.set(host,{cancel,visual});
  try{
    await update();await tick();if(cancelled||!host.isConnected){cancel();return;}
    const after=host.getBoundingClientRect();
    animations.push(visual.animate([{opacity:1},{opacity:0}],{duration:190,easing:'linear'}));
    // The clone is a sibling: the incoming opacity never multiplies the outgoing fade.
    animations.push(content.animate([{opacity:0},{opacity:1}],{duration:190,easing:'linear'}));
    if(options.resize!==false&&(Math.abs(before.width-after.width)>.5||Math.abs(before.height-after.height)>.5))animations.push(host.animate([{width:`${before.width}px`,height:`${before.height}px`},{width:`${after.width}px`,height:`${after.height}px`}],{duration:190,easing:'ease-in-out'}));
    await Promise.all(animations.map(a=>a.finished.catch(()=>{})));
  }finally{cancel();}
}
