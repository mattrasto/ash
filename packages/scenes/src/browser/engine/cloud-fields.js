// Continuous sky layers. Noise repeats horizontally, so drift never exposes a sprite edge.
export const FIELD_TYPES=['cirrus-feathered','storm'];
export const FIELD_COVERAGES=[0,25,50,75,100];
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
function hash(x,y,seed){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,y,period,seed){
  const ix=Math.floor(x),iy=Math.floor(y),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy);
  const wrap=n=>((n%period)+period)%period;
  return lerp(lerp(hash(wrap(ix),iy,seed),hash(wrap(ix+1),iy,seed),u),lerp(hash(wrap(ix),iy+1,seed),hash(wrap(ix+1),iy+1,seed),u),v);
}
const fractal=(x,y,period,seed)=>noise(x,y,period,seed)*.55+noise(x*2,y*2,period*2,seed+17)*.28+noise(x*4,y*4,period*4,seed+43)*.12+noise(x*8,y*8,period*8,seed+91)*.05;

export function renderCloudField(style,seed,width=1024,height=512){
  const frames=FIELD_COVERAGES.map(()=>({width,height,pixels:new Uint8ClampedArray(width*height*4)}));
  const bend=hash(0,0,seed)*Math.PI*2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/(width-1),v=y/(height-1),perspective=-Math.log(1-v*.85)/1.897;
    const grain=(hash(x===width-1?0:x,y,seed)-.5)*7,p=(y*width+x)*4;
    let broad,fiber,tone;
    if(style==='cirrus-feathered'){
      // Bounded, mostly horizontal shear: no nested vertical warps that fold or
      // stretch tufts. Long strands and short feather marks share a quiet veil.
      const flow=perspective+.024*Math.sin(u*Math.PI*2+bend)+.012*Math.sin(u*Math.PI*4+bend*.7);
      broad=fractal(u*4,flow*5,4,seed+31);
      const strands=fractal(u*20,flow*85,20,seed+91);
      const tufts=fractal(u*90,flow*60,90,seed+117);
      const breaks=fractal(u*23,flow*28,23,seed+173);
      fiber=strands*.42+tufts*.42+breaks*.16;
      tone=246+(tufts-.5)*8;
    }else{
      const flow=perspective+.14*noise(u*4,perspective*3,4,seed+11);
      broad=fractal(u*5,flow*7,5,seed+31);
      fiber=fractal(u*16,flow*20,16,seed+71);
      tone=130+v*63+(broad-.5)*68+(fiber-.5)*25;
    }
    for(let i=1;i<frames.length;i++){
      const coverage=FIELD_COVERAGES[i]/100,dst=frames[i].pixels;
      let alpha;
      if(style==='cirrus-feathered'){
        const veil=smooth(.52-coverage*.18,.70-coverage*.18,broad);
        const body=smooth(.66-coverage*.24,.80-coverage*.24,broad);
        const feathers=smooth(.34,.66,fiber);
        alpha=coverage*(veil*.10+body*(.06+feathers*.77))*(1-smooth(.80,1,v)*.35);
      }else{
        // A full sky sheet gets optically thicker; coverage never lowers a bank.
        alpha=coverage===1?1:1-Math.exp(-coverage*(4+broad*3));
      }
      const color=style==='storm'?lerp(236,tone,coverage):tone;
      dst[p]=color+grain;dst[p+1]=color+(style==='storm'?5:1)+grain;dst[p+2]=color+(style==='storm'?12:0)+grain;dst[p+3]=clamp(alpha)*255;
    }
  }
  return frames;
}

export function fieldBlend(amount){
  const value=clamp(amount/100)*4,index=Math.min(3,Math.floor(value));
  return {index,mix:value-index};
}
export function fieldTiles(width,height,phase){
  const tileWidth=width*1.6,offset=((phase%1)+1)%1*tileWidth;
  return [{x:-offset,y:0,width:tileWidth,height},{x:tileWidth-offset,y:0,width:tileWidth,height}];
}
