export interface FrameRect {x:number;y:number;width:number;height:number}
export function clockLabel(minutes:number):string;
export function frameRect(sourceWidth:number,sourceHeight:number,viewportWidth:number,viewportHeight:number,mode?:'contain'|'cover'|'actual'):FrameRect;
export function backingSize(width:number,height:number,deviceScale?:number,maxPixels?:number,maxEdge?:number):{width:number;height:number;scale:number};
