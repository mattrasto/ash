// Controlled semantic outputs for preparation boundary checks; never selected by the production adapter.
export async function createInference(){
  const segment=(pixels,width,height)=>{
    const masks=new Map(['sky','grass','tree','water'].map(label=>[label,new Uint8Array(width*height)]));
    for(let p=0;p<width*height;p++){
      const [r,g,b]=pixels.subarray(p*3,p*3+3);
      const label=b>180&&r>80?'sky':b>g*1.5?'water':g>r*1.8?'tree':'grass';
      masks.get(label)[p]=255;
    }
    return [...masks].map(([label,data])=>({label,mask:{data,width,height}}));
  };
  return {sky:async(...args)=>segment(...args),surfaces:async(...args)=>segment(...args),depth:async(_pixels,width,height)=>Float32Array.from({length:width*height},(_,i)=>1+Math.floor(i/width)/height+(i%width)/(width*10))};
}
