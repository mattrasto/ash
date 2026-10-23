import {KEYS,timeBlend,frameRect,backingSize,clamp,DEFAULTS} from './scene.js';
import {gradeArtwork,lightingPath} from './grading.js';
import {interpolateSolarState} from '../../timing.ts';
import {cloudLayout,cloudPlacement,cloudOpacity} from './clouds.js';
import {fieldBlend} from './cloud-fields.js';
import {skyTexture} from './sky-texture.js';
import {drawStars,sunAltitude,starHorizon} from './stars.js';
import {scenePointInFrame,projectConstellations,hitConstellation,ConstellationFocus,drawConstellation} from './constellations.js';
import {cloudAmbient,cloudHorizonBounce} from './cloud-lighting.js';
import {groundShadow} from './cloud-shadows.js';
import {cloudPhase,cloudDriftRate} from './cloud-motion.js';
import {SkyEvents,drawMeteor} from './sky-events.js';
import {validateMapPixels} from './scene-maps.js';
import {buildShadowReceivers,cloudOnPlane,projectShadowPixels,shadowSun} from './depth-shadows.js';
import {shadowSliceLayout} from './cloud-volume-shadows.js';
import {prepareWater,sampleSkyPalette,waterMoving,waterDriftRate} from './water.js';
import {WaterRenderer} from './water-renderer.js';

const surface=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
export async function decodeImage(url,label='image'){const image=new Image();image.src=url;try{await image.decode();}catch{image.src='';throw new Error(`The ${label} asset could not be decoded.`);}return image;}
function releaseCanvases(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
  if(value instanceof HTMLCanvasElement){value.width=value.height=0;return;}
  if(typeof ImageBitmap!=='undefined'&&value instanceof ImageBitmap){value.close();return;}
  if(value instanceof Map){for(const item of value.values())releaseCanvases(item,seen);return;}
  if(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype)for(const item of Object.values(value))releaseCanvases(item,seen);
}
export class SceneRenderer {
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});
    if(!this.ctx)throw new Error('Scene canvas is unavailable.');
    this.settings={...DEFAULTS};this.phase=0;this.frame=0;this.last=0;this.metrics={frames:0,totalMs:0,samples:[]};this.disposed=false;this.paused=false;this.loadSequence=0;this.painted=false;this.lightingRequest=0;this.nativeRequest=0;
    this.listeners=new AbortController();const signal=this.listeners.signal;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced.addEventListener('change',()=>{this.last=0;this.events.active=null;if(this.reduced.matches)this.finishSolarTransition();this.request();},{signal});
    this.observer=new ResizeObserver(()=>{this.resize();this.request();});this.observer.observe(canvas.parentElement||canvas);
    document.addEventListener('visibilitychange',()=>{this.last=0;this.events.active=null;if(document.hidden){this.clearHover();this.finishSolarTransition();cancelAnimationFrame(this.frame);this.frame=0;}else this.request();},{signal});
    this.cloudCache=new Map();this.cloudPending=false;this.cloudError=false;
    canvas.dataset.cloudState='idle';
    this.events=new SkyEvents();
    this.focus=new ConstellationFocus();this.pointer=null;
    this.resize();
  }
  async load(scene){
    const sequence=++this.loadSequence;
    const decoded=await Promise.allSettled([decodeImage(scene.source,'source'),scene.mask?decodeImage(scene.mask,'sky mask'):null,scene.candidate?decodeImage(scene.candidate,'prepared candidate'):null,scene.depth?decodeImage(scene.depth,'depth map'):null,scene.surfaces?decodeImage(scene.surfaces,'surface map'):null]);
    const failed=decoded.find(result=>result.status==='rejected');
    if(failed){for(const result of decoded)if(result.status==='fulfilled'&&result.value)result.value.src='';throw failed.reason;}
    const [original,mask,candidate,depth,surfaces]=decoded.map(result=>result.value);
    try{
    if(this.disposed||sequence!==this.loadSequence)return false;
    if(original.naturalWidth!==scene.width||original.naturalHeight!==scene.height)throw new Error('Image dimensions do not match the scene manifest.');
    for(const image of [mask,candidate,depth,surfaces])if(image&&(image.naturalWidth!==scene.width||image.naturalHeight!==scene.height))throw new Error('Prepared assets are not aligned with the source.');
    let artSkyAlpha;
    for(const [image,type]of [[mask,'mask'],[depth,'depth'],[surfaces,'surfaces']])if(image){
      const c=surface(scene.width,scene.height),ctx=c.getContext('2d');try{
        ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;validateMapPixels(pixels,type);
        if(type==='mask'){artSkyAlpha=new Uint8Array(scene.width*scene.height);for(let i=0;i<artSkyAlpha.length;i++)artSkyAlpha[i]=pixels[i*4];}
      }finally{c.width=c.height=0;}
    }
    const scale=Math.min(1,1600/Math.max(scene.width,scene.height));
    const w=Math.round(scene.width*scale),h=Math.round(scene.height*scale);
    const draw=(image,width=w,height=h)=>{const c=surface(width,height);c.getContext('2d').drawImage(image,0,0,width,height);return c;};
    const source=draw(original,scene.width,scene.height),lifted=candidate?draw(candidate,scene.width,scene.height):source;
    let depthPixels,surfacePixels;
    if(depth){const c=draw(depth);depthPixels=c.getContext('2d').getImageData(0,0,w,h).data;c.width=c.height=0;}
    if(surfaces){const c=surface(w,h),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(surfaces,0,0,w,h);surfacePixels=ctx.getImageData(0,0,w,h).data;c.width=c.height=0;}
    let alpha,maskView;
    if(mask){
      maskView=draw(mask);alpha=surface(w,h);const context=alpha.getContext('2d');
      const pixels=maskView.getContext('2d').getImageData(0,0,w,h);
      for(let i=0;i<pixels.data.length;i+=4){pixels.data[i+3]=pixels.data[i];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;}
      context.putImageData(pixels,0,0);
      maskView.width=maskView.height=0;
    }
    // Decode and construct everything before replacing the live scene.
    const assets={source,lifted,artSkyAlpha,alpha,depthPixels,surfacePixels,w,h,sourceWidth:scene.width,sourceHeight:scene.height};
    const water=prepareWater(surfacePixels,depthPixels,alpha?.getContext('2d').getImageData(0,0,w,h).data,w,h);
    assets.water=water;
    let waterPass,waterError=false;
    if(water){
      try{
        waterPass=new WaterRenderer();waterPass.load(water);
        waterPass.onFailure=()=>{this.waterError=true;this.canvas.dispatchEvent(new Event('waterstate'));this.request();};
      }catch{waterPass?.dispose();waterPass=null;waterError=true;}
    }
    this.releaseScene();this.assets=assets;this.waterPass=waterPass;this.waterError=waterError;
    this.reflectionCloudLayer=null;
    this.depthShadowKey=null;this.depthLayer=null;
    this.frames=null;this.frameLift=null;this.cloudLayer=surface(w,h);this.cloudOcclusion=surface(w,h);this.cloudShade=surface(w,h);this.cloudBottom=surface(w,h);this.groundLayer=surface(w,h);this.starLayer=surface(w,h);this.events=new SkyEvents(this.settings.cloudSeed);this.phase=0;
    this.visibilityProbe=surface(128,128);this.probeContext=this.visibilityProbe.getContext('2d',{willReadFrequently:true});
    this.clearHover();this.request();return true;
    }finally{for(const image of [original,mask,candidate,depth,surfaces])if(image)image.src='';}
  }
  set(settings){if(this.disposed)return;if(settings.lift!==undefined&&settings.lift!==this.settings.lift){this.finishSolarTransition();this.lightingWorker?.terminate();this.lightingWorker=null;this.lightingWorkerError=false;}this.settings={...this.settings,...settings};if(this.settings.clouds)this.prepareClouds();this.request();}
  setSolar(solar,transition=true){
    if(this.disposed)return;
    if(!transition&&this.solarTransition&&this.solarTransition.to.timestamp===solar.timestamp)return;
    this.cancelSolarTransition();
    if(transition&&this.painted&&this.assets&&this.settings.solar&&!this.reduced.matches&&!this.paused&&!document.hidden){
      this.clearHover();
      this.solarTransition={from:this.settings.solar,to:solar,indices:new Set(lightingPath(this.settings.time,solar.lightingTime)),start:null,id:this.lightingRequest};
      this.canvas.dataset.sceneTransition='preparing';this.warmSolarTransition();
    }else{this.settings.solar=solar;this.settings.time=solar.lightingTime;}
    this.request();
  }
  cancelSolarTransition(){
    this.lightingRequest++;this.nativeRequest++;clearTimeout(this.nativeTimer);this.nativeIndices=null;this.lightingWorker?.postMessage({kind:'cancel'});this.solarTransition=null;this.canvas.dataset.sceneTransition='idle';
  }
  // Latest scrub wins; the reference-day cache makes the response immediate.
  scrubSolar(solar){
    if(this.disposed)return;
    if(this.solarTransition?.to.timestamp===solar.timestamp)return;
    if(this.settings.solar?.timestamp===solar.timestamp&&!this.solarTransition)return;
    if(!this.painted||!this.assets||!this.frames){this.setSolar(solar,false);return;}
    this.cancelSolarTransition();this.clearHover();
    this.solarTransition={from:this.settings.solar,to:solar,indices:new Set(lightingPath(solar.lightingTime,solar.lightingTime)),start:null,id:this.lightingRequest,instant:true};
    this.canvas.dataset.sceneTransition='preparing';this.warmSolarTransition();
  }
  finishSolarTransition(){const target=this.solarTransition?.to;this.cancelSolarTransition();if(target){this.settings.solar=target;this.settings.time=target.lightingTime;}}
  warmSolarTransition(){
    const transition=this.solarTransition;if(!transition||!this.frames)return;
    const missing=[...transition.indices].filter(index=>!this.frames[index]&&(!this.lightingWorker||!this.previewFrames?.[index]));
    if(missing.length&&!this.lightingWorker){
        // Unsupported/failed workers warm the path before movement, never during it.
        const base=this.settings.lift?this.assets.lifted:this.assets.source,original=base.getContext('2d').getImageData(0,0,base.width,base.height);
        for(const index of missing)this.renderFrame(index,original.data);
    }
    this.startSolarTransition();
  }
  startSolarTransition(){
    const transition=this.solarTransition;
    if(transition&&transition.start===null&&[...transition.indices].every(index=>this.previewFrames?.[index]||this.frames?.[index])){
      if(transition.instant)this.finishSolarTransition();else{transition.start=performance.now();this.canvas.dataset.sceneTransition='animating';this.requestNativeFrames(timeBlend(transition.to.lightingTime).index);}
      this.request();
    }
  }
  requestNativeFrames(index){
    const indices=[index,index+1].filter(key=>!this.frames?.[key]);
    if(!indices.length||!this.lightingWorker||indices.every(key=>this.nativeIndices?.includes(key)))return;
    clearTimeout(this.nativeTimer);this.nativeIndices=indices;const id=++this.nativeRequest;
    this.nativeTimer=setTimeout(()=>{if(!this.disposed&&id===this.nativeRequest)this.lightingWorker?.postMessage({kind:'render',id,indices});},100);
  }
  prepareLightingWorker(original){
    if(this.lightingWorker||this.lightingWorkerError)return;
    try{
      const worker=new Worker(new URL('./lighting-worker.js',import.meta.url),{type:'module'});this.lightingWorker=worker;
      this.canvas.dataset.lightingWorker='starting';
      worker.onmessage=({data})=>{
        if(worker!==this.lightingWorker||this.disposed){data.image?.close();return;}
        if(data.ready){this.canvas.dataset.lightingWorker='ready';return;}
        if(data.error){failed();return;}
        if(data.kind==='preview'){
          this.previewFrames[data.index]=data.image;this.previewPalettes[data.index]=data.palette;
          this.canvas.dataset.previewGradeFrames=String(this.previewFrames.filter(Boolean).length);this.startSolarTransition();this.request();
        }else if(data.id!==this.nativeRequest||!this.nativeIndices?.includes(data.index)||this.frames[data.index])data.image.close();
        else{this.frames[data.index]=data.image;this.skyPalettes[data.index]=data.palette;this.request();}
      };
      const failed=()=>{worker.terminate();if(this.lightingWorker===worker){this.lightingWorker=null;this.lightingWorkerError=true;this.canvas.dataset.lightingWorker='fallback';this.warmSolarTransition();}};
      worker.onerror=failed;
      const a=this.assets,mask=a.artSkyAlpha?.slice(),texture=this.artworkTexture.slice();
      worker.postMessage({kind:'init',source:original.data,mask,texture,width:original.width,height:original.height,horizon:a.horizon,starHorizon:a.starHorizon},[original.data.buffer,texture.buffer,...(mask?[mask.buffer]:[])]);
    }catch{this.lightingWorker?.terminate();this.lightingWorker=null;this.lightingWorkerError=true;this.canvas.dataset.lightingWorker='fallback';}
  }
  pause(paused=true){this.paused=paused;this.last=0;this.events.active=null;if(paused){this.clearHover();this.finishSolarTransition();}cancelAnimationFrame(this.frame);this.frame=0;this.request();}
  cancelLoad(){this.loadSequence++;}
  clearHover(){this.pointer=null;this.focus=new ConstellationFocus();this.canvas.dataset.constellationHover='';}
  hover(x,y){
    if(this.disposed)return;
    if(x==null&&!this.pointer&&!this.focus.levels.size&&!this.focus.moving)return;
    if(x==null||y==null)this.pointer=null;
    else if(this.nightVisible()&&!this.paused&&!document.hidden){const r=this.canvas.getBoundingClientRect();this.pointer={x:x-r.left,y:y-r.top};}
    else return;
    this.request();
  }
  releaseScene(){
    this.finishSolarTransition();this.lightingWorker?.terminate();this.lightingWorker=null;this.lightingWorkerError=false;this.painted=false;this.canvas.dataset.lightingWorker='idle';
    this.waterPass?.dispose();this.waterPass=null;
    for(const key of ['assets','frames','previewFrames','cloudLayer','cloudOcclusion','cloudShade','cloudBottom','groundLayer','starLayer','reflectionCloudLayer','depthLayer','shadowField','volumeFootprints','visibilityProbe']){releaseCanvases(this[key]);this[key]=null;}
    this.probeContext=null;this.clearHover();
    this.artworkTexture=null;this.sourceSkyPalette=null;this.skyPalettes=null;this.depthPixels=null;this.fieldContext=null;this.depthContext=null;this.footprintTime=null;this.depthShadowKey=null;
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.loadSequence++;cancelAnimationFrame(this.frame);this.frame=0;this.cloudWorker?.terminate();this.cloudWorker=null;this.listeners.abort();this.observer.disconnect();this.releaseScene();
    releaseCanvases(this.cloudCache);this.cloudCache.clear();releaseCanvases(this.shadowMasks);releaseCanvases(this.shadowSlices);this.cloudBank=null;this.shadowBank=null;this.ctx=null;this.canvas.width=this.canvas.height=0;
  }
  prepareClouds(){
    if(this.disposed)return;
    const {cloudStyle:style,cloudSeed:seed}=this.settings,key=`${style}:${seed}`;
    if(this.cloudKey===key)return;
    this.cloudKey=key;this.cloudWorker?.terminate();this.cloudError=false;
    if(this.cloudCache.has(key)){this.cloudBank=this.cloudCache.get(key);this.cloudPending=false;this.canvas.dataset.cloudState='ready';return;}
    this.cloudPending=true;this.cloudBank=null;
    this.canvas.dataset.cloudState='loading';
    const done=()=>{this.cloudPending=false;this.canvas.dataset.cloudState=this.cloudError?'error':'ready';this.canvas.dispatchEvent(new Event('cloudstate'));this.request();};
    try{
      const worker=new Worker(new URL('./cloud-worker.js',import.meta.url),{type:'module'});this.cloudWorker=worker;
      worker.onmessage=({data})=>{
        if(this.disposed||data.key!==this.cloudKey){worker.terminate();return;}
        if(data.error){this.cloudError=true;worker.terminate();done();return;}
        const decode=({width,height,pixels})=>{const c=surface(width,height);c.getContext('2d').putImageData(new ImageData(pixels,width,height),0,0);return c;};
        const sprites=data.sprites.map(decode),shades=data.shades.map(decode),undersides=data.undersides.map(decode),shadows=data.shadows.map(decode),shadowCores=data.shadowCores.map(decode);
        const volumes=data.volumes.map(layers=>layers.map(layer=>({elevation:layer.elevation,soft:decode(layer.soft),core:decode(layer.core)})));
        this.cloudBank={style,kind:data.kind,sprites,shades,undersides,shadows,shadowCores,volumes,layout:data.kind==='field'?null:cloudLayout(style,seed)};this.cloudCache.set(key,this.cloudBank);
        if(this.cloudCache.size>3){const oldest=this.cloudCache.keys().next().value;releaseCanvases(this.cloudCache.get(oldest));this.cloudCache.delete(oldest);}
        worker.terminate();done();
      };
      worker.onerror=()=>{if(this.disposed||key!==this.cloudKey)return;this.cloudError=true;worker.terminate();done();};
      worker.postMessage({key,style,seed});
    }catch{this.cloudError=true;done();}
  }
  resize(){
    if(this.disposed)return;const r=this.canvas.getBoundingClientRect(),width=Math.max(1,r.width),height=Math.max(1,r.height),backing=backingSize(width,height,devicePixelRatio||1);
    if(this.viewport?.width!==width||this.viewport?.height!==height||this.canvas.width!==backing.width||this.canvas.height!==backing.height)this.painted=false;
    this.viewport={width,height};if(this.canvas.width!==backing.width)this.canvas.width=backing.width;if(this.canvas.height!==backing.height)this.canvas.height=backing.height;this.dpr=backing.scale;
  }
  geometry(){
    if(!this.assets||!this.viewport)return null;
    const {width,height}=this.viewport,a=this.assets,artwork=frameRect(a.sourceWidth,a.sourceHeight,width,height,this.settings.framing);
    return {viewport:{width,height},backing:{width:this.canvas.width,height:this.canvas.height},nativeArt:{width:a.source.width,height:a.source.height},effects:{width:a.w,height:a.h},artwork,sourceCrop:{x:-artwork.x/artwork.width,y:-artwork.y/artwork.height,width:width/artwork.width,height:height/artwork.height}};
  }
  request(){if(!this.disposed&&!this.frame)this.frame=requestAnimationFrame(t=>this.tick(t));}
  nightVisible(){const s=this.settings;return s.stars&&s.daylight>0&&!!this.assets?.alpha&&!!s.solar&&sunAltitude(s.solar)<-2;}
  waterAvailable(){return !!this.assets?.water&&!!this.waterPass&&!this.waterPass.failed;}
  waterPresent(){return !!this.assets?.water;}
  tick(now){
    this.frame=0;
    if(this.disposed)return;
    const dt=this.last?Math.min(.1,(now-this.last)/1000):0;this.last=now;
    this.interactionDt=dt;
    const s=this.settings,animated=!this.paused&&!document.hidden&&!this.reduced.matches;
    if(this.solarTransition&&this.solarTransition.start!==null){
      const transition=this.solarTransition,t=animated?Math.max(0,Math.min(1,(now-transition.start)/1600)):1;
      s.solar=interpolateSolarState(transition.from,transition.to,t*t*(3-2*t));s.time=s.solar.lightingTime;
      if(t===1)this.finishSolarTransition();
    }
    if(animated&&s.motion&&!s.cloudSync&&s.clouds&&s.amount>0&&s.speed>0&&this.assets?.alpha){
      s.cloudPosition=(s.cloudPosition+dt*cloudDriftRate(s.speed,s.cloudStyle)*100)%100;
    }
    const movingWater=animated&&waterMoving(s,this.waterAvailable(),this.reduced.matches);
    if(movingWater)s.waterPosition=(s.waterPosition+dt*waterDriftRate(s.waterSpeed)*100)%100;
    this.phase=cloudPhase(s);
    this.events.advance(dt,{eligible:this.nightVisible(),moving:animated&&s.motion,meteors:s.meteors&&!this.reduced.matches});
    if(this.assets&&s.solar){
      const start=performance.now();this.draw();const duration=performance.now()-start;this.metrics.totalMs+=duration;this.metrics.frames++;this.metrics.samples.push(duration);if(this.metrics.samples.length>180)this.metrics.samples.shift();
      if(this.metrics.frames%60===0){const samples=[...this.metrics.samples].sort((a,b)=>a-b);this.canvas.dataset.paintMs=(this.metrics.totalMs/this.metrics.frames).toFixed(1);this.canvas.dataset.paintP95Ms=samples[Math.floor((samples.length-1)*.95)].toFixed(1);}
    }
    const moving=animated&&(this.focus.moving||this.solarTransition?.start!=null||movingWater||(s.motion&&((s.clouds&&s.amount>0&&s.speed>0&&this.assets?.alpha)||this.nightVisible())));
    if(moving)this.frame=requestAnimationFrame(t=>this.tick(t));else this.last=0;
  }
  prepareFrames(){
    const a=this.assets,base=this.settings.lift?a.lifted:a.source,w=a.w,h=a.h;
    const original=base.getContext('2d').getImageData(0,0,base.width,base.height);
    const mask=a.alpha?.getContext('2d').getImageData(0,0,w,h).data;
    // Native artwork grain remains fixed to source pixels; effect geometry stays independently bounded.
    this.artworkTexture=skyTexture(original.data,a.artSkyAlpha,base.width,base.height);
    const skyEdges=[];
    if(mask)for(let x=0;x<w;x+=16){for(let y=h-1;y>=0;y--){if(mask[(y*w+x)*4+3]>128){skyEdges.push(y/h);break;}}}
    skyEdges.sort((a,b)=>a-b);const horizon=skyEdges[Math.floor(skyEdges.length/2)]||.55;a.horizon=horizon;
    a.starHorizon=starHorizon(skyEdges);
    releaseCanvases(this.reflectionCloudLayer);
    if(a.water){const scale=Math.min(1,768/w);this.reflectionCloudLayer=surface(Math.round(w*scale),Math.max(1,Math.round(h*a.starHorizon*scale)));}
    a.skyBottom=Math.min(1,(skyEdges.at(-1)||.75)+.03);
    if(!a.receivers&&a.depthPixels&&a.surfacePixels&&mask)a.receivers=buildShadowReceivers(a.depthPixels,a.surfacePixels,mask,w,h,horizon);
    releaseCanvases(this.frames);releaseCanvases(this.previewFrames);this.frames=[];this.skyPalettes=[];this.previewFrames=[];this.previewPalettes=[];
    this.sourceSkyPalette=a.artSkyAlpha?sampleSkyPalette(original.data,a.artSkyAlpha,base.width,base.height,a.starHorizon):null;
    this.frameLift=this.settings.lift;
  }
  ensureFrames(index){
    if(!this.frames||this.frameLift!==this.settings.lift)this.prepareFrames();
    for(const key of Object.keys(this.frames).map(Number))if(key!==index&&key!==index+1&&!this.nativeIndices?.includes(key)&&!this.solarTransition?.indices.has(key)){releaseCanvases(this.frames[key]);delete this.frames[key];delete this.skyPalettes[key];}
    if(this.lightingWorker&&this.previewFrames[index]&&this.previewFrames[index+1]){
      if(!this.solarTransition)this.requestNativeFrames(index);
      if(this.solarTransition||!this.frames[index]||!this.frames[index+1])return {frames:this.previewFrames,palettes:this.previewPalettes};
    }
    const a=this.assets,base=this.settings.lift?a.lifted:a.source,w=base.width,h=base.height;
    let original;
    for(const i of [index,index+1])if(!this.frames[i]){
      original??=base.getContext('2d').getImageData(0,0,w,h);
      this.renderFrame(i,original.data);
    }
    if(original)this.prepareLightingWorker(original);
    this.canvas.dataset.artworkResolution=`${w}x${h}`;this.canvas.dataset.effectResolution=`${a.w}x${a.h}`;
    this.canvas.dataset.gradeCacheFrames=String(this.frames.filter(Boolean).length);
    return {frames:this.frames,palettes:this.skyPalettes};
  }
  renderFrame(index,source){
    const a=this.assets,base=this.settings.lift?a.lifted:a.source,w=base.width,h=base.height;
    const pixels=gradeArtwork(source,a.artSkyAlpha,this.artworkTexture,w,h,a.horizon,KEYS[index]);
    const canvas=surface(w,h);canvas.getContext('2d').putImageData(new ImageData(pixels,w,h),0,0);
    this.frames[index]=canvas;
    if(a.artSkyAlpha)this.skyPalettes[index]=sampleSkyPalette(pixels,a.artSkyAlpha,w,h,a.starHorizon);
  }
  draw(){
    const a=this.assets,s=this.settings,ctx=this.ctx;
    const geometry=this.geometry(),vw=geometry.viewport.width,vh=geometry.viewport.height,r=geometry.artwork;
    const geometryKey=JSON.stringify(geometry);if(geometryKey!==this.geometryKey){this.geometryKey=geometryKey;this.canvas.dataset.sceneGeometry=geometryKey;this.canvas.dataset.framing=s.framing;}
    // Work in CSS coordinates so backing-size rounding cannot distort artwork or move hit targets.
    ctx.setTransform(this.canvas.width/vw,0,0,this.canvas.height/vh,0,0);ctx.globalAlpha=1;ctx.fillStyle='#d8e0d5';ctx.fillRect(0,0,vw,vh);
    ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
    const draw=image=>ctx.drawImage(image,r.x,r.y,r.width,r.height);
    const base=s.lift?a.lifted:a.source;
    {
      const {index,mix}=timeBlend(s.time),{frames,palettes}=this.ensureFrames(index);
      draw(frames[index]);ctx.globalAlpha=mix;draw(frames[index+1]);ctx.globalAlpha=1-s.daylight/100;draw(base);ctx.globalAlpha=1;
      const hasClouds=s.clouds&&a.alpha&&s.amount>0&&this.cloudBank;
      if(hasClouds)this.drawClouds(index,mix);
      if(s.water&&this.waterAvailable()&&(s.waterStrength>0||s.waterReflections>0)){
        const light=s.daylight/100,palette=palettes[index].map((row,y)=>row.map((c,k)=>(c*(1-mix)+palettes[index+1][y][k]*mix)*light+this.sourceSkyPalette[y][k]*(1-light)));
        const water=this.waterPass.draw(frames,base,hasClouds?this.reflectionCloudLayer:null,s,index,mix,palette,a.starHorizon);
        const g=a.water;if(water)ctx.drawImage(water,r.x+g.x/a.w*r.width,r.y+g.y/a.h*r.height,g.width/a.w*r.width,g.height/a.h*r.height);
      }
      if(hasClouds&&s.cloudShadows&&this.cloudBank.kind==='sprites'){
        this.drawGroundShadows();ctx.globalCompositeOperation='multiply';draw(this.groundLayer);ctx.globalCompositeOperation='source-over';
      }
      if(this.nightVisible()){
        const sky=this.starLayer.getContext('2d');sky.clearRect(0,0,a.w,a.h);sky.globalCompositeOperation='source-over';
        drawStars(sky,s,a.w,a.h,a.starHorizon,this.events.clock);
        this.drawConstellations(sky,r,hasClouds);
        sky.globalAlpha=s.daylight/100;drawMeteor(sky,this.events.active,a.w,a.h);sky.globalAlpha=1;
        if(hasClouds){sky.globalCompositeOperation='destination-out';sky.drawImage(this.cloudOcclusion,0,0);}
        sky.globalCompositeOperation='destination-in';sky.drawImage(a.alpha,0,0);sky.globalCompositeOperation='source-over';draw(this.starLayer);
      }
      if(hasClouds)draw(this.cloudLayer);
    }
    if(!this.nightVisible())this.clearHover();
    ctx.restore();ctx.globalAlpha=1;
    this.painted=true;
  }
  drawConstellations(ctx,r,hasClouds){
    const a=this.assets,s=this.settings;
    if(!s.constellations||!s.starBrightness||this.paused){this.clearHover();return;}
    if(!this.pointer&&!this.focus.levels.size){this.focus.step(null,0,{instant:true});return;}
    const probe=this.probeContext,size=128;
    probe.globalCompositeOperation='copy';probe.drawImage(a.alpha,0,0,size,size);
    if(hasClouds){probe.globalCompositeOperation='destination-out';probe.drawImage(this.cloudOcclusion,0,0,size,size);}
    const pixels=probe.getImageData(0,0,size,size).data,crop=this.geometry().sourceCrop;
    const visible=(x,y)=>x<0||y<0||x>=a.w||y>=a.h||x/a.w<crop.x||x/a.w>crop.x+crop.width||y/a.h<crop.y||y/a.h>crop.y+crop.height?0:pixels[(Math.floor(y/a.h*size)*size+Math.floor(x/a.w*size))*4+3]/255;
    const groups=projectConstellations(s,a.w,a.h,a.starHorizon,visible);
    const point=this.pointer?scenePointInFrame(this.pointer.x,this.pointer.y,r,a.w,a.h):null;
    const target=point&&visible(point.x,point.y)>.2?hitConstellation(groups,point,60*a.w/r.width,this.focus.active):null;
    this.focus.step(target,this.interactionDt||0,{instant:this.reduced.matches});
    this.canvas.dataset.constellationHover=this.focus.active||'';
    for(const group of groups){const level=this.focus.levels.get(group.id);if(level)drawConstellation(ctx,group,level,a.w/r.width);}
  }
  drawGroundShadows(){
    const a=this.assets,s=this.settings,ctx=this.groundLayer.getContext('2d');
    if(this.shadowBank!==this.cloudBank||this.shadowSoftness!==s.shadowSoftness){
      releaseCanvases(this.shadowMasks);releaseCanvases(this.shadowSlices);releaseCanvases(this.volumeFootprints);
      this.shadowBank=this.cloudBank;this.shadowSoftness=s.shadowSoftness;
      this.shadowMasks=this.cloudBank.shadows.map((soft,i)=>{
        const mask=surface(soft.width,soft.height),m=mask.getContext('2d'),blend=s.shadowSoftness/100;
        m.globalAlpha=blend;m.drawImage(soft,0,0);m.globalCompositeOperation='lighter';
        m.globalAlpha=1-blend;m.drawImage(this.cloudBank.shadowCores[i],0,0);return mask;
      });
      this.shadowSlices=this.cloudBank.volumes.map(layers=>layers.map(layer=>{
        const mask=surface(layer.soft.width,layer.soft.height),m=mask.getContext('2d'),blend=s.shadowSoftness/100;
        m.globalAlpha=blend;m.drawImage(layer.soft,0,0);m.globalCompositeOperation='lighter';
        m.globalAlpha=1-blend;m.drawImage(layer.core,0,0);return {elevation:layer.elevation,mask};
      }));
      this.depthShadowKey=null;this.footprintTime=null;
    }
    if(a.receivers){this.drawDepthShadows();return;}
    this.depthShadowKey=null;ctx.clearRect(0,0,a.w,a.h);ctx.globalCompositeOperation='source-over';
    for(const cloud of this.cloudBank.layout){
      const r=groundShadow(cloud,s,a.w,a.h,a.horizon,this.phase);if(!r)continue;
      ctx.globalAlpha=r.opacity/(s.shadowStrength/100);
      // Long sunset footprints can remain visible after their cloud has left the
      // frame. Neighbouring periods keep that trailing shadow continuous at wrap.
      for(const offset of [-r.period,0,r.period]){
        ctx.save();ctx.translate(r.x+r.width/2+offset,r.y+r.height/2);ctx.rotate(r.rotation);ctx.transform(1,0,r.shear,1,0,0);
        ctx.drawImage(this.shadowMasks[cloud.sprite],-r.width/2,-r.height/2,r.width,r.height);ctx.restore();
      }
    }
    // Cap combined darkness at the selected strength, including overlaps.
    ctx.globalCompositeOperation='destination-in';ctx.globalAlpha=s.shadowStrength/100;ctx.fillStyle='#000';ctx.fillRect(0,0,a.w,a.h);
    ctx.globalAlpha=1;ctx.globalCompositeOperation='destination-out';ctx.drawImage(a.alpha,0,0);ctx.globalCompositeOperation='source-over';
  }
  drawDepthShadows(){
    const a=this.assets,s=this.settings,receivers=a.receivers,ctx=this.groundLayer.getContext('2d');
    const sunKey=[s.solar.altitude,s.solar.azimuth,s.orientation].join(':');
    const key=[sunKey,this.phase,s.amount,s.daylight,s.shadowStrength].join(':');if(key===this.depthShadowKey)return;
    this.depthShadowKey=key;
    if(!this.depthLayer){
      this.depthLayer=surface(receivers.width,receivers.height);this.depthContext=this.depthLayer.getContext('2d');
      this.depthPixels=this.depthContext.createImageData(receivers.width,receivers.height);
      this.shadowField=surface(768,512);this.fieldContext=this.shadowField.getContext('2d',{willReadFrequently:true});
    }
    const field=this.fieldContext,b=receivers.bounds,fw=this.shadowField.width,fh=this.shadowField.height;
    if(this.footprintTime!==sunKey){
      releaseCanvases(this.volumeFootprints);this.footprintTime=sunKey;
      const sun=shadowSun(s.solar,s.orientation);
      this.volumeFootprints=this.shadowSlices.map(slices=>{
        const layout=shadowSliceLayout(slices.map(slice=>slice.elevation),sun,s.cloudStyle);
        const scale=Math.min(256,640/Math.max(layout.width,layout.height));
        const image=surface(Math.ceil(layout.width*scale),Math.ceil(layout.height*scale)),m=image.getContext('2d');
        m.setTransform(scale,0,0,scale,-layout.left*scale,-layout.top*scale);
        for(let i=0;i<slices.length;i++){
          const layer=layout.layers[i];m.drawImage(slices[i].mask,layer.x,layer.z,layer.width,layer.height);
        }
        return {...layout,image};
      });
    }
    field.setTransform(1,0,0,1,0,0);field.clearRect(0,0,fw,fh);
    field.setTransform(fw/(b.right-b.left),0,0,fh/(b.far-b.near),-b.left*fw/(b.right-b.left),-b.near*fh/(b.far-b.near));
    let count=0;
    for(const cloud of this.cloudBank.layout){
      const r=cloudOnPlane(cloud,s,receivers,this.phase);if(!r)continue;count++;field.globalAlpha=r.opacity;
      const footprint=this.volumeFootprints[cloud.sprite];
      const left=r.x+footprint.left*r.width,top=r.z+footprint.top*r.width,w=footprint.width*r.width,h=footprint.height*r.width;
      const first=Math.floor((b.left-left-w)/r.period),last=Math.ceil((b.right-left)/r.period);
      // The visible sky contains distant clouds. Continue that same seeded plane
      // overhead, outside the camera, so near receivers can receive shade too.
      const depthPeriod=r.period*.4,near=Math.floor((b.near-top-h)/depthPeriod),far=Math.ceil((b.far-top)/depthPeriod);
      for(let row=near;row<=far;row++)for(let copy=first;copy<=last;copy++){
        field.drawImage(footprint.image,left+copy*r.period,top+row*depthPeriod,w,h);
      }
    }
    field.setTransform(1,0,0,1,0,0);field.globalAlpha=1;ctx.clearRect(0,0,a.w,a.h);
    if(!count)return;
    projectShadowPixels(receivers,field.getImageData(0,0,fw,fh).data,fw,fh,s.solar,s.orientation,s.shadowStrength,this.depthPixels.data);
    const coverage=[{hit:0,total:0},{hit:0,total:0}];
    for(let i=0;i<receivers.response.length;i++)if(receivers.response[i]){const band=coverage[Math.floor(i/receivers.width)>receivers.height*.75?1:0];band.total++;if(this.depthPixels.data[i*4+3]>1)band.hit++;}
    this.canvas.dataset.shadowCoverage=JSON.stringify({far:coverage[0].hit/Math.max(1,coverage[0].total),near:coverage[1].hit/Math.max(1,coverage[1].total)});
    this.depthContext.putImageData(this.depthPixels,0,0);ctx.drawImage(this.depthLayer,0,0,a.w,a.h);
    // Reapply the full-resolution skyline after upsampling the lighting buffer.
    ctx.globalCompositeOperation='destination-out';ctx.drawImage(a.alpha,0,0);ctx.globalCompositeOperation='source-over';
  }
  drawClouds(index,mix){
    const {w,h,alpha}=this.assets,s=this.settings,ctx=this.cloudLayer.getContext('2d');
    ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation='source-over';
    const strength=s.daylight/100;
    const exposure=1-strength+strength*(KEYS[index].gain[0]*(1-mix)+KEYS[index+1].gain[0]*mix);
    const {style,kind,sprites,shades,undersides,layout}=this.cloudBank;
    const shade=this.cloudShade.getContext('2d');shade.clearRect(0,0,w,h);
    const bottom=this.cloudBottom.getContext('2d');bottom.clearRect(0,0,w,h);
    if(kind==='field'){
      const blend=fieldBlend(s.amount),tileWidth=w*1.6,height=h*this.assets.skyBottom;
      for(let i=0;i<2;i++){
        ctx.globalAlpha=i?blend.mix:1-blend.mix;
        ctx.globalCompositeOperation=i?'lighter':'source-over';
        // One repeating fill samples across wraps; separate fractional tiles left
        // a one-pixel transparent seam that flashed blue as the sheet drifted.
        const sprite=sprites[blend.index+i],pattern=ctx.createPattern(sprite,'repeat-x');
        pattern.setTransform(new DOMMatrix([tileWidth/sprite.width,0,0,height/sprite.height,-this.phase*tileWidth,0]));
        ctx.fillStyle=pattern;ctx.fillRect(0,0,w,height);
      }
    }else for(const cloud of [...layout].reverse()){
      const opacity=cloudOpacity(cloud,s.amount,style);if(opacity<.001)continue;
      const r=cloudPlacement(w,h,cloud,this.phase,style,this.assets.horizon,s.amount);
      ctx.globalAlpha=opacity;ctx.save();
      ctx.translate(r.x,r.y);
      ctx.drawImage(sprites[cloud.sprite],0,0,r.width,r.height);ctx.restore();
      // Near bright cloud faces must occlude shading from clouds behind them.
      shade.globalAlpha=opacity;shade.globalCompositeOperation='destination-out';
      shade.drawImage(sprites[cloud.sprite],r.x,r.y,r.width,r.height);
      shade.globalCompositeOperation='source-over';shade.drawImage(shades[cloud.sprite],r.x,r.y,r.width,r.height);
      bottom.globalAlpha=opacity;bottom.globalCompositeOperation='destination-out';bottom.drawImage(sprites[cloud.sprite],r.x,r.y,r.width,r.height);
      bottom.globalCompositeOperation='source-over';bottom.drawImage(undersides[cloud.sprite],r.x,r.y,r.width,r.height);
    }
    // Optical coverage is independent of night tint; overcast cannot reveal stars.
    const occlusion=this.cloudOcclusion.getContext('2d');occlusion.clearRect(0,0,w,h);occlusion.drawImage(this.cloudLayer,0,0);
    if(kind==='sprites'){
      const ambient=cloudAmbient(s.time,s.daylight,0,this.assets.horizon,s.cloudStyle,s.solar);
      const gradient=shade.createLinearGradient(0,0,0,h*this.assets.horizon);
      for(const t of [0,.5,1])gradient.addColorStop(t,`rgb(${cloudAmbient(s.time,s.daylight,t*this.assets.horizon,this.assets.horizon,s.cloudStyle,s.solar).color.join(',')})`);
      shade.globalAlpha=1;shade.globalCompositeOperation='source-in';shade.fillStyle=gradient;shade.fillRect(0,0,w,h);
      ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=ambient.amount;ctx.drawImage(this.cloudShade,0,0);
    }
    ctx.globalCompositeOperation='destination-in';ctx.globalAlpha=.72+exposure*.28;ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    const tint=KEYS[index].sky.map((c,i)=>Math.round(c*(1-mix)+KEYS[index+1].sky[i]*mix));
    ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=clamp((1-exposure)*1.1,0,.92);
    ctx.fillStyle=`rgb(${tint.join(',')})`;ctx.fillRect(0,0,w,h);
    if(kind==='sprites'){
      const bounce=cloudHorizonBounce(s.time,s.daylight,this.assets.horizon,s.solar);
      bottom.globalAlpha=1;bottom.globalCompositeOperation='source-in';bottom.fillStyle=`rgb(${bounce.color.join(',')})`;bottom.fillRect(0,0,w,h);
      ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=bounce.amount;ctx.drawImage(this.cloudBottom,0,0);
    }
    ctx.globalAlpha=1;
    // Reflection directions can see clouds behind the visible skyline. Retain
    // the lit sky-only cloud layer before the terrain mask clips the camera view.
    if(this.reflectionCloudLayer&&s.water&&s.waterReflections>0){
      const layer=this.reflectionCloudLayer,reflection=layer.getContext('2d');reflection.globalCompositeOperation='copy';
      reflection.drawImage(this.cloudLayer,0,0,w,h*this.assets.starHorizon,0,0,layer.width,layer.height);
    }
    ctx.globalCompositeOperation='destination-in';ctx.drawImage(alpha,0,0);ctx.globalCompositeOperation='source-over';
  }
}
