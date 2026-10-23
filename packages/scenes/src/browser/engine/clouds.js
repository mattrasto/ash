import {volumeShadowSlices} from './cloud-volume-shadows.js';
// Cached software volumes: broad forms, multi-scale erosion, then optical-depth lighting.
// The animation loop only composites these textures; it never rebuilds their noise.
export const SPRITE_TYPES=['soft','cumulus'];
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function hash(x,y,z,seed){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
const lerp=(a,b,t)=>a+(b-a)*t;
function noise(x,y,z,seed){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  let u=x-ix,v=y-iy,w=z-iz;u=u*u*(3-2*u);v=v*v*(3-2*v);w=w*w*(3-2*w);
  return lerp(lerp(lerp(hash(ix,iy,iz,seed),hash(ix+1,iy,iz,seed),u),lerp(hash(ix,iy+1,iz,seed),hash(ix+1,iy+1,iz,seed),u),v),lerp(lerp(hash(ix,iy,iz+1,seed),hash(ix+1,iy,iz+1,seed),u),lerp(hash(ix,iy+1,iz+1,seed),hash(ix+1,iy+1,iz+1,seed),u),v),w);
}
function fractal(x,y,z,seed){return noise(x,y,z,seed)*.53+noise(x*2.13,y*2.13,z*2.13,seed+17)*.27+noise(x*4.37,y*4.37,z*4.37,seed+43)*.14+noise(x*8.83,y*8.83,z*8.83,seed+91)*.06;}
function cellular(x,y,z,seed){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let distance=3;
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){
    const xx=ix+a,yy=iy+b,zz=iz+c,dx=x-xx-hash(xx,yy,zz,seed),dy=y-yy-hash(xx,yy,zz,seed+33),dz=z-zz-hash(xx,yy,zz,seed+79);
    distance=Math.min(distance,dx*dx+dy*dy+dz*dz);
  }
  return 1-clamp(Math.sqrt(distance));
}

function cloudLobes(style,seed){
  const rand=random(seed),lobes=[];
  const add=(x,y,z,rx,ry,rz)=>lobes.push({x,y,z,rx,ry,rz});
    const soft=style==='soft',count=soft?9:6+Math.floor(rand()*4),peak=.27+rand()*.45;
    for(let i=0;i<count;i++){
      const x=.17+i/(count-1)*.66+(rand()-.5)*.04;
      const profile=Math.exp(-(((x-peak)/.28)**2)),r=.075+rand()*.065;
      const ry=soft?.075+rand()*.065:.095+profile*(.1+rand()*.12);
      const y=soft?.51+(rand()-.5)*.16:.74-ry*.62;
      add(x,y,.43+rand()*.16,r*(soft?1.5:1.1),ry,.15+rand()*.13);
      if(!soft)add(x+r*.36,y-ry*.25,.35+rand()*.1,r*.7,ry*.7,.16);
    }
    if(!soft)add(.5,.73,.5,.34,.075,.23);
  return lobes;
}

export function renderCloud(style,seed,width=384,height=256){
  const W=112,H=80,D=36,stride=W*D,density=new Float32Array(W*H*D),light=new Float32Array(density.length);
  const lobes=cloudLobes(style,seed),soft=style==='soft';
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)for(let z=1;z<D-1;z++){
    const u=x/(W-1),v=y/(H-1),w=z/(D-1);let shape=-1;
    for(const b of lobes){const dx=(u-b.x)/b.rx,dy=(v-b.y)/b.ry,dz=(w-b.z)/b.rz;shape=Math.max(shape,1-dx*dx-dy*dy-dz*dz);}
    if(shape<-.25)continue;
    const f=fractal(u*7.5,v*6,w*5.5,seed);
    const billow=cellular(u*16,v*13,w*12,seed+107);
    const edge=shape*.7+(f-.52)*.9+(billow-.4)*.62-.08;
    const base=smooth(soft?-.10:-.035,soft?.4:.18,edge);
    const padding=smooth(.015,.07,u)*(1-smooth(.93,.985,u))*smooth(.015,.07,v)*(1-smooth(.93,.985,v));
    density[y*stride+x*D+z]=base*(.35+f*.65+billow*.35)*padding;
  }
  // Integrate toward the upper-left light through the volume, not just down the image.
  for(let y=1;y<H;y++)for(let x=1;x<W;x++)for(let z=1;z<D;z++){
    const p=y*stride+x*D+z,above=p-stride;
    light[p]=density[p]*.14+(light[above]*.28+light[above-D]*.32+light[above-1]*.2+light[above-D-1]*.2)*.985;
  }
  const pixels=new Uint8ClampedArray(width*height*4),ambient=soft?.72:.62;
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const gx=px/(width-1)*(W-1),gy=py/(height-1)*(H-1),ix=Math.min(W-2,Math.floor(gx)),iy=Math.min(H-2,Math.floor(gy)),tx=gx-ix,ty=gy-iy;
    let alpha=0,r=0,g=0,b=0;
    for(let z=1;z<D-1;z++){
      const p=iy*stride+ix*D+z;
      const sample=a=>lerp(lerp(a[p],a[p+D],tx),lerp(a[p+stride],a[p+stride+D],tx),ty);
      const d=sample(density);if(d<.004)continue;
      const a=(1-Math.exp(-d*(soft?.15:.30)))*(1-alpha),illum=ambient+(1-ambient)*Math.exp(-sample(light)*1.7);
      r+=a*(76+177*illum);g+=a*(89+163*illum);b+=a*(112+131*illum);alpha+=a;if(alpha>.995)break;
    }
    const p=(py*width+px)*4,grain=(hash(px,py,0,seed)-.5)*10;
    if(alpha>.001){pixels[p]=r/alpha+grain;pixels[p+1]=g/alpha+grain;pixels[p+2]=b/alpha+grain;pixels[p+3]=alpha*255;}
  }
  return {width,height,pixels,shadowSlices:volumeShadowSlices(density,W,H,D)};
}

export function cloudLayout(style,seed){
  const rand=random(seed+7103),count=16;
  return Array.from({length:count},(_,i)=>{
    const depth=i/(count-1),near=1-depth;
    const scale=style==='soft'?.40+near*.63:.13+near*.56;
    const center=i===0?.25+rand()*.5:rand()*1.5-.25;
    return {sprite:i%6,depth,x:(center+scale*.5+.04)/(1+scale+.08),
      base:.32+depth*.66+(rand()-.5)*.12,
      scale,rank:i===0?0:rand()*.7+depth*.3};
  });
}
export function cloudPlacement(width,height,cloud,phase,style,horizon=.55,amount=100){
  // Cumulus coverage grows opaque bodies instead of fading full-size ghosts in.
  const growth=style==='cumulus'?Math.sqrt(smooth(cloud.rank*.78,cloud.rank*.78+.22,clamp(amount/100))):1;
  const fullSize=width*cloud.scale,size=fullSize*growth,ratio=style==='soft'?.38:.58;
  const margin=width*.04,travel=width+fullSize+2*margin;
  const progress=((cloud.x+phase)%1+1)%1;
  const base=height*horizon*cloud.base;
  return {x:progress*travel-fullSize*.5-size*.5-margin,y:base-size*ratio*.75,width:size,height:size*ratio,period:travel};
}
export function cloudOpacity(cloud,amount,style){
  const coverage=clamp(amount/100);
  if(coverage===0)return 0;
  const visibility=style==='cumulus'?(coverage>cloud.rank*.78?1:0):smooth(cloud.rank*.78,cloud.rank*.78+.22,coverage);
  return visibility*(style==='soft'?.8:1)*(1-cloud.depth*.23);
}
