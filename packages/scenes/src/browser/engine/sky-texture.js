// Extract the artwork's small paint marks without carrying its baked sky gradient
// into a new time of day. Mask-weighted means keep dark terrain out of sky edges.
export function skyTexture(rgba,mask,width,height){
  const compactMask=mask?.length===width*height;
  const stride=width+1,size=stride*(height+1),sum=new Float64Array(size),weight=new Float64Array(size);
  const radius=Math.max(2,Math.round(Math.max(width,height)/140));
  for(let y=0;y<height;y++){
    let rowSum=0,rowWeight=0;
    for(let x=0;x<width;x++){
      const pixel=y*width+x,p=pixel*4,w=mask?mask[compactMask?pixel:p+3]/255:0,i=(y+1)*stride+x+1;
      rowSum+=(rgba[p]*.2126+rgba[p+1]*.7152+rgba[p+2]*.0722)*w;rowWeight+=w;
      sum[i]=sum[i-stride]+rowSum;weight[i]=weight[i-stride]+rowWeight;
    }
  }
  const out=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pixel=y*width+x,p=pixel*4;if(!mask||mask[compactMask?pixel:p+3]===0)continue;
    const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
    const a=y0*stride+x0,b=y0*stride+x1,c=y1*stride+x0,d=y1*stride+x1;
    const total=weight[d]-weight[b]-weight[c]+weight[a];if(total<.01)continue;
    const mean=(sum[d]-sum[b]-sum[c]+sum[a])/total;
    const light=rgba[p]*.2126+rgba[p+1]*.7152+rgba[p+2]*.0722;
    out[y*width+x]=Math.max(-24,Math.min(24,light-mean));
  }
  return out;
}
