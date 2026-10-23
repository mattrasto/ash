import {CONSTELLATIONS} from './constellation-data.js';
import {STAR_CATALOG} from './star-catalog.js';
import {projectStar,starOpacity,sunAltitude} from './stars.js';
const catalog=new Map(STAR_CATALOG.map(star=>[star[0],star]));

// Clip the guide, not its catalog endpoints. Otherwise one off-screen star
// removes an entire connection, or creates a false highlighted star at the edge.
export function clipConstellationSegment(a,b,width,height){
  const dx=b.x-a.x,dy=b.y-a.y;let start=0,end=1;
  for(const [p,q]of [[-dx,a.x],[dx,width-a.x],[-dy,a.y],[dy,height-a.y]]){
    if(p===0){if(q<0)return null;continue;}
    const t=q/p;if(p<0)start=Math.max(start,t);else end=Math.min(end,t);
    if(start>=end)return null;
  }
  const at=(point,t)=>({...point,x:a.x+dx*t,y:a.y+dy*t,clipped:t!==0&&t!==1});
  return {a:at(a,start),b:at(b,end)};
}

export function scenePointInFrame(x,y,r,width,height){
  if(x<r.x||y<r.y||x>r.x+r.width||y>r.y+r.height)return null;
  return {x:(x-r.x)/r.width*width,y:(y-r.y)/r.height*height,scale:width/r.width};
}

export function projectConstellations(settings,width,height,horizon,visibility=()=>1){
  const {solar,orientation,daylight,starBrightness}=settings,sun=sunAltitude(solar);
  if(!settings.stars||!settings.constellations||!starBrightness||!daylight||sun>=-2)return [];
  // An exploration guide has its own twilight fade. Individual star brightness
  // must not break the catalog pattern; the final cloud/terrain mask still clips it.
  const opacity=Math.min(1,starOpacity(1,45,sun)/starOpacity(1,45,-18)*daylight/100*starBrightness/120);
  if(opacity<.001)return [];
  const points=new Map();
  const project=id=>{
    if(points.has(id))return points.get(id);
    const star=catalog.get(id);if(!star)return null;
    const p=projectStar(star[1],star[2],solar,orientation,width,height,horizon,false);
    if(p)p.id=id;points.set(id,p);return p;
  };
  return CONSTELLATIONS.map(group=>{
    const segments=[];
    for(const line of group.lines)for(let i=1;i<line.length;i++){
      const a=project(line[i-1]),b=project(line[i]);
      const clipped=a&&b&&clipConstellationSegment(a,b,width,height);
      if(clipped)segments.push({...clipped,opacity});
    }
    // Use mask samples only to suppress fully hidden groups, not to discard
    // whole connections when their endpoint happens to sit behind a small cloud.
    const visible=segments.some(({a,b})=>{
      const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/12));
      for(let i=0;i<=steps;i++){const t=i/steps;if(visibility(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)>.02)return true;}
      return false;
    });
    return {id:group.id,name:group.name,segments,hull:constellationHull(segments),visible};
  }).filter(group=>group.segments.length&&group.visible);
}

export function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
}
export function constellationHull(segments){
  const points=[...new Map(segments.flatMap(({a,b})=>[a,b]).map(p=>[`${p.x},${p.y}`,p])).values()].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(points.length<3)return points;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=points=>{const out=[];for(const p of points){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out;};
  return [...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)];
}
function hullHit(hull,point){
  let inside=false,distance=Infinity,area=0;
  for(let i=0,j=hull.length-1;i<hull.length;j=i++){
    const a=hull[j],b=hull[i];distance=Math.min(distance,segmentDistance(point,a,b));
    area+=a.x*b.y-b.x*a.y;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return {inside,distance:inside?0:distance,area:Math.abs(area)/2};
}
export function hitConstellation(groups,point,radius,preferred=null){
  if(!point)return null;
  const hits=groups.map(group=>({id:group.id,...hullHit(group.hull||constellationHull(group.segments),point)}));
  const candidates=hits.filter(hit=>hit.distance<=radius).sort((a,b)=>Number(b.inside)-Number(a.inside)||(a.inside?a.area-b.area:a.distance-b.distance));
  const best=candidates[0],current=hits.find(hit=>hit.id===preferred);
  // Match the experiment: prefer an enclosing polygon and retain it through overlaps.
  if(current&&current.distance<=radius*1.25&&(!best?.inside||current.inside))return preferred;
  return best?.id||null;
}

export class ConstellationFocus{
  constructor(){this.candidate=null;this.dwell=0;this.active=null;this.levels=new Map();this.moving=false;}
  step(target,dt,{instant=false}={}){
    if(this.candidate!==target){this.candidate=target;this.dwell=0;}else this.dwell+=dt;
    this.active=target&&(instant||this.dwell>=.18)?target:null;
    if(this.active&&!this.levels.has(this.active))this.levels.set(this.active,0);
    this.moving=!!target&&!this.active;
    for(const [id,value]of this.levels){
      const goal=id===this.active?1:0,next=instant?goal:Math.max(0,Math.min(1,value+(goal?1:-1)*dt/.35));
      if(next===0&&!goal)this.levels.delete(id);else this.levels.set(id,next);
      if(next!==goal)this.moving=true;
    }
  }
}

export function constellationStroke(a,b,scale){
  const length=Math.hypot(b.x-a.x,b.y-a.y),gap=Math.min(.28,8*scale/length);
  const start=a.clipped?0:gap,end=b.clipped?0:gap;
  return {a:{x:a.x+(b.x-a.x)*start,y:a.y+(b.y-a.y)*start},b:{x:b.x-(b.x-a.x)*end,y:b.y-(b.y-a.y)*end}};
}
export function drawConstellation(ctx,group,opacity,scale){
  ctx.strokeStyle='#dbe2d2';ctx.lineCap='round';
  for(const {a,b,opacity:visibility}of group.segments){
    const stroke=constellationStroke(a,b,scale);
    // Nested translucent strokes approximate a quiet glow without an expensive blur.
    for(const [width,alpha]of [[7,.025],[4,.055],[2,.075]]){
      ctx.lineWidth=width*scale;ctx.globalAlpha=alpha*opacity*visibility;
      ctx.beginPath();ctx.moveTo(stroke.a.x,stroke.a.y);ctx.lineTo(stroke.b.x,stroke.b.y);ctx.stroke();
    }
    ctx.lineWidth=.8*scale;
    for(let i=0;i<8;i++){
      const t=i/8,u=(i+1)/8,p=stroke.a,q=stroke.b;
      ctx.globalAlpha=.28*opacity*visibility*(.91+.09*Math.sin(i*1.7+a.x));
      ctx.beginPath();ctx.moveTo(p.x+(q.x-p.x)*t,p.y+(q.y-p.y)*t);ctx.lineTo(p.x+(q.x-p.x)*u,p.y+(q.y-p.y)*u);ctx.stroke();
    }
  }
  const nodes=new Map();for(const {a,b,opacity:visibility}of group.segments)for(const point of [a,b]){
    if(point.clipped)continue;
    const old=nodes.get(point.id);if(!old||visibility>old.visibility)nodes.set(point.id,{point,visibility});
  }
  for(const {point,visibility}of nodes.values()){
    const radius=5*scale,glow=ctx.createRadialGradient(point.x,point.y,0,point.x,point.y,radius);
    glow.addColorStop(0,'#fff5df');glow.addColorStop(.25,'#f3efd4a0');glow.addColorStop(1,'#e1e7d600');
    ctx.globalAlpha=.26*opacity*visibility;ctx.fillStyle=glow;
    ctx.beginPath();ctx.ellipse(point.x,point.y,radius,radius,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=.55*opacity*visibility;ctx.fillStyle='#faf3df';
    ctx.beginPath();ctx.ellipse(point.x,point.y,1.05*scale,.98*scale,0,0,Math.PI*2);ctx.fill();
  }ctx.globalAlpha=1;
}
