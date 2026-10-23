import type { TransitionConfig } from 'svelte/transition';

type Material = 'panel'|'message'|'popup';
type Role = 'large'|'compact'|'popup';
export interface SurfaceOptions {material?:Material;dense?:boolean;extent?:string}
const surfaces=new WeakMap<HTMLElement,Glass>();
const svgNS='http://www.w3.org/2000/svg';
let sequence=0;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};
const hash=(x:number,y:number,seed:number)=>{let v=Math.imul(x+seed,374761393)+Math.imul(y,668265263);v=Math.imul(v^(v>>>13),1274126177);return ((v^(v>>>16))>>>0)/4294967295;};
export const reducedMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches||matchMedia('(forced-colors:active)').matches;

/** The threshold bitmap is generated once per appearance/geometry. SVG changes only
 * the alpha transfer during animation; there is no per-frame canvas encoding. */
class Glass {
  private skin=document.createElement('div');
  private frost=document.createElement('div');
  private defs:SVGSVGElement|undefined;
  private transfer:SVGElement|undefined;
  private maskId='';
  private seed=Math.floor(Math.random()*0x7fffffff);
  private patternSize='';
  private observer:ResizeObserver;
  private mutation:MutationObserver;
  private media=matchMedia('(prefers-reduced-motion:reduce)');
  private changed=()=>{this.measure();if(this.media.matches)this.render(this.closing?0:1,'compact');};
  private progress=1;
  private disposed=false;
  private contentOpacity=1;
  private closing=false;
  private options:SurfaceOptions;
  constructor(readonly node:HTMLElement,options:SurfaceOptions){
    this.options=options;node.classList.add('ash-surface');node.dataset.forming='false';
    if(getComputedStyle(node).position==='static')node.style.position='relative';
    this.skin.className='ash-skin';this.frost.className='ash-frost';
    this.skin.ariaHidden=this.frost.ariaHidden='true';node.prepend(this.frost,this.skin);
    this.observer=new ResizeObserver(()=>this.measure());this.observer.observe(node);
    if(this.content)this.observer.observe(this.content);
    this.mutation=new MutationObserver(()=>this.measure());
    if(this.content)this.mutation.observe(this.content,{childList:true,subtree:true});
    this.media.addEventListener('change',this.changed);
    void document.fonts.ready.then(()=>{if(!this.disposed)this.measure();});
    this.update(options);this.measure();
  }
  get value(){return this.progress;}
  get content(){return this.node.querySelector<HTMLElement>(':scope > .surface-content');}
  update(options:SurfaceOptions){this.options=options;this.node.dataset.material=options.material??'panel';this.node.dataset.backing=options.dense?'dense':'standard';this.measure();}
  measure(){
    const content=this.content;if(!content)return;
    const panel=this.node.getBoundingClientRect();
    const extent=this.options.extent?content.querySelector<HTMLElement>(this.options.extent):Array.from(content.children).filter(node=>!node.classList.contains('ash-scrollbar')&&!node.classList.contains('ash-replacement-visual')).at(-1) as HTMLElement|undefined??content;
    const rect=extent?.getBoundingClientRect();
    const end=rect?Math.min(panel.height,Math.max(0,rect.bottom-panel.top+(extent?.parentElement?.scrollTop??0)+parseFloat(getComputedStyle(content).paddingBottom))):panel.height;
    const value=`${end}px`;if(this.node.style.getPropertyValue('--content-end')!==value)this.node.style.setProperty('--content-end',value);
    // Layout changes never replay entrance. A mid-transition resize keeps its seed.
    if(this.progress>0&&this.progress<1)this.pattern();
  }
  begin(out:boolean){this.closing=out;this.contentOpacity=out||this.progress>0&&this.progress<1?Number(this.content?.style.opacity||1):0;this.node.inert=out;this.node.dataset.closing=String(out);if(!(this.node instanceof HTMLDialogElement))this.node.ariaHidden=out?'true':null;if(!out&&this.progress===0){this.seed=Math.floor(Math.random()*0x7fffffff);this.patternSize='';}this.pattern();}
  private pattern(){
    const width=this.node.offsetWidth,height=this.node.offsetHeight,key=`${width}:${height}:${this.seed}`;
    if(!width||!height||this.patternSize===key||reducedMotion())return;
    this.patternSize=key;
    const w=Math.ceil(width/3),h=Math.ceil(height/3),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const context=canvas.getContext('2d');if(!context)return;
    const sites:{x:number;y:number}[]=[];
    for(let i=0;i<2;i++){
      let best={x:.5,y:.5},distance=-1;
      for(let j=0;j<16;j++){const point={x:.5+.3*(hash(i,j,this.seed)-.5),y:.5+.3*(hash(i,j,this.seed+71)-.5)};const d=sites.length?Math.min(...sites.map(s=>(s.x-point.x)**2+(s.y-point.y)**2)):1;if(d>distance){distance=d;best=point;}}
      sites.push(best);
    }
    const values=new Float32Array(w*h);let farthest=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.sqrt(Math.min(...sites.map(s=>((x+.5)*width/w-s.x*width)**2+((y+.5)*height/h-s.y*height)**2)));values[y*w+x]=d;farthest=Math.max(farthest,d);}
    const data=context.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=values[y*w+x]/(farthest||1),noise=(hash(x,y,this.seed+151)-.5)*.07*Math.min(1,d*8),threshold=.025+.79*d+noise;data.data[(y*w+x)*4+3]=Math.round((1-threshold)*255);}
    context.putImageData(data,0,0);
    this.defs?.remove();
    const id=`ash-mist-${++sequence}`;this.maskId=`${id}-mask`;
    const svg=document.createElementNS(svgNS,'svg');svg.id=`${id}-definition`;svg.setAttribute('aria-hidden','true');svg.style.cssText='position:absolute;width:0;height:0;pointer-events:none';
    // Owned, generated IDs and bitmap only. Never interpolate feature text into SVG.
    svg.innerHTML=`<defs><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="4.7619" intercept="0"/></feComponentTransfer><feComponentTransfer><feFuncA type="table" tableValues="0 .15625 .5 .84375 1"/></feComponentTransfer></filter><mask id="${this.maskId}" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1" style="mask-type:alpha"><image width="1" height="1" preserveAspectRatio="none" href="${canvas.toDataURL()}" filter="url(#${id})"/></mask></defs>`;
    document.body.append(svg);this.defs=svg;this.transfer=svg.querySelector('feFuncA')??undefined;
  }
  render(t:number,role:Role){
    if(this.disposed)return;
    if(reducedMotion())t=this.closing?0:1;
    this.progress=t;const content=this.content;
    if(reducedMotion()||t===0||t===1){
      this.node.style.removeProperty('--reveal');this.node.style.removeProperty('--frost-reveal');this.node.style.setProperty('--edge',t>0?'1':'0');
      this.node.style.visibility=t===0&&this.closing?'hidden':'';this.skin.style.visibility=this.frost.style.visibility=t===0?'hidden':'';
      if(content){content.style.opacity=t>0?'1':'0';content.style.removeProperty('filter');}
      if(t===1){this.defs?.remove();this.defs=undefined;this.patternSize='';this.node.inert=this.closing;}
      this.node.dataset.forming='false';return;
    }
    this.pattern();this.node.style.visibility='';this.skin.style.visibility=this.frost.style.visibility='';this.node.dataset.forming='true';
    this.transfer?.setAttribute('intercept',String((t-1)/.21));
    this.node.style.setProperty('--reveal',`url(#${this.maskId})`);this.node.style.setProperty('--frost-reveal',`url(#${this.maskId})`);
    this.node.style.setProperty('--edge',String(smooth((t-.4)/.6)));
    if(content){const delay=role==='large'?.5:role==='compact'?.08:0;const opacity=this.closing?this.contentOpacity:Math.max(this.contentOpacity,smooth((t-delay)/(1-delay)));content.style.opacity=String(opacity);content.style.filter=role==='popup'?'none':`blur(${(1-opacity)*3}px)`;}
  }
  destroy(){departures.get(this.node)?.cancel();this.disposed=true;this.observer.disconnect();this.mutation.disconnect();this.media.removeEventListener('change',this.changed);this.defs?.remove();this.skin.remove();this.frost.remove();surfaces.delete(this.node);}
}
export function surface(node:HTMLElement,options:SurfaceOptions={}){const glass=new Glass(node,options);surfaces.set(node,glass);return {update:(value:SurfaceOptions)=>glass.update(value),destroy:()=>glass.destroy()};}
export function surfaceMotion(node:HTMLElement,options:{role?:Role;skip?:boolean}={},direction:'in'|'out'='in'):TransitionConfig{
  const role=options.role??'compact',out=direction==='out',glass=surfaces.get(node);node.dataset.motion=role;
  glass?.begin(out);
  const duration=reducedMotion()||options.skip||out&&glass?.value===0?0:role==='large'?390:role==='popup'?120:170;
  const curve=(t:number)=>.7*(1-(1-t)**3)+.3*t;
  if(!duration)glass?.render(out?0:1,role);
  return {duration,easing:role==='popup'?(t=>t):out?(t=>1-curve(1-t)):curve,tick:t=>glass?.render(t,role)};
}
// Svelte's deferred form supplies the actual direction for every reversal and
// runs after actions install the material layers. Directive direction is 'both'.
export function mist(node:HTMLElement,options:{role?:Role;skip?:boolean}={}){
  return ({direction}:{direction:'in'|'out'}={direction:'in'})=>surfaceMotion(node,options,direction);
}

const departures=new WeakMap<HTMLElement,{cancel:()=>void}>();
function roots(host:HTMLElement){return host.classList.contains('ash-surface')?[host]:Array.from(host.querySelectorAll<HTMLElement>('.ash-surface')).filter(node=>!node.parentElement?.closest('.ash-surface'));}
export async function departComposition(host:HTMLElement|undefined){
  if(!host)return;
  await Promise.all(roots(host).map(node=>new Promise<void>(resolve=>{
    departures.get(node)?.cancel();const glass=surfaces.get(node);if(!glass){resolve();return;}
    const startValue=glass.value,role=(node.dataset.motion??'compact') as Role,config=surfaceMotion(node,{role},'out');
    const duration=(config.duration??0)*startValue,start=performance.now();let frame=0,done=false;
    const cancel=()=>{if(done)return;done=true;cancelAnimationFrame(frame);departures.delete(node);resolve();};departures.set(node,{cancel});
    function step(now:number){const p=duration?Math.min(1,(now-start)/duration):1;config.tick?.(startValue*(config.easing?.(1-p)??1-p),0);if(p<1)frame=requestAnimationFrame(step);else cancel();}
    if(!duration)step(start);else frame=requestAnimationFrame(step);
  })));
}
export function settleComposition(host:HTMLElement|undefined){if(!host)return;for(const node of roots(host)){departures.get(node)?.cancel();surfaces.get(node)?.begin(false);surfaces.get(node)?.render(1,'compact');}}
