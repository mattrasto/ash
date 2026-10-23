import {cloudPlacement,cloudOpacity} from './clouds.js';
import {sunAltitude} from './stars.js';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

// Low-resolution, softened optical footprints are cached alongside cloud sprites.
export function cloudShadowMask({width,height,pixels},soft=true){
  const w=192,h=128;let alpha=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0;for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
      const sx=Math.min(width-1,Math.floor((x+(dx+.5)/3)*width/w)),sy=Math.min(height-1,Math.floor((y+(dy+.5)/3)*height/h));
      sum+=pixels[(sy*width+sx)*4+3];
    }alpha[y*w+x]=sum/9;
  }
  for(let pass=0;pass<(soft?3:1);pass++)for(const horizontal of [true,false]){
    const next=new Float32Array(alpha.length),radius=soft?8:1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let sum=0;for(let i=-radius;i<=radius;i++){const xx=horizontal?x+i:x,yy=horizontal?y:y+i;if(xx>=0&&xx<w&&yy>=0&&yy<h)sum+=alpha[yy*w+xx];}
      next[y*w+x]=sum/(radius*2+1);
    }alpha=next;
  }
  const out=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<alpha.length;i++)out[i*4+3]=alpha[i];
  return {width:w,height:h,pixels:out};
}

export function groundShadow(cloud,settings,width,height,horizon,phase){
  const {cloudStyle:style,time,daylight,amount,cloudShadows,shadowStrength}=settings;
  if(!cloudShadows||!['cumulus','soft'].includes(style))return null;
  const sun=sunAltitude(settings.solar),weight=(1-smooth(.08,.48,cloud.depth))*cloudOpacity(cloud,amount,style);
  // Keep a trace of the low sun through sunset, then dissolve into twilight.
  const opacity=weight*smooth(-7,-1,sun)*(.75+.25*smooth(0,25,sun))*daylight/100*shadowStrength/100*(style==='soft'?.6:1);
  if(opacity<.0001)return null;
  const r=cloudPlacement(width,height,cloud,phase,style,horizon,amount),near=1-cloud.depth;
  const low=1-smooth(0,50,sun),direction=-Math.sin((settings.solar.azimuth-settings.orientation)*Math.PI/180);
  // Project the cloud's vertical extent along the grazing sun direction. A
  // bounded cotangent gives long evening bands without a singularity at sunset.
  // This remains an artistic flat-plane projection, not recovered scene depth.
  const grazing=Math.max(0,1/Math.tan(Math.max(4,sun)*Math.PI/180)-1/Math.tan(53*Math.PI/180));
  const shear=direction*Math.min(6,grazing*.45);
  const w=r.width*1.15,h=r.width*.32*(1+low*.35),rotation=direction*Math.PI/10;
  const center=(r.x+r.width*.5-width*.5)*2.1+width*.5+direction*width*(.05+.13*low);
  return {x:center-w*.5,y:height*(horizon+.09+near*.15)-h*.5,width:w,height:h,rotation,shear,period:2.1*(width+r.width+width*.08),opacity};
}
