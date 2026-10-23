/** One outside gesture dismisses only the topmost popup or guarded dialog. */
export const popupDismissals=new WeakSet<Event>();
export function dialogDismiss(node:HTMLDialogElement,onDismiss:()=>void){
  let dismiss=onDismiss,pointer:number|undefined;
  const outside=(event:PointerEvent)=>{const r=node.getBoundingClientRect();return event.target===node&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
  const down=(event:PointerEvent)=>{
    pointer=undefined;
    if(event.button!==0||!node.open||node.inert||popupDismissals.has(event)||node.querySelector('.ash-surface[data-material="popup"]:not([data-closing="true"])'))return;
    if(outside(event))pointer=event.pointerId;
  };
  const up=(event:PointerEvent)=>{const beganOutside=pointer===event.pointerId;pointer=undefined;if(beganOutside&&node.open&&!node.inert&&outside(event))dismiss();};
  const cancel=()=>{pointer=undefined;};
  document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
  return {update(value:()=>void){dismiss=value;},destroy(){document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);}};
}
