import { reducedMotion } from './surface.ts';

/** Overlay presentation never replaces the native scrollport or transcript owner. */
export function scrollArea(node:HTMLElement,options:{onIntent?:(up:boolean)=>void}={}){
  let current=options;
  const fallback=()=>matchMedia('(pointer:coarse)').matches||matchMedia('(forced-colors:active)').matches;
  const media=matchMedia('(forced-colors:active)'),pointer=matchMedia('(pointer:coarse)');
  const bar=document.createElement('div'),thumb=document.createElement('div');
  bar.className='ash-scrollbar';thumb.className='ash-scroll-thumb';bar.append(thumb);
  bar.role='scrollbar';bar.tabIndex=0;bar.ariaLabel=node.getAttribute('aria-label')??'Scroll content';bar.ariaOrientation='vertical';
  const id=node.id||`ash-scroll-${crypto.randomUUID()}`;node.id=id;bar.setAttribute('aria-controls',id);
  const host=node.parentElement!;const originalPosition=host.style.position;
  if(getComputedStyle(host).position==='static')host.style.position='relative';
  host.append(bar);let frame=0,target=node.scrollTop,last=0,dragging=false,pointerY=0,origin=0;
  let trackHeight=0,thumbHeight=0,max=0;
  function stop(){cancelAnimationFrame(frame);frame=0;target=node.scrollTop;}
  function measure(){
    node.classList.toggle('ash-scroll',!fallback());node.classList.toggle('ash-scroll-native',fallback());
    const rect=node.getBoundingClientRect(),parent=host.getBoundingClientRect();
    bar.style.top=`${rect.top-parent.top+13}px`;bar.style.bottom=`${Math.max(0,parent.bottom-rect.bottom)+13}px`;bar.style.right=`${Math.max(0,parent.right-rect.right)+2}px`;
    trackHeight=Math.max(0,node.clientHeight-26);max=Math.max(0,node.scrollHeight-node.clientHeight);thumbHeight=Math.min(trackHeight,Math.max(28,trackHeight*node.clientHeight/node.scrollHeight));
    const visible=!fallback()&&max>1&&trackHeight>28;bar.dataset.visible=String(visible);bar.tabIndex=visible?0:-1;bar.ariaHidden=String(!visible);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(Math.round(max)));update();
  }
  function update(){thumb.style.height=`${thumbHeight}px`;thumb.style.top=`${max?node.scrollTop/max*(trackHeight-thumbHeight):0}px`;bar.setAttribute('aria-valuenow',String(Math.round(node.scrollTop)));}
  function animate(now:number){const dt=last?now-last:16;last=now;const d=target-node.scrollTop;node.scrollTop+=d*(1-Math.exp(-dt/45));update();if(Math.abs(d)>.5)frame=requestAnimationFrame(animate);else{node.scrollTop=target;frame=0;last=0;}}
  function move(value:number){current.onIntent?.(value<node.scrollTop);target=Math.max(0,Math.min(max,value));if(reducedMotion()){node.scrollTop=target;return;}if(!frame){last=0;frame=requestAnimationFrame(animate);}}
  function down(event:PointerEvent){
    if(event.button!==0)return;
    event.preventDefault();stop();dragging=true;bar.dataset.dragging='true';bar.setPointerCapture(event.pointerId);bar.focus({preventScroll:true});pointerY=event.clientY;origin=node.scrollTop;
    const bounds=thumb.getBoundingClientRect();
    // The thumb ignores hit testing; distinguish track clicks by its visible bounds.
    if(event.clientY<bounds.top||event.clientY>bounds.bottom){move((event.clientY-bar.getBoundingClientRect().top-thumbHeight/2)/Math.max(1,trackHeight-thumbHeight)*max);origin=target;}
  }
  function drag(event:PointerEvent){if(dragging)move(origin+(event.clientY-pointerY)/Math.max(1,trackHeight-thumbHeight)*max);}
  function release(){dragging=false;bar.dataset.dragging='false';}
  function key(event:KeyboardEvent){const delta=event.key==='ArrowDown'?40:event.key==='ArrowUp'?-40:event.key==='PageDown'?node.clientHeight:event.key==='PageUp'?-node.clientHeight:0;if(delta||event.key==='Home'||event.key==='End'){event.preventDefault();stop();current.onIntent?.(event.key!=='End'&&delta<=0);node.scrollTop=event.key==='Home'?0:event.key==='End'?max:node.scrollTop+delta;}}
  function wheel(event:WheelEvent){
    if(event.defaultPrevented){stop();return;}
    if(fallback()||event.ctrlKey||event.metaKey||event.shiftKey||event.deltaX||!event.deltaY||event.deltaMode===0&&(!Number.isInteger(event.deltaY)||Math.abs(event.deltaY)<80||event.deltaY%40!==0&&event.deltaY%100!==0))return;
    for(const element of event.composedPath()){
      if(element===node)break;
      if(!(element instanceof HTMLElement))continue;
      const style=getComputedStyle(element),limit=element.scrollHeight-element.clientHeight;
      if(!/^(auto|scroll|overlay)$/.test(style.overflowY)||limit<=1)continue;
      if((event.deltaY<0?element.scrollTop>0:element.scrollTop<limit-1)||style.overscrollBehaviorY==='contain'||style.overscrollBehaviorY==='none'){stop();return;}
    }
    const next=(frame?target:node.scrollTop)+event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?node.clientHeight:1);
    if(next<0&&node.scrollTop===0||next>max&&node.scrollTop>=max)return;
    event.preventDefault();move(next);
  }
  const observer=new ResizeObserver(measure);observer.observe(node);for(const child of Array.from(node.children))observer.observe(child);
  const mutation=new MutationObserver(measure);mutation.observe(node,{childList:true,subtree:true});
  node.addEventListener('scroll',update,{passive:true});node.addEventListener('wheel',wheel,{passive:false});node.addEventListener('pointerdown',stop);node.addEventListener('focusin',stop);node.addEventListener('keydown',stop);
  bar.addEventListener('pointerdown',down);bar.addEventListener('pointermove',drag);bar.addEventListener('lostpointercapture',release);bar.addEventListener('keydown',key);media.addEventListener('change',measure);pointer.addEventListener('change',measure);measure();
  return {update(value:typeof options){current=value;},destroy(){stop();observer.disconnect();mutation.disconnect();media.removeEventListener('change',measure);pointer.removeEventListener('change',measure);node.removeEventListener('scroll',update);node.removeEventListener('wheel',wheel);node.removeEventListener('pointerdown',stop);node.removeEventListener('focusin',stop);node.removeEventListener('keydown',stop);bar.remove();host.style.position=originalPosition;}};
}
