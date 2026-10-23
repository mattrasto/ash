// Version 1: lossless grayscale PNGs, aligned with the source. Depth is relative
// inverse depth (larger = nearer); surfaces contain these categorical byte IDs.
export const MAP_VERSION=1;
export const SURFACES=[
  {id:0,key:'other',name:'Unclassified',color:[149,142,159]},
  {id:1,key:'terrain',name:'Terrain',color:[207,177,107]},
  {id:2,key:'vegetation',name:'Vegetation',color:[94,151,105]},
  {id:3,key:'water',name:'Water',color:[87,147,190]},
  {id:4,key:'structure',name:'Structures',color:[198,126,111]},
  {id:5,key:'sky',name:'Sky',color:[217,225,228]},
];
export function validateMapPixels(pixels,type){
  if(!['mask','depth','surfaces'].includes(type)||!pixels.length||pixels.length%4)throw new Error('Invalid scene map data.');
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i]!==pixels[i+1]||pixels[i]!==pixels[i+2]||pixels[i+3]!==255||(type==='surfaces'&&pixels[i]>=SURFACES.length))throw new Error(`The ${type} map contains invalid values.`);
  }
}
