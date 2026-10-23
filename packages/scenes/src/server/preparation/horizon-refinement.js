// Extracted from design_experiments/fieldnotes abb4d21; generic recipe, no fixture coordinates.
// Overlapping source-resolution crops give small skyline objects more model pixels.
// Coordinates come only from the coarse sky boundary, never from fixture landmarks.
export function horizonCrops(mask,width,height){
  const size=Math.min(width,height,Math.max(192,Math.min(512,Math.round(Math.min(width,height)/3))));
  const step=Math.max(1,Math.floor(size*.65),Math.ceil((width-size)/11)),crops=[];
  for(let left=0;;left=Math.min(width-size,left+step)){
    const edges=[];
    for(let x=left;x<left+size;x+=4)for(let y=0;y<height-1;y++){
      if(mask[y*width+x]>128&&mask[(y+1)*width+x]<=128){edges.push(y);break;}
    }
    if(edges.length){edges.sort((a,b)=>a-b);const center=edges[Math.floor(edges.length/2)];
      crops.push({left,top:Math.max(0,Math.min(height-size,Math.round(center-size*.48))),width:size,height:size});}
    if(left>=width-size)break;
  }
  return crops;
}

export async function refineHorizon(rgb,coarse,width,height,segment,progress=()=>{}){
  const crops=horizonCrops(coarse,width,height),sum=new Float32Array(width*height),weights=new Float32Array(width*height);
  for(let i=0;i<crops.length;i++){
    const c=crops[i],pixels=new Uint8ClampedArray(c.width*c.height*3);
    for(let y=0;y<c.height;y++)pixels.set(rgb.subarray(((y+c.top)*width+c.left)*3,((y+c.top)*width+c.left+c.width)*3),y*c.width*3);
    progress(`Inspecting horizon ${i+1}/${crops.length}`);
    const result=await segment(pixels,c.width,c.height);if(!result)continue;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const edge=Math.min(x+1,c.width-x,y+1,c.height-y),weight=Math.min(1,edge/(c.width*.2));
      const p=(c.top+y)*width+c.left+x;sum[p]+=result[y*c.width+x]*weight;weights[p]+=weight;
    }
  }
  const out=Buffer.from(coarse);
  for(let p=0;p<out.length;p++)if(weights[p]>.1)out[p]=Math.round(sum[p]/weights[p]);
  return {mask:out,cropCount:crops.length};
}

// Recover sky-colored openings in small skyline protrusions. Compare with sky
// on the same scanline; never turn similarly colored water or distant land into sky.
export function recoverSkyOpenings(rgb,mask,width,height){
  const out=Buffer.from(mask),edge=new Int32Array(width),radius=Math.max(12,Math.round(width*.04));
  for(let x=0;x<width;x++){edge[x]=height;for(let y=0;y<height;y++)if(mask[y*width+x]<128){edge[x]=y;break;}}
  for(let x=0;x<width;x++){
    const neighbors=Array.from(edge.subarray(Math.max(0,x-radius),Math.min(width,x+radius+1))).sort((a,b)=>a-b);
    const floor=neighbors[Math.floor(neighbors.length*.6)],top=edge[x];
    if(floor-top<3||floor-top>height*.06)continue;
    for(let y=top;y<floor;y++){
      const p=y*width+x;if(mask[p]>200)continue;
      const mean=[0,0,0];let count=0;
      for(let xx=Math.max(0,x-radius);xx<Math.min(width,x+radius);xx+=2){
        const q=y*width+xx;if(mask[q]<250)continue;
        for(let c=0;c<3;c++)mean[c]+=rgb[q*3+c];count++;
      }
      if(count<6)continue;for(let c=0;c<3;c++)mean[c]/=count;
      const delta=mean.map((v,c)=>rgb[p*3+c]-v),distance=Math.hypot(...delta);
      // Matching chroma and brightness distinguish the hole from a blue shaded post.
      if(distance<32&&Math.abs(delta[2]-delta[0])<18){
        const confidence=Math.max(0,Math.min(1,(32-distance)/12));
        out[p]=Math.max(out[p],Math.round(confidence*255));
      }
    }
  }
  return out;
}
