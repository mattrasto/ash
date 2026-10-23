import {cubicInOut} from 'svelte/easing';
import {reducedMotion} from './surface.ts';
/** Move layout space around a full-size material; glass never resizes per frame. */
export function railSlide(node:HTMLElement,{side}:{side:'left'|'right'}){
  return ()=>{
    const width=(node.firstElementChild as HTMLElement)?.offsetWidth??node.offsetWidth;
    const overlay=getComputedStyle(node).position==='fixed',gap=parseFloat(getComputedStyle(node.parentElement!).columnGap)||0;
    return {duration:reducedMotion()?0:190,easing:cubicInOut,css:(t:number)=>overlay
      ?`transform:translateX(${(side==='left'?-1:1)*width*(1-t)}px);overflow:hidden`
      :`width:${width*t}px;min-width:0;margin-${side==='left'?'right':'left'}:${-gap*(1-t)}px;overflow:hidden`};
  };
}
