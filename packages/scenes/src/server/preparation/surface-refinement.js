// Extracted from design_experiments/fieldnotes abb4d21; generic recipe, no fixture coordinates.
import {prepareSurfaces,surfaceCoverage} from './scene-maps.js';

// Inspect water/land boundaries at a larger model scale. The bounded crop grid
// derives entirely from semantic maps, including for imported scenes.
export function shorelineCrops(surfaces,width,height){
  const size=Math.min(width,height,Math.max(192,Math.min(512,Math.round(Math.min(width,height)/3))));
  const step=Math.max(1,Math.round(size*.6)),positions=length=>{
    const out=[];for(let p=0;;p=Math.min(length-size,p+step)){out.push(p);if(p===length-size)return out;}return out;
  };
  const candidates=[];
  for(const top of positions(height))for(const left of positions(width)){
    let edges=0;
    for(let y=top+Math.floor(size*.1);y<top+size*.9-3;y+=3)for(let x=left+Math.floor(size*.1);x<left+size*.9-3;x+=3){
      const p=y*width+x,a=surfaces[p];
      for(const b of [surfaces[p+3],surfaces[p+width*3]])if((a===3&&[1,2,4].includes(b))||(b===3&&[1,2,4].includes(a)))edges++;
    }
    if(edges)candidates.push({left,top,width:size,height:size,edges});
  }
  return candidates.sort((a,b)=>b.edges-a.edges).slice(0,12).map(({edges,...crop})=>crop);
}

export async function refineWaterBoundaries(rgb,sky,coarse,depth,width,height,segment,progress=()=>{}){
  const n=width*height;
  if(rgb.length!==n*3||[sky,coarse,depth].some(p=>p.length!==n))throw new Error('Shoreline inputs are not aligned.');
  const crops=shorelineCrops(coarse,width,height),weights=new Float32Array(n);
  const votes=[1,2,4].map(()=>new Float32Array(n));
  for(let i=0;i<crops.length;i++){
    const c=crops[i],pixels=new Uint8ClampedArray(c.width*c.height*3),mask=new Uint8Array(c.width*c.height);
    for(let y=0;y<c.height;y++){
      const p=(y+c.top)*width+c.left;
      pixels.set(rgb.subarray(p*3,(p+c.width)*3),y*c.width*3);mask.set(sky.subarray(p,p+c.width),y*c.width);
    }
    progress(`Inspecting shoreline ${i+1}/${crops.length}`);
    const segments=await segment(pixels,c.width,c.height);
    const local=prepareSurfaces(pixels,mask,segments,c.width,c.height).pixels;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const p=(y+c.top)*width+c.left+x;if(coarse[p]!==3||sky[p]>=128)continue;
      const weight=Math.min(1,Math.min(x+1,c.width-x,y+1,c.height-y)/(c.width*.2));
      weights[p]+=weight;
      const id=local[y*c.width+x],k=id===1?0:id===2?1:id===4?2:-1;if(k>=0)votes[k][p]+=weight;
    }
  }
  const proposal=new Uint8Array(n),baseline=new Float32Array(height).fill(NaN);
  for(let y=0;y<height;y++){
    const row=[];
    for(let x=0;x<width;x++){const p=y*width+x;if(coarse[p]===3&&depth[p])row.push(depth[p]);}
    row.sort((a,b)=>a-b);if(row.length>=16)baseline[y]=row[Math.floor(row.length*.2)];
  }
  for(let p=0;p<n;p++)if(weights[p]>.25){
    const best=Math.max(votes[0][p],votes[1][p],votes[2][p]);
    if(best/weights[p]>=.6)proposal[p]=best===votes[0][p]?1:best===votes[1][p]?2:4;
  }
  // Only shrink water where a locally recognized object touches known land and
  // depth corroborates a foreground protrusion. Reflected trees remain water.
  const out=Buffer.from(coarse),visited=new Uint8Array(n);let correctedPixels=0;
  for(let start=0;start<n;start++)if(proposal[start]&&!visited[start]){
    const group=[start];visited[start]=1;let land=false,support=0;
    for(let k=0;k<group.length;k++){
      const p=group[k],y=Math.floor(p/width),x=p%width;
      if(depth[p]>baseline[y]+8)support++;
      for(const q of [x?p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1])if(q>=0){
        if([1,2,4].includes(coarse[q]))land=true;
        if(proposal[q]&&!visited[q]){visited[q]=1;group.push(q);}
      }
    }
    if(land&&support>=Math.max(3,group.length*.25))for(const p of group){out[p]=proposal[p];correctedPixels++;}
  }
  return {pixels:out,coverage:surfaceCoverage(out),cropCount:crops.length,correctedPixels};
}
