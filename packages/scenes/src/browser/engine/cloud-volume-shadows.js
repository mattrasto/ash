// Horizontal optical-depth slices of the same density used to draw the cloud.
// Their translated union projects thickness without shearing a front-view sprite.
export function volumeShadowSlices(density,width,height,depth){
  const slices=[],count=16,stride=width*depth;
  for(let layer=0;layer<count;layer++){
    const first=Math.floor(layer*height/count),last=Math.floor((layer+1)*height/count);
    const pixels=new Uint8ClampedArray(width*depth*4);let occupied=false;
    for(let z=0;z<depth;z++)for(let x=0;x<width;x++){
      let optical=0;for(let y=first;y<last;y++)optical+=density[y*stride+x*depth+z];
      const alpha=Math.round((1-Math.exp(-optical*.16))*255);
      pixels[(z*width+x)*4+3]=alpha;occupied||=alpha>0;
    }
    if(occupied)slices.push({width,height:depth,pixels,elevation:Math.max(0,.88-(first+last-1)/2/(height-1))});
  }
  return slices;
}

export function shadowSliceLayout(elevations,sun,style){
  const ratio=style==='soft'?.38:.58,span=.65;
  const layers=elevations.map(elevation=>({x:-.5-sun.x*elevation*ratio,z:-span/2-sun.z*elevation*ratio,width:1,height:span}));
  const left=Math.min(...layers.map(l=>l.x)),top=Math.min(...layers.map(l=>l.z));
  const right=Math.max(...layers.map(l=>l.x+l.width)),bottom=Math.max(...layers.map(l=>l.z+l.height));
  return {layers,left,top,width:right-left,height:bottom-top};
}
