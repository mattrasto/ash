import {KEYS,clamp,skyColorAt,timeBlend} from './scene.js';

/** The same native-pixel recipe is used by still playback and worker warmup. */
export function gradeArtwork(source,mask,texture,width,height,horizon,key){
  const pixels=new Uint8ClampedArray(width*height*4);
  const rows=Array.from({length:height},(_,y)=>skyColorAt(key,y/height,horizon));
  const textureGain=Math.max(.24,key.gain.reduce((sum,g)=>sum+g,0)/3);
  for(let pixel=0;pixel<width*height;pixel++){
    const p=pixel*4,row=Math.floor(pixel/width),y=row/height,sky=mask?mask[pixel]/255:0;
    const light=(source[p]+source[p+1]+source[p+2])/3-185;
    for(let k=0;k<3;k++){
      const land=source[p+k]*key.gain[k];
      const color=rows[row][k]+light*.08+texture[pixel]*textureGain*1.15+(y-.22)*(key.mix>.4?22:0);
      pixels[p+k]=clamp(land*(1-sky*key.mix)+color*sky*key.mix,0,255);
    }
    pixels[p+3]=255;
  }
  return pixels;
}

export function lightingPath(from,to){
  const delta=((to-from+2160)%1440)-720,indices=new Set();
  for(let step=0;step<=Math.ceil(Math.abs(delta)/15);step++){
    const time=from+delta*step/Math.max(1,Math.ceil(Math.abs(delta)/15)),{index}=timeBlend(time);
    indices.add(index);indices.add(index+1);
  }
  return [...indices].filter(index=>KEYS[index]);
}
