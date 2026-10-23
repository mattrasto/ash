import type { SolarState } from '../../timing.ts';
export function horizontal(ra:number,dec:number,solar:SolarState):{altitude:number;azimuth:number};
export function sunAltitude(solar:SolarState):number;
export function starOpacity(magnitude:number,altitude:number,sun:number,cloudAlpha?:number):number;
export function projectStar(ra:number,dec:number,solar:SolarState,orientation:number,width:number,height:number,horizon:number,clipToFrame?:boolean):{x:number;y:number;altitude:number}|null;
