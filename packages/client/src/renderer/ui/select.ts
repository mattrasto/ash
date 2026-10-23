import icons from './icons.json';
import { popup } from './popup.ts';
import { surface,surfaceMotion } from './surface.ts';

/** The native select remains the form value, focus target, label owner and fallback. */
export function selectField(select:HTMLSelectElement){
  select.classList.add('ash-popup-trigger');select.style.appearance='none';
  let panel:HTMLDivElement|undefined,skin:ReturnType<typeof surface>|undefined,placement:ReturnType<typeof popup>|undefined;
  let options:HTMLOptionElement[]=[],active=0,buffer='',typed=0,animation=0,closing=false,generation=0,progress=0;
  const ids=`ash-options-${crypto.randomUUID()}`;
  function supported(){return 'showPopover' in HTMLElement.prototype&&!matchMedia('(forced-colors:active)').matches&&!matchMedia('(pointer:coarse)').matches;}
  function end(){generation++;if(animation)cancelAnimationFrame(animation);animation=0;placement?.destroy();placement=undefined;skin?.destroy();skin=undefined;panel?.remove();panel=undefined;closing=false;select.removeAttribute('aria-controls');select.removeAttribute('aria-activedescendant');select.setAttribute('aria-expanded','false');}
  function animate(to:0|1){
    if(!panel)return;
    const version=++generation,from=progress;cancelAnimationFrame(animation);
    const transition=surfaceMotion(panel,{role:'popup'},to?'in':'out'),duration=(transition.duration??0)*Math.abs(to-from),start=performance.now();
    transition.tick?.(from,1-from);
    const step=(now:number)=>{
      if(!panel||version!==generation)return;
      const t=duration?Math.min(1,(now-start)/duration):1;progress=from+(to-from)*t;transition.tick?.(progress,1-progress);
      if(t<1)animation=requestAnimationFrame(step);else{animation=0;if(!to)end();}
    };
    if(duration)animation=requestAnimationFrame(step);else step(start);
  }
  function close(immediate=false){if(!panel)return;if(immediate){end();return;}if(closing)return;closing=true;select.setAttribute('aria-expanded','false');select.removeAttribute('aria-activedescendant');animate(0);}

  function mark(){if(!panel)return;for(const row of Array.from(panel.querySelectorAll<HTMLElement>('[role=option]'))){const index=Number(row.dataset.index);row.setAttribute('aria-selected',String(options[index]?.selected));const check=row.querySelector<HTMLElement>('.ash-option-check');if(check)check.style.opacity=options[index]?.selected?'1':'0';row.dataset.highlighted=String(index===active);}const row=panel.querySelector<HTMLElement>(`[data-index="${active}"]`);if(row){select.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});}}
  function commit(index:number){const option=options[index];if(!option||option.disabled||(option.parentElement instanceof HTMLOptGroupElement&&option.parentElement.disabled))return;select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));mark();close();}
  function enabled(index:number){const option=options[index];return option&&!option.disabled&&!(option.parentElement instanceof HTMLOptGroupElement&&option.parentElement.disabled);}
  function open(){
    if(select.disabled||!supported())return;
    if(panel){if(!closing){close();return;}closing=false;document.dispatchEvent(new CustomEvent('ash:dismiss-popups',{detail:panel}));select.setAttribute('aria-expanded','true');animate(1);mark();return;}
    options=Array.from(select.options);active=select.selectedIndex;if(!enabled(active))active=options.findIndex((_,index)=>enabled(index));
    panel=document.createElement('div');panel.className='ash-select-popup';panel.id=ids;panel.role='listbox';panel.ariaLabel=select.labels?.[0]?.textContent??select.ariaLabel??'Options';
    const content=document.createElement('div');content.className='surface-content';panel.append(content);
    let group:Element|null=null;
    options.forEach((option,index)=>{if(option.parentElement instanceof HTMLOptGroupElement&&option.parentElement!==group){group=option.parentElement;const title=document.createElement('div');title.className='ash-option-group';title.textContent=(group as HTMLOptGroupElement).label;content.append(title);}const row=document.createElement('div');row.className='ash-menu-row';row.role='option';row.id=`${ids}-${index}`;row.dataset.index=String(index);row.ariaDisabled=String(!enabled(index));const check=document.createElement('span');check.ariaHidden='true';check.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${icons.check}</svg>`;check.className='ash-option-check';check.style.opacity=option.selected?'1':'0';row.append(check,document.createTextNode(option.label));row.addEventListener('pointermove',()=>{if(enabled(index)){active=index;mark();}});row.addEventListener('pointerdown',e=>e.preventDefault());row.addEventListener('click',()=>commit(index));content.append(row);});
    (select.closest('dialog')??document.body).append(panel);skin=surface(panel,{material:'popup'});panel.style.minWidth=`${Math.min(select.offsetWidth,innerWidth-16)}px`;
    placement=popup(panel,{anchor:select,onClose:()=>close()});select.setAttribute('aria-controls',ids);select.setAttribute('aria-expanded','true');
    progress=0;animate(1);mark();
  }
  function down(event:PointerEvent){if(event.button===0&&supported()&&!select.disabled){event.preventDefault();select.focus();open();}}
  function key(event:KeyboardEvent){
    if(!supported()||select.disabled)return;
    if(event.key==='Tab'){close();return;}
    if(event.key==='Escape'&&panel&&!closing){event.preventDefault();event.stopPropagation();close();return;}
    if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
      event.preventDefault();if(!panel||closing){open();if(event.key==='Enter'||event.key===' ')return;}
      else if(event.key==='Enter'||event.key===' '){commit(active);return;}
      if(event.key==='Home'||event.key==='End'){active=event.key==='Home'?0:options.length-1;while(active>=0&&active<options.length&&!enabled(active))active+=event.key==='Home'?1:-1;}
      else if(event.key==='ArrowDown'||event.key==='ArrowUp'){const delta=event.key==='ArrowDown'?1:-1;for(let i=1;i<=options.length;i++){const index=(active+delta*i+options.length)%options.length;if(enabled(index)){active=index;break;}}}mark();return;
    }
    if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();if(!panel||closing)open();const now=performance.now();buffer=now-typed<700?buffer+event.key:event.key;typed=now;const text=buffer.toLowerCase();for(let i=1;i<=options.length;i++){const index=(active+i)%options.length;if(enabled(index)&&options[index].label.toLowerCase().startsWith(text)){active=index;break;}}mark();}
  }
  const observer=new MutationObserver(()=>{if(select.disabled||panel)close(true);});observer.observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  select.addEventListener('pointerdown',down);select.addEventListener('keydown',key);select.setAttribute('aria-expanded','false');
  return {destroy(){end();observer.disconnect();select.removeEventListener('pointerdown',down);select.removeEventListener('keydown',key);}};
}
