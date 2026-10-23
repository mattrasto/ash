import {STAR_CATALOG} from './star-catalog.js';
const D=Math.PI/180,clamp=v=>Math.max(0,Math.min(1,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
// All astronomical projection consumes the same host solar state as lighting.
export function horizontal(ra,dec,solar){
  const latitude=solar.latitude*D,declination=dec*D,hour=(solar.localSiderealTime-ra)*D;
  const altitude=Math.asin(Math.sin(latitude)*Math.sin(declination)+Math.cos(latitude)*Math.cos(declination)*Math.cos(hour));
  const azimuth=Math.atan2(-Math.sin(hour)*Math.cos(declination),Math.sin(declination)*Math.cos(latitude)-Math.cos(declination)*Math.sin(latitude)*Math.cos(hour));
  return {altitude:altitude/D,azimuth:((azimuth/D)%360+360)%360};
}
export const sunAltitude=solar=>solar.altitude;
export function starOpacity(magnitude,altitude,sun,cloudAlpha=0){
  if(sun>=-2||altitude<=0)return 0;
  const limit=-1.5+7.3*smooth(2,18,-sun);
  const extinction=.16/(Math.sin(altitude*D)+.14)-.14;
  return smooth(-.7,.6,limit-magnitude-extinction)*(.25+.65*Math.exp(-.28*Math.max(0,magnitude)))*Math.exp(-extinction*.28)*smooth(0,2,altitude)*(1-clamp(cloudAlpha));
}
// The astronomical horizon lies beyond the hills, not halfway up their skyline.
// Ignore isolated mask outliers; the full sky mask still clips every star.
export function starHorizon(skyEdges){
  const edges=skyEdges.filter(Number.isFinite).sort((a,b)=>a-b);
  return clamp((edges[Math.floor((edges.length-1)*.95)]??.55)+.025);
}
export function projectStar(ra,dec,solar,orientation,width,height,horizon,clipToFrame=true){
  const {altitude,azimuth}=horizontal(ra,dec,solar),center=orientation;
  const delta=((azimuth-center+540)%360-180)*D;
  if(altitude<=0||Math.abs(delta)>(clipToFrame?52:89.9)*D)return null;
  const f=width/(2*Math.tan(52*D)),x=width*.5+f*Math.tan(delta),y=height*horizon-f*Math.tan(altitude*D)/Math.cos(delta);
  return !clipToFrame||x>=0&&x<=width&&y>=0&&y<=height?{x,y,altitude}:null;
}
export function drawStars(ctx,{solar,orientation,daylight,starBrightness=120,starGlow=true},width,height,horizon,clock){
  const sun=sunAltitude(solar);if(sun>=-2||daylight===0||starBrightness===0)return;
  const scale=width/1024;
  for(const [id,ra,dec,mag,bv]of STAR_CATALOG){
    const point=projectStar(ra,dec,solar,orientation,width,height,horizon);if(!point)continue;
    const opacity=starOpacity(mag,point.altitude,sun)*daylight/100*starBrightness/100;if(opacity<.008)continue;
    const twinkle=1+(.025+.035*(1-point.altitude/90))*Math.sin(clock*(1.2+id%7*.13)+id);
    const radius=(.44+.65*Math.exp(-.34*Math.max(0,mag)))*scale;
    const alpha=Math.min(1,opacity*twinkle),color=bv>1?'#fff0d5':bv<.2?'#dfeaff':'#f4f3e8';
    // A tiny optical halo on brighter points, composited through the same sky
    // and cloud masks as the core. No blur filter or oversized bloom buffer.
    if(starGlow&&mag<3.8){
      const reach=radius*3,glow=ctx.createRadialGradient(point.x,point.y,0,point.x,point.y,reach);
      glow.addColorStop(0,color);glow.addColorStop(.35,`${color}80`);glow.addColorStop(1,`${color}00`);
      ctx.globalAlpha=alpha*.10*smooth(3.8,1,mag);ctx.fillStyle=glow;
      ctx.beginPath();ctx.ellipse(point.x,point.y,reach,reach,0,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=alpha;ctx.fillStyle=color;
    ctx.beginPath();ctx.ellipse(point.x,point.y,radius,radius*(.9+(id%5)*.035),0,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}
