// Debug-only local overrides; immutable scene profiles remain the baseline.
import {writable} from 'svelte/store';
import type {SceneProfile, SceneLocation} from '../contracts.ts';
import {solarState} from '../timing.ts';
import {CLOUD_STYLE_DEFAULTS} from '../profile-defaults.ts';

// Renderer units remain compatible with saved bundles; presentation is uniformly 0–100%.
export const tuningRanges={daylight:100,amount:100,speed:100,shadowStrength:100,shadowSoftness:100,waterStrength:250,waterSpeed:200,waterReflections:100} as const;
export type TuningRange=keyof typeof tuningRanges;
export const cloudTuningKeys=['amount','speed','shadowStrength','shadowSoftness'] as const;
type CloudTuning=Partial<Pick<SceneProfile,typeof cloudTuningKeys[number]>>;
export type SceneOverrides=Partial<Pick<SceneProfile,TuningRange|'clouds'|'cloudStyle'|'cloudSeed'|'cloudShadows'|'water'>> & {cloudStyles?:Partial<Record<SceneProfile['cloudStyle'],CloudTuning>>};
export const tuningPercent=(key:TuningRange,value:number)=>Math.round(value/tuningRanges[key]*1000)/10;
export const tuningValue=(key:TuningRange,percent:number)=>percent*tuningRanges[key]/100;
export interface SceneTuning {enabled:boolean;open:boolean;drafts:Record<string,SceneOverrides>;time:number|null;cloudPosition:number|null}
export interface ScenePreview {id:string;name:string;profile:SceneProfile;waterAvailable:boolean;time:number;cloudPosition:number;reducedMotion:boolean}
const storageKey='ash-scene-debug-tuning-v2';
function readDrafts():Record<string,SceneOverrides>{
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)??'{}'),drafts:Record<string,SceneOverrides>={};
    for(const [id,raw] of Object.entries(saved)){
      if(!raw||typeof raw!=='object')continue;
      const value=raw as Record<string,unknown>,draft:SceneOverrides={};
      for(const key of Object.keys(tuningRanges) as TuningRange[]){const number=value[key];if(typeof number==='number'&&Number.isFinite(number)&&number>=0&&number<=tuningRanges[key])draft[key]=number;}
      for(const key of ['clouds','cloudShadows','water'] as const)if(typeof value[key]==='boolean')draft[key]=value[key];
      if(['soft','cumulus','cirrus-feathered','storm'].includes(String(value.cloudStyle)))draft.cloudStyle=value.cloudStyle as SceneProfile['cloudStyle'];
      if(value.cloudStyles&&typeof value.cloudStyles==='object'){
        const styles:NonNullable<SceneOverrides['cloudStyles']>={};
        for(const style of Object.keys(CLOUD_STYLE_DEFAULTS) as SceneProfile['cloudStyle'][]){
          const saved=(value.cloudStyles as Record<string,CloudTuning>)[style];
          if(!saved||typeof saved!=='object')continue;
          const valid:CloudTuning={};
          for(const key of cloudTuningKeys){const number=saved[key];if(typeof number==='number'&&Number.isFinite(number)&&number>=0&&number<=tuningRanges[key])valid[key]=number;}
          styles[style]=valid;
        }
        draft.cloudStyles=styles;
      }
      if(typeof value.cloudSeed==='number'&&Number.isSafeInteger(value.cloudSeed)&&value.cloudSeed>0&&value.cloudSeed<=2147483647)draft.cloudSeed=value.cloudSeed;
      drafts[id]=draft;
    }
    return drafts;
  }catch{return {};}
}
export const sceneTuning=writable<SceneTuning>({enabled:false,open:false,drafts:readDrafts(),time:null,cloudPosition:null});
export const scenePreview=writable<ScenePreview|null>(null);
export function tuningProfile(profile:SceneProfile,draft:SceneOverrides={}):SceneProfile{
  const {cloudStyles,...values}=draft,style=values.cloudStyle??profile.cloudStyle;
  return {...profile,...values,...(style===profile.cloudStyle?{}:CLOUD_STYLE_DEFAULTS[style]),...cloudStyles?.[style]};
}
export function tuneScene(id:string,changes:SceneOverrides){
  sceneTuning.update(state=>{
    const drafts={...state.drafts,[id]:{...state.drafts[id],...changes}};
    try{localStorage.setItem(storageKey,JSON.stringify(drafts));}catch{/* Live tuning still works without storage. */}
    return {...state,drafts};
  });
}
export function resetSceneTuning(id:string){
  sceneTuning.update(state=>{
    const drafts={...state.drafts};delete drafts[id];
    try{localStorage.setItem(storageKey,JSON.stringify(drafts));}catch{}
    return {...state,drafts,time:null,cloudPosition:null};
  });
}
export function localSceneMinutes(timestamp:number,location:SceneLocation):number{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:location.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(timestamp);
  return Number(parts.find(part=>part.type==='hour')?.value)*60+Number(parts.find(part=>part.type==='minute')?.value);
}
/** Scrub the selected city's current date; all effects share this astronomical clock. */
export function scrubbedSolar(minutes:number,reference:number,location:SceneLocation){
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:location.timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const parts=(timestamp:number)=>Object.fromEntries(formatter.formatToParts(timestamp).map(part=>[part.type,Number(part.value)]));
  const today=parts(reference),desired=Date.UTC(today.year!,today.month!-1,today.day!,0,minutes);
  let timestamp=desired;
  for(let i=0;i<3;i++){
    const local=parts(timestamp),shown=Date.UTC(local.year!,local.month!-1,local.day!,local.hour!,local.minute!,local.second!);
    const difference=desired-shown;timestamp+=difference;if(!difference)break;
  }
  return solarState(timestamp,location);
}
