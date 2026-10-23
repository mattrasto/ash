import {popupDismissals} from './dismiss.ts';
export interface PopupOptions {
  anchor?:HTMLElement;resolveAnchor?:()=>HTMLElement|undefined;point?:{x:number;y:number};parent?:HTMLElement;
  onClose:()=>void;chain?:()=>HTMLElement[];
}
/** The native top layer escapes clipping while retaining the active dialog's context. */
export function popup(node:HTMLElement,options:PopupOptions){
  let current=options,disposed=false;
  node.id ||= `ash-popup-${crypto.randomUUID()}`;
  const mark=(anchor:HTMLElement)=>{anchor.dataset.ashPopupOwner=node.id;anchor.classList.add('ash-popup-trigger');anchor.setAttribute('aria-expanded','true');};
  const clear=(anchor:HTMLElement)=>{if(anchor.dataset.ashPopupOwner===node.id){anchor.removeAttribute('data-ash-popup-owner');anchor.setAttribute('aria-expanded','false');anchor.classList.remove('ash-popup-trigger');}};
  const before=document.activeElement as HTMLElement|null;
  const closeOthers=(event:Event)=>{const next=(event as CustomEvent).detail;if(next!==node&&!(next instanceof Node&&node.contains(next)))current.onClose();};
  if(!options.parent){document.dispatchEvent(new CustomEvent('ash:dismiss-popups',{detail:node}));document.addEventListener('ash:dismiss-popups',closeOthers);}
  if('showPopover' in node){node.setAttribute('popover','manual');node.showPopover();}
  if(current.anchor){mark(current.anchor);}
  function position(){
    if(disposed)return;
    if(current.anchor&&!current.anchor.isConnected){const next=current.resolveAnchor?.();if(next){observer.unobserve(current.anchor);current.anchor=next;observer.observe(next);mark(next);}}
    const a=current.anchor?.getBoundingClientRect(),bounds=node.getBoundingClientRect(),margin=8,gap=6;
    if(current.anchor&&!current.anchor.isConnected){queueMicrotask(()=>{if(!disposed&&current.anchor&&!current.anchor.isConnected)current.onClose();});return;}
    if(a){
      let ancestor=current.anchor!.parentElement;
      while(ancestor&&ancestor!==document.body){if(/auto|scroll|hidden/.test(getComputedStyle(ancestor).overflowY)){const r=ancestor.getBoundingClientRect();if(a.bottom<=r.top||a.top>=r.bottom){current.onClose();return;}}ancestor=ancestor.parentElement;}
    }
    let left=current.point?.x??a?.left??margin,top=current.point?.y??(a?a.bottom+gap:margin);
    if(a&&current.parent){left=a.right+gap;if(left+bounds.width>innerWidth-margin)left=a.left-bounds.width-gap;top=a.top;}
    else if(a&&top+bounds.height>innerHeight-margin&&a.top-gap>=bounds.height)top=a.top-bounds.height-gap;
    node.style.left=`${Math.max(margin,Math.min(left,innerWidth-bounds.width-margin))}px`;
    node.style.top=`${Math.max(margin,Math.min(top,innerHeight-bounds.height-margin))}px`;
    document.dispatchEvent(new CustomEvent('ash:popup-position',{detail:node}));
  }
  const outside=(event:PointerEvent)=>{if(node.inert)return;const target=event.target as Node;if(!node.contains(target)&&!current.anchor?.contains(target)&&!current.chain?.().some(part=>part.contains(target))){popupDismissals.add(event);current.onClose();}};
  const parentMoved=(event:Event)=>{const moved=(event as CustomEvent).detail;if(current.parent===moved||node.parentElement===moved)position();};
  const scroll=(event:Event)=>{if(!node.contains(event.target as Node))position();};
  const observer=new ResizeObserver(position);observer.observe(node);if(current.anchor)observer.observe(current.anchor);
  document.addEventListener('ash:popup-position',parentMoved);document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',position);position();
  return {update(value:PopupOptions){if(current.anchor!==value.anchor){if(current.anchor){observer.unobserve(current.anchor);clear(current.anchor);}if(value.anchor){observer.observe(value.anchor);mark(value.anchor);}}current=value;position();},destroy(){disposed=true;observer.disconnect();document.removeEventListener('ash:dismiss-popups',closeOthers);document.removeEventListener('ash:popup-position',parentMoved);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',position);if(current.anchor?.isConnected){clear(current.anchor);}if('hidePopover' in node&&node.matches(':popover-open'))node.hidePopover();if(before?.isConnected&&node.contains(document.activeElement))before.focus({preventScroll:true});}};
}
export function dismissPopups(){document.dispatchEvent(new CustomEvent('ash:dismiss-popups'));}
