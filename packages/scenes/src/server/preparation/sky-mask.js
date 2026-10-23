// Extracted from design_experiments/fieldnotes abb4d21; generic recipe, no fixture coordinates.
function boxMean(input,width,height,radius){
  const horizontal=new Float32Array(input.length),out=new Float32Array(input.length);
  for(let y=0;y<height;y++){
    let sum=0;for(let x=0;x<=Math.min(radius,width-1);x++)sum+=input[y*width+x];
    for(let x=0;x<width;x++){
      horizontal[y*width+x]=sum/(Math.min(width-1,x+radius)-Math.max(0,x-radius)+1);
      if(x-radius>=0)sum-=input[y*width+x-radius];
      if(x+radius+1<width)sum+=input[y*width+x+radius+1];
    }
  }
  for(let x=0;x<width;x++){
    let sum=0;for(let y=0;y<=Math.min(radius,height-1);y++)sum+=horizontal[y*width+x];
    for(let y=0;y<height;y++){
      out[y*width+x]=sum/(Math.min(height-1,y+radius)-Math.max(0,y-radius)+1);
      if(y-radius>=0)sum-=horizontal[(y-radius)*width+x];
      if(y+radius+1<height)sum+=horizontal[(y+radius+1)*width+x];
    }
  }return out;
}

// Guided filtering aligns a coarse semantic mask with existing image edges.
// It does not invent a horizon or contain scene-specific coordinates.
export function refineSkyMask(rgb,mask,width,height,options={}){
  const n=width*height,r=options.radius??Math.max(4,Math.round(Math.max(width,height)/90));
  const l=new Float32Array(n),p=new Float32Array(n),ll=new Float32Array(n),lp=new Float32Array(n);
  for(let i=0;i<n;i++){l[i]=(rgb[i*3]*.2126+rgb[i*3+1]*.7152+rgb[i*3+2]*.0722)/255;p[i]=mask[i]/255;ll[i]=l[i]*l[i];lp[i]=l[i]*p[i];}
  const meanL=boxMean(l,width,height,r),meanP=boxMean(p,width,height,r),meanLL=boxMean(ll,width,height,r),meanLP=boxMean(lp,width,height,r);
  const a=new Float32Array(n),b=new Float32Array(n);
  for(let i=0;i<n;i++){a[i]=(meanLP[i]-meanL[i]*meanP[i])/(Math.max(0,meanLL[i]-meanL[i]**2)+.0003);b[i]=meanP[i]-a[i]*meanL[i];}
  const ma=boxMean(a,width,height,r),mb=boxMean(b,width,height,r),result=Buffer.alloc(n);
  for(let i=0;i<n;i++){const q=Math.max(0,Math.min(1,(ma[i]*l[i]+mb[i]-.2)/.6));result[i]=Math.round(q*q*(3-2*q)*255);}
  return result;
}
