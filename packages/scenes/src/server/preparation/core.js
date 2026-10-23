import {createHash} from 'node:crypto';
import {threadId} from 'node:worker_threads';
import sharp from 'sharp';
import {refineSkyMask} from './sky-mask.js';
import {refineHorizon,recoverSkyOpenings} from './horizon-refinement.js';
import {prepareDepth,prepareSurfaces} from './scene-maps.js';
import {refineWaterBoundaries} from './surface-refinement.js';
import {PREPARATION_LIMITS,RECIPE,RUNTIME_VERSION} from './constants.js';

function checkedSegments(segments,width,height){
  if(!Array.isArray(segments)||segments.length>256)throw new Error('Invalid local segmentation output.');
  for(const segment of segments){
    const mask=segment?.mask;
    if(typeof segment?.label!=='string'||segment.label.length>120||!mask||!(mask.data instanceof Uint8Array||mask.data instanceof Uint8ClampedArray)||mask.data.length!==width*height||mask.width!==undefined&&mask.width!==width||mask.height!==undefined&&mask.height!==height)throw new Error('Local segmentation is not aligned with the source.');
  }
  return segments;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const quantile=(sorted,fraction)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))]??0;
function geometry(rgb,sky,surfaces,depth,width,height){
  const n=width*height,samples=[];
  for(let column=0;column<Math.min(64,width);column++){
    const x=Math.round(column/Math.max(1,Math.min(64,width)-1)*(width-1));let edge=0;
    for(let y=0;y<height;y++)if(sky[y*width+x]>=128)edge=(y+1)/height;
    samples.push(edge);
  }
  const sorted=[...samples].sort((a,b)=>a-b),foreground=[],luminance=[],skySum=[0,0,0],landSum=[0,0,0];let skyWeight=0,landWeight=0;
  const stride=Math.max(1,Math.floor(n/100000));
  for(let i=0;i<n;i+=stride){
    const weight=sky[i]/255;skyWeight+=weight;landWeight+=1-weight;
    for(let c=0;c<3;c++){skySum[c]+=rgb[i*3+c]*weight;landSum[c]+=rgb[i*3+c]*(1-weight);}
    if(sky[i]<128){foreground.push(depth[i]);luminance.push((rgb[i*3]*.2126+rgb[i*3+1]*.7152+rgb[i*3+2]*.0722)/255);}
  }
  foreground.sort((a,b)=>a-b);luminance.sort((a,b)=>a-b);
  return {skyCoverage:sky.reduce((sum,value)=>sum+value/255,0)/n,surfaceCoverage:surfaces.coverage,
    horizon:{samples,median:quantile(sorted,.5),min:sorted[0]??0,max:sorted.at(-1)??0},
    foregroundDepth:{p10:quantile(foreground,.1),p50:quantile(foreground,.5),p90:quantile(foreground,.9)},
    palette:{sky:skySum.map(value=>Math.round(value/Math.max(1,skyWeight))),land:landSum.map(value=>Math.round(value/Math.max(1,landWeight)))},
    landLuminanceRange:[quantile(luminance,.1),quantile(luminance,.9)],framing:{mode:'cover',orientation:0}};
}

/** Called in the dedicated worker. Inference is injected at the semantic-model boundary. */
export async function prepareWithInference(source,inference,{models=[],injected=false,onProgress=()=>{}}={}){
  const started=performance.now(),bytes=Buffer.from(source);
  if(!bytes.length||bytes.length>PREPARATION_LIMITS.sourceBytes)throw new Error('Scene artwork must be a PNG no larger than 24 MiB.');
  onProgress('Reading artwork');
  const image=sharp(bytes,{limitInputPixels:PREPARATION_LIMITS.pixels,failOn:'warning'}),metadata=await image.metadata();
  if(metadata.format!=='png'||!metadata.width||!metadata.height||metadata.width>PREPARATION_LIMITS.dimension||metadata.height>PREPARATION_LIMITS.dimension||(metadata.pages??1)!==1||(metadata.orientation??1)!==1)throw new Error('Use a still, correctly oriented PNG no larger than four megapixels.');
  for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset);if(bytes.toString('ascii',offset+4,offset+8)==='acTL')throw new Error('Animated artwork is unsupported.');if(length>bytes.length-offset-12)break;offset+=length+12;}
  const {data,info:{width,height,channels}}=await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const rgb=Buffer.alloc(width*height*3);
  for(let i=0;i<width*height;i++){if(channels!==4||data[i*4+3]!==255)throw new Error('Scene artwork must have an opaque background.');rgb.set(data.subarray(i*4,i*4+3),i*3);}
  onProgress('Separating sky');
  const skySegments=checkedSegments(await inference.sky(new Uint8ClampedArray(rgb),width,height),width,height),sky=skySegments.find(item=>item.label==='sky');
  if(!sky)throw new Error('No reliable sky was detected; the current scene has been kept.');
  const coarse=Buffer.from(sky.mask.data),coverage=coarse.reduce((sum,value)=>sum+value/255,0)/(width*height);
  if(coverage<.005||coverage>.98)throw new Error('Sky separation is uncertain; the current scene has been kept.');
  onProgress('Refining sky edges');
  const refined=await refineHorizon(rgb,coarse,width,height,async(pixels,w,h)=>checkedSegments(await inference.sky(pixels,w,h),w,h).find(item=>item.label==='sky')?.mask.data,onProgress);
  const mask=recoverSkyOpenings(rgb,refineSkyMask(rgb,refined.mask,width,height,{radius:2}),width,height);
  onProgress('Preparing surface map');
  const surfaceSegments=checkedSegments(await inference.surfaces(new Uint8ClampedArray(rgb),width,height),width,height);
  const coarseSurfaces=prepareSurfaces(rgb,mask,surfaceSegments,width,height);
  onProgress('Estimating relative depth');
  const values=await inference.depth(new Uint8ClampedArray(rgb),width,height);
  if(!(values instanceof Float32Array||values instanceof Float64Array))throw new Error('The local depth model returned an invalid tensor.');
  const depth=prepareDepth(values,mask,width,height);
  const surfaces=await refineWaterBoundaries(rgb,mask,coarseSurfaces.pixels,depth.pixels,width,height,async(pixels,w,h)=>checkedSegments(await inference.surfaces(pixels,w,h),w,h),onProgress);
  onProgress('Lifting baked shadows');
  const lifted=Buffer.from(rgb);
  for(let i=0;i<width*height;i++){
    const p=i*3,l=(rgb[p]*.2126+rgb[p+1]*.7152+rgb[p+2]*.0722)/255,gain=1+.48*Math.pow(1-Math.min(1,l/.8),2)*(1-mask[i]/255);
    for(let c=0;c<3;c++)lifted[p+c]=Math.min(255,Math.round(rgb[p+c]*gain));
  }
  onProgress('Packaging aligned scene assets');
  const png=(pixels,channels)=>sharp(pixels,{raw:{width,height,channels}}).png().toBuffer();
  const [maskPNG,candidatePNG,depthPNG,surfacesPNG]=await Promise.all([png(mask,1),png(lifted,3),png(depth.pixels,1),png(surfaces.pixels,1)]);
  const assets={source:bytes,mask:maskPNG,candidate:candidatePNG,depth:depthPNG,surfaces:surfacesPNG};
  if(Object.values(assets).some(asset=>asset.length>PREPARATION_LIMITS.assetBytes)||Object.values(assets).reduce((sum,asset)=>sum+asset.length,0)>PREPARATION_LIMITS.outputBytes)throw new Error('Prepared scene assets exceed their bounded storage size.');
  return {width,height,assets,geometry:geometry(rgb,mask,surfaces,depth.pixels,width,height),provenance:{recipe:RECIPE,sourceHash:digest(bytes),runtime:injected?'injected-test-inference':`transformers.js ${RUNTIME_VERSION} / CPU FP32`,models:injected?[]:models,durationMs:Math.round(performance.now()-started),
    diagnostics:{horizonCrops:refined.cropCount,shorelineCrops:surfaces.cropCount,correctedPixels:surfaces.correctedPixels,labels:skySegments.map(segment=>segment.label),surfaceLabels:surfaceSegments.map(segment=>segment.label),depthNormalization:depth.normalization,workerThreadId:threadId},
    warnings:['Baked cast-shadow edges remain; shadow lift also brightens dark vegetation.','Semantic boundaries are approximate; ambiguous water and foreground require verification.','Depth is relative inverse depth, not metres or recovered camera geometry.','Cover framing is proposed; verification must establish crop safety.']}};
}
