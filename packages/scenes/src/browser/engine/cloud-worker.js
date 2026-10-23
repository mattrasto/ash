import {renderCloud} from './clouds.js';
import {FIELD_TYPES,renderCloudField} from './cloud-fields.js';
import {cloudShadeMask,cloudUndersideMask} from './cloud-lighting.js';
import {cloudShadowMask} from './cloud-shadows.js';
self.onmessage=({data:{key,style,seed}})=>{
  try{
    const kind=FIELD_TYPES.includes(style)?'field':'sprites';
    const sprites=kind==='field'?renderCloudField(style,seed):Array.from({length:6},(_,i)=>renderCloud(style,seed+i*7919));
    const shades=kind==='sprites'?sprites.map(cloudShadeMask):[];
    const undersides=kind==='sprites'?sprites.map(cloudUndersideMask):[],shadows=kind==='sprites'?sprites.map(sprite=>cloudShadowMask(sprite)):[];
    const shadowCores=kind==='sprites'?sprites.map(sprite=>cloudShadowMask(sprite,false)):[];
    const volumes=kind==='sprites'?sprites.map(sprite=>sprite.shadowSlices.map(slice=>({elevation:slice.elevation,soft:cloudShadowMask(slice),core:cloudShadowMask(slice,false)}))):[];
    for(const sprite of sprites)delete sprite.shadowSlices;
    self.postMessage({key,kind,sprites,shades,undersides,shadows,shadowCores,volumes},[...sprites,...shades,...undersides,...shadows,...shadowCores,...volumes.flatMap(layers=>layers.flatMap(layer=>[layer.soft,layer.core]))].map(sprite=>sprite.pixels.buffer));
  }catch(error){self.postMessage({key,error:error.message});}
};
