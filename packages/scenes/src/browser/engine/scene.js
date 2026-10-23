import {SCENE_BASELINE,CLOUD_STYLE_DEFAULTS} from '../../profile-defaults.ts';
export const DEFAULTS={time:720,...SCENE_BASELINE,clouds:true,cloudStyle:'cumulus',cloudSeed:137,...CLOUD_STYLE_DEFAULTS.cumulus,cloudPosition:0,cloudSync:false,cloudShadows:true,water:true,waterPosition:0,motion:true,lift:true,stars:true,starBrightness:120,starGlow:true,constellations:true,meteors:true,view:'live',framing:'cover',orientation:0};
export const KEYS=[
  {time:0,gain:[.16,.23,.37],sky:[22,34,66],mix:.72},
  {time:270,gain:[.16,.23,.37],sky:[22,34,66],mix:.72},
  {time:360,gain:[.79,.69,.65],sky:[230,179,163],mix:.57,gradient:[[-65,-18,24],[8,8,0]]},
  {time:480,gain:[1,.98,.93],sky:[157,198,220],mix:.08},
  {time:720,gain:[1,1,1],sky:[157,198,220],mix:0},
  {time:960,gain:[1,.97,.91],sky:[158,199,221],mix:.08},
  {time:1080,gain:[.91,.72,.59],sky:[244,170,132],mix:.67,gradient:[[-80,-18,38],[6,12,0]]},
  {time:1170,gain:[.31,.36,.52],sky:[65,69,111],mix:.70,gradient:[[-8,-8,0],[24,9,6]]},
  {time:1260,gain:[.16,.23,.37],sky:[22,34,66],mix:.72},
  {time:1440,gain:[.16,.23,.37],sky:[22,34,66],mix:.72},
];
export const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function skyColorAt(key,y,horizon=1){
  if(!key.gradient)return key.sky;
  const t=clamp(y/Math.max(.1,horizon),0,1),blend=t*t*(3-2*t);
  return key.sky.map((color,i)=>color+key.gradient[0][i]*(1-blend)+key.gradient[1][i]*blend);
}
export function timeBlend(minutes){
  const t=((minutes%1440)+1440)%1440;
  let index=KEYS.findIndex((key,i)=>i<KEYS.length-1 && t>=key.time && t<KEYS[i+1].time);
  if(index<0)index=0;
  const fraction=(t-KEYS[index].time)/(KEYS[index+1].time-KEYS[index].time);
  return {index,mix:fraction*fraction*(3-2*fraction)};
}
export function clockLabel(minutes){const t=Math.floor(((minutes%1440)+1440)%1440);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;}
export function period(minutes){const t=((minutes%1440)+1440)%1440;return t<300?'Night':t<420?'Dawn':t<660?'Morning':t<900?'Midday':t<1050?'Afternoon':t<1140?'Sunset':t<1260?'Twilight':'Night';}
export function frameRect(sw,sh,vw,vh,mode='cover'){
  const scale=mode==='actual'?1:(mode==='cover'?Math.max(vw/sw,vh/sh):Math.min(vw/sw,vh/sh));
  const width=sw*scale,height=sh*scale;return {x:(vw-width)/2,y:(vh-height)/2,width,height};
}
// Backing resolution is independent of CSS framing; a large display still gets a full cover crop.
export function backingSize(width,height,deviceScale=1,maxPixels=8_294_400,maxEdge=4096){
  const scale=Math.min(2,Math.max(.1,deviceScale),maxEdge/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scale};
}
