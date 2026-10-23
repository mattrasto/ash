import {cloudPlacement,cloudOpacity} from './clouds.js';
import {sunAltitude} from './stars.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
// Artistic camera calibration. Relative inverse depth does not recover metres.
const FOCAL_SPAN=1.6,CAMERA_HEIGHT=1;
export const SURFACE_SHADOW_RESPONSE=[.2,1,.78,.24,.55,0];

function filteredDepth(depth,surfaces,width,height,cx,cy){
  const p=(cy*width+cx)*4,center=depth[p],material=surfaces[p];let total=0,weight=0;
  // Remove byte-sized contour steps before inverse-depth reconstruction. Reject
  // material boundaries and large depth jumps so near silhouettes stay separate.
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=width||y>=height)continue;
    const q=(y*width+x)*4,d=depth[q],delta=Math.abs(d-center);
    if(!d||surfaces[q]!==material||delta>=8)continue;
    const w=(1-delta/8)**2/(1+dx*dx+dy*dy);total+=d*w;weight+=w;
  }
  return total/weight;
}

export function shadowSun(solar,orientation=0){
  const altitude=sunAltitude(solar),direction=(solar.azimuth-orientation)*Math.PI/180;
  const slope=Math.min(6,1/Math.tan(Math.max(4,altitude)*Math.PI/180));
  return {x:Math.sin(direction)*slope,z:Math.cos(direction)*slope};
}

export function buildShadowReceivers(depth,surfaces,sky,width,height,horizon,maxEdge=512){
  const length=width*height*4;
  if(!depth||!surfaces||!sky||[depth,surfaces,sky].some(a=>a.length!==length))return null;
  const scale=Math.min(1,maxEdge/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),n=w*h;
  const x=new Float32Array(n),y=new Float32Array(n),z=new Float32Array(n),response=new Float32Array(n);
  let top=1,far=1,side=1,bottom=0;
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){
    const i=row*w+col,u=(col+.5)/w,v=(row+.5)/h;
    const sx=Math.min(width-1,Math.floor(u*width)),sy=Math.min(height-1,Math.floor(v*height)),p=(sy*width+sx)*4;
    if(!depth[p]||surfaces[p]===5||sky[p+3]>250)continue;
    const inverse=filteredDepth(depth,surfaces,width,height,sx,sy)/255,distance=1/(.085+.915*inverse);
    x[i]=(u-.5)*FOCAL_SPAN*distance;
    y[i]=clamp(CAMERA_HEIGHT+(horizon-v)*FOCAL_SPAN*height/width*distance,-2,2.4);
    // Match the artwork's atmospheric perspective: distance keeps moving shade,
    // but loses contrast rather than acquiring foreground-black blotches.
    const atmosphere=.45+.55*smooth(.03,.35,inverse);
    z[i]=distance;response[i]=(SURFACE_SHADOW_RESPONSE[surfaces[p]]??.2)*(1-sky[p+3]/255)*atmosphere;
    top=Math.max(top,y[i]);bottom=Math.min(bottom,y[i]);far=Math.max(far,z[i]);side=Math.max(side,Math.abs(x[i]));
  }
  const cloudHeight=Math.max(2.4,top+.4),gap=cloudHeight-bottom;
  // Bounds cover every receiver even at the capped grazing angle, avoiding
  // shadow cutoffs as the sun approaches the horizon.
  const bounds={left:-side-gap*6-2,right:side+gap*6+2,near:-gap*6-2,far:far+gap*6+2};
  return {width:w,height:h,x,y,z,response,cloudHeight,bounds,horizon,aspect:height/width};
}

export function cloudOnPlane(cloud,settings,receivers,phase){
  const {cloudStyle:style,time,daylight,amount,cloudShadows,shadowStrength}=settings;
  if(!cloudShadows||!shadowStrength||!['cumulus','soft'].includes(style))return null;
  const sun=sunAltitude(settings.solar);
  // Distant formations shade distant receivers too; foreground-only gating left
  // the back half of every scene permanently sunlit.
  const opacity=cloudOpacity(cloud,amount,style)*(1-.25*cloud.depth)*smooth(-7,-1,sun)*(.75+.25*smooth(0,25,sun))*daylight/100*(style==='soft'?.6:1);
  if(opacity<.0001)return null;
  const visible=cloudPlacement(1,receivers.aspect,cloud,phase,settings.cloudStyle,receivers.horizon,amount);
  // Anchor the shared cloud base, not the front silhouette's centre. The volume
  // slices supply height above this plane and create sunset elongation.
  const vertical=Math.max(.055,receivers.horizon*receivers.aspect-(visible.y+visible.height*.75));
  const z=(receivers.cloudHeight-CAMERA_HEIGHT)/(vertical*FOCAL_SPAN);
  const width=visible.width*FOCAL_SPAN*z;
  return {x:(visible.x+visible.width*.5-.5)*FOCAL_SPAN*z,z,width,
    period:visible.period*FOCAL_SPAN*z,opacity};
}

// Sample a shared cloud plane at each reconstructed receiver. Source-space
// coordinates are cached; no per-frame depth inference or geometry smoothing.
export function projectShadowPixels(receivers,field,fieldWidth,fieldHeight,solar,orientation,strength,out){
  const {x,y,z,response,bounds,cloudHeight}=receivers,sun=shadowSun(solar,orientation);
  const sx=(fieldWidth-1)/(bounds.right-bounds.left),sz=(fieldHeight-1)/(bounds.far-bounds.near);
  for(let i=0;i<response.length;i++){
    const p=i*4;out[p]=out[p+1]=out[p+2]=0;out[p+3]=0;if(!response[i])continue;
    const gap=cloudHeight-y[i];
    const u=(x[i]+gap*sun.x-bounds.left)*sx,v=(z[i]+gap*sun.z-bounds.near)*sz;
    if(u<0||v<0||u>=fieldWidth-1||v>=fieldHeight-1)continue;
    const ix=Math.floor(u),iy=Math.floor(v),tx=u-ix,ty=v-iy,k=(iy*fieldWidth+ix)*4+3,j=k+fieldWidth*4;
    const a=field[k]*(1-tx)+field[k+4]*tx,b=field[j]*(1-tx)+field[j+4]*tx;
    out[p+3]=(a*(1-ty)+b*ty)*response[i]*strength/100;
  }
  return out;
}
