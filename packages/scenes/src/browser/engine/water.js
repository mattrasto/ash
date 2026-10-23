import {clamp} from './scene.js';

const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export const waterPhase=settings=>((settings.waterPosition/100%1)+1)%1;
export const waterDriftRate=speed=>speed>0?.01+speed*.0008:0;
export const waterMoving=(settings,available,reduced=false)=>!!(available&&settings.view==='live'&&settings.water&&settings.motion&&!reduced&&settings.waterStrength>0&&settings.waterSpeed>0);

// A conservative interior mask: never infer water from its color. The distance
// field fades inward, so neither distortion nor filtering can move a shoreline.
export function prepareWater(surfaces,depth,sky,width,height){
  if(!surfaces||!depth||!sky)return null;
  const n=width*height;if([surfaces,depth,sky].some(p=>p.length!==n*4))throw new Error('Water maps are not aligned.');
  const distance=new Float32Array(n),histogram=new Uint32Array(256);
  let count=0,left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,p=i*4,water=surfaces[p]===3&&depth[p]>0&&sky[p+3]<32;
    if(water){distance[i]=Math.min(x+1,y+1,width-x,height-y);histogram[depth[p]]++;count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  if(count<Math.max(32,n*.0005))return null;
  const diagonal=Math.SQRT2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!distance[i])continue;
    if(x)distance[i]=Math.min(distance[i],distance[i-1]+1);
    if(y)distance[i]=Math.min(distance[i],distance[i-width]+1);
    if(x&&y)distance[i]=Math.min(distance[i],distance[i-width-1]+diagonal);
    if(x+1<width&&y)distance[i]=Math.min(distance[i],distance[i-width+1]+diagonal);
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const i=y*width+x;if(!distance[i])continue;
    if(x+1<width)distance[i]=Math.min(distance[i],distance[i+1]+1);
    if(y+1<height)distance[i]=Math.min(distance[i],distance[i+width]+1);
    if(x+1<width&&y+1<height)distance[i]=Math.min(distance[i],distance[i+width+1]+diagonal);
    if(x&&y+1<height)distance[i]=Math.min(distance[i],distance[i+width-1]+diagonal);
  }
  const percentile=f=>{let sum=0;for(let i=1;i<256;i++){sum+=histogram[i];if(sum>=count*f)return i;}return 255;};
  const low=percentile(.05),high=percentile(.95),w=right-left+1,h=bottom-top+1,pixels=new Uint8ClampedArray(w*h*4);
  const inset=Math.max(2,width/800),feather=Math.max(6,width/125);let interior=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y+top)*width+x+left,p=(y*w+x)*4;
    const alpha=smooth(inset,feather,distance[i]);if(alpha>0)interior++;
    pixels[p]=Math.round(alpha*255);
    pixels[p+1]=Math.round(clamp((depth[i*4]-low)/Math.max(8,high-low),0,1)*255);
    pixels[p+2]=distance[i]>0?255:0;pixels[p+3]=255;
  }
  if(interior<32)return null;
  return {x:left,y:top,width:w,height:h,pixels,coverage:count/n,sourceWidth:width,sourceHeight:height};
}

// Sample actual painted sky, excluding scenery; reflections therefore match the
// rendered palette even when daylight strength is zero or the source is imported.
export function sampleSkyPalette(pixels,mask,width,height,horizon){
  const compactMask=mask.length===width*height;
  const colors=[];
  for(const t of [0,.5,1]){
    const center=Math.round(height*horizon*t),radius=Math.max(2,Math.round(height*.025));
    let r=0,g=0,b=0,count=0;
    for(let y=Math.max(0,center-radius);y<Math.min(height,center+radius+1);y+=2)for(let x=0;x<width;x+=4){
      const pixel=y*width+x,p=pixel*4;if(mask[compactMask?pixel:p+3]<240)continue;
      r+=pixels[p];g+=pixels[p+1];b+=pixels[p+2];count++;
    }
    colors.push(count?[r/count,g/count,b/count]:colors.at(-1)||[157,198,220]);
  }
  return colors;
}

// Water geometry is bounded to effect resolution; artwork remains at its original dimensions.
export function waterArtworkRect(geometry,width,height){
  return {x:geometry.x/geometry.sourceWidth*width,y:geometry.y/geometry.sourceHeight*height,width:geometry.width/geometry.sourceWidth*width,height:geometry.height/geometry.sourceHeight*height};
}
