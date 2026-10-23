import {KEYS} from './scene.js';
import {gradeArtwork} from './grading.js';
import {sampleSkyPalette} from './water.js';
let source,mask,texture,width,height,horizon,starHorizon,revision=0;
self.onmessage=async({data})=>{
  if(data.kind==='init'){
    ({source,mask,texture,width,height,horizon,starHorizon}=data);self.postMessage({ready:true});
    // Keep a small complete reference day for immediate input. Native frames are
    // requested separately after a scrub settles, never on the UI thread.
    const scale=Math.min(1,1280/width),w=Math.round(width*scale),h=Math.round(height*scale);
    const original=new OffscreenCanvas(width,height);original.getContext('2d').putImageData(new ImageData(source,width,height),0,0);
    const preview=new OffscreenCanvas(w,h),ctx=preview.getContext('2d');ctx.drawImage(original,0,0,w,h);original.width=original.height=0;
    const pixels=ctx.getImageData(0,0,w,h).data,smallMask=mask?new Uint8Array(w*h):null,smallTexture=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,q=Math.min(height-1,Math.floor((y+.5)/scale))*width+Math.min(width-1,Math.floor((x+.5)/scale));if(mask)smallMask[p]=mask[q];smallTexture[p]=texture[q];}
    for(let index=0;index<KEYS.length;index++){
      const graded=gradeArtwork(pixels,smallMask,smallTexture,w,h,horizon,KEYS[index]);
      ctx.putImageData(new ImageData(graded,w,h),0,0);const image=preview.transferToImageBitmap();
      self.postMessage({kind:'preview',index,image,palette:smallMask?sampleSkyPalette(graded,smallMask,w,h,starHorizon):null},[image]);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    preview.width=preview.height=0;return;
  }
  const current=++revision;
  if(data.kind==='cancel')return;
  try{
    for(const index of data.indices){
      if(current!==revision)return;
      const pixels=gradeArtwork(source,mask,texture,width,height,horizon,KEYS[index]);
      const palette=mask?sampleSkyPalette(pixels,mask,width,height,starHorizon):null;
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
      ctx.putImageData(new ImageData(pixels,width,height),0,0);
      const image=canvas.transferToImageBitmap();canvas.width=canvas.height=0;
      self.postMessage({id:data.id,index,image,palette},[image]);
      // A superseding request can cancel warmup between expensive native frames.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
