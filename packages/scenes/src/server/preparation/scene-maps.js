// Extracted from design_experiments/fieldnotes abb4d21; generic recipe, no fixture coordinates.
import {SURFACES} from './constants.js';
import {refineSkyMask} from './sky-mask.js';

const labels={
  terrain:['grass','mountain','earth','field','sand','rock','road','hill','land','path','dirt track'],
  vegetation:['tree','plant','palm','flower'],
  water:['water','sea','river','lake','waterfall','swimming pool'],
  structure:['building','house','wall','fence','bridge','tower','skyscraper','hovel','pier'],
};
export const surfaceForLabel=label=>SURFACES.find(s=>labels[s.key]?.includes(label))?.id||0;
export function surfaceCoverage(pixels){
  const counts=Array(6).fill(0);for(const id of pixels)counts[id]++;
  return Object.fromEntries(SURFACES.map(s=>[s.key,counts[s.id]/pixels.length]));
}

export function prepareSurfaces(rgb,sky,segments,width,height){
  const n=width*height;
  if(rgb.length!==n*3||sky.length!==n)throw new Error('Surface inputs do not match the source dimensions.');
  const groups=Array.from({length:5},()=>Buffer.alloc(n));
  for(const {label,mask}of segments){
    if(label==='sky')continue;
    if(mask.data.length!==n)throw new Error('Surface segmentation dimensions do not match the source.');
    const group=groups[surfaceForLabel(label)];
    for(let i=0;i<n;i++)group[i]=Math.max(group[i],mask.data[i]);
  }
  // Refine each material separately; never infer water from blue pixel color.
  const refined=groups.map(mask=>refineSkyMask(rgb,mask,width,height,{radius:3}));
  const out=Buffer.alloc(n);
  for(let i=0;i<n;i++){
    let id=0,score=0;
    if(sky[i]>=128)id=5;
    else for(let k=0;k<refined.length;k++)if(refined[k][i]>score){score=refined[k][i];id=k;}
    out[i]=id;
  }
  return {pixels:out,coverage:surfaceCoverage(out)};
}

export function prepareDepth(values,sky,width,height){
  const n=width*height;if(values.length!==n||sky.length!==n)throw new Error('Depth dimensions do not match the source.');
  const sample=[];const stride=Math.max(1,Math.floor(n/100000));
  for(let i=0;i<n;i++){
    if(!Number.isFinite(values[i]))throw new Error('Depth prediction contains invalid values.');
    if(i%stride===0&&sky[i]<128)sample.push(values[i]);
  }
  sample.sort((a,b)=>a-b);
  const low=sample[Math.floor(sample.length*.01)],high=sample[Math.min(sample.length-1,Math.floor(sample.length*.99))];
  if(!(high-low>1e-5))throw new Error('Depth prediction has insufficient range.');
  const pixels=Buffer.alloc(n);
  for(let i=0;i<n;i++)pixels[i]=sky[i]>=128?0:1+Math.round(Math.max(0,Math.min(1,(values[i]-low)/(high-low)))*254);
  return {pixels,normalization:{low,high,percentiles:[1,99],near:'white',units:'relative inverse depth',bits:8,sky:0}};
}
