import {get, writable} from 'svelte/store';
import {DEFAULT_LOCATION, SCENE_PHASES, validateLocation, type SceneLocation, type ScenePhase} from '../contracts.ts';

const phaseKey='ash-scene-phase-v1',locationKey='ash-scene-location-v1',anchorKey='ash-scene-phase-anchor-v1';
function saved<T>(key:string,read:(value:unknown)=>T,fallback:T):T {
  try{return typeof localStorage==='undefined'?fallback:read(JSON.parse(localStorage.getItem(key)??'null'));}catch{return fallback;}
}
export const scenePreferences=writable<{phase:ScenePhase;location:SceneLocation;phaseAnchor:number}>({
  phase:saved(phaseKey,value=>{if(!SCENE_PHASES.includes(value as ScenePhase))throw new Error();return value as ScenePhase;},'automatic'),
  location:saved(locationKey,validateLocation,{...DEFAULT_LOCATION}),
  phaseAnchor:saved(anchorKey,value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new Error();return value;},Date.now()),
});
export function setScenePhase(phase:ScenePhase){
  if(!SCENE_PHASES.includes(phase))return;
  const current=get(scenePreferences),phaseAnchor=phase===current.phase?current.phaseAnchor:Date.now();
  scenePreferences.set({...current,phase,phaseAnchor});
  try{localStorage.setItem(phaseKey,JSON.stringify(phase));localStorage.setItem(anchorKey,JSON.stringify(phaseAnchor));}catch{}
}
export function setSceneLocation(value:SceneLocation){
  const location=validateLocation(value);
  scenePreferences.update(current=>({...current,location}));
  try{localStorage.setItem(locationKey,JSON.stringify(location));}catch{}
}
export function currentScenePreferences(){return get(scenePreferences);}
export interface SceneNativeState {visible:boolean;suspended:boolean;now:string;timeZone:string}
export interface SceneNativeBridge {state():Promise<SceneNativeState>;onChange(callback:(state:SceneNativeState)=>void):()=>void}
