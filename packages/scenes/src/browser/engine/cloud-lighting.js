import {KEYS,timeBlend,skyColorAt,clamp} from './scene.js';
import {sunAltitude} from './stars.js';
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

// Cache a pigment-preserving shade mask, not a second cloud silhouette.
// Darker volume samples receive more ambient fill; bright rims receive none.
export function cloudShadeMask({width,height,pixels}){
  const out=new Uint8ClampedArray(pixels.length);
  for(let p=0;p<pixels.length;p+=4){
    const luminance=pixels[p]*.2126+pixels[p+1]*.7152+pixels[p+2]*.0722;
    out[p]=out[p+1]=out[p+2]=255;
    out[p+3]=pixels[p+3]*smooth(5,52,249-luminance);
  }
  return {width,height,pixels:out};
}

// Follow the lower surface of each formation, not its height in the sky.
// Local column depth retains scalloped bottoms; the whole-cloud gate excludes
// high side rims. Existing pigment variation modulates the reflected light.
export function cloudUndersideMask({width,height,pixels}){
  const out=new Uint8ClampedArray(pixels.length),tops=new Int32Array(width).fill(height),bottoms=new Int32Array(width).fill(-1);
  let top=height,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>32){tops[x]=Math.min(tops[x],y);bottoms[x]=y;top=Math.min(top,y);bottom=Math.max(bottom,y);}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4,t=(y-tops[x])/Math.max(1,bottoms[x]-tops[x]);
    const local=smooth(.42,.88,t),lower=smooth(.36,.70,(y-top)/Math.max(1,bottom-top));
    const luminance=pixels[p]*.2126+pixels[p+1]*.7152+pixels[p+2]*.0722;
    out[p]=out[p+1]=out[p+2]=255;
    out[p+3]=pixels[p+3]*local*lower*(.35+.65*smooth(5,52,249-luminance));
  }
  return {width,height,pixels:out};
}

export function cloudHorizonBounce(time,daylight,horizon,solar){
  const {index,mix}=timeBlend(time),altitude=sunAltitude(solar);
  const a=skyColorAt(KEYS[index],horizon,horizon),b=skyColorAt(KEYS[index+1],horizon,horizon);
  return {amount:.58*smooth(-9,-1,altitude)*(1-smooth(8,28,altitude))*daylight/100,
    color:a.map((v,i)=>Math.round(clamp((v*(1-mix)+b[i]*mix)*.84+255*.16,0,255)))};
}

// Artistic skylight: cool daytime fill and a warmer horizon bounce at dusk.
// Chroma is independent of luminance so Soft layers keeps its daytime value.
export function cloudAmbient(time,daylight,y,horizon,style,solar){
  const {index,mix}=timeBlend(time),strength=daylight/100;
  const altitude=sunAltitude(solar),day=smooth(6,35,altitude);
  const amount=(.28*smooth(-8,3,altitude)+.11*day+(style==='cumulus'?.08*day:0))*strength;
  const a=skyColorAt(KEYS[index],y,horizon),b=skyColorAt(KEYS[index+1],y,horizon);
  const lowA=skyColorAt(KEYS[index],horizon,horizon),lowB=skyColorAt(KEYS[index+1],horizon,horizon);
  const sky=a.map((v,i)=>(v*(1-mix)+b[i]*mix)*.4+(lowA[i]*(1-mix)+lowB[i]*mix)*.6);
  const luminance=sky[0]*.2126+sky[1]*.7152+sky[2]*.0722;
  const valueMix=.18+(1-day)*.22,reflection=.42+(1-day)*.26;
  const value=250*(1-valueMix)+luminance*valueMix;
  return {amount,color:sky.map(v=>Math.round(clamp(value+(v-luminance)*reflection,0,255)))};
}
