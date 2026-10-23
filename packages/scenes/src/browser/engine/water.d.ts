export interface WaterGeometry { x:number;y:number;width:number;height:number;pixels:Uint8ClampedArray;coverage:number;sourceWidth:number;sourceHeight:number }
export function prepareWater(surfaces:ArrayLike<number>|null,depth:ArrayLike<number>|null,sky:ArrayLike<number>|null,width:number,height:number):WaterGeometry|null;
export function waterPhase(settings:{waterPosition:number}):number;
export function waterDriftRate(speed:number):number;
export function sampleSkyPalette(pixels:ArrayLike<number>,mask:ArrayLike<number>,width:number,height:number,horizon:number):number[][];
export function waterArtworkRect(geometry:Pick<WaterGeometry,'x'|'y'|'width'|'height'|'sourceWidth'|'sourceHeight'>,width:number,height:number):{x:number;y:number;width:number;height:number};
