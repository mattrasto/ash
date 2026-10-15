import type {AttachmentView} from './attachments.ts';
export interface RecordingFile {id:string;threadId:string;filename:string;size:number;createdAt:string;incomplete:boolean}
export interface RecordingState {id:string;threadId:string;source:string;phase:'starting'|'recording'|'finishing';mic:boolean;elapsedMs:number;remainingMs:number;warning:boolean}
export type RecordingControl='stop'|'discard';
export interface RecordingBridge {
  begin(threadId:string,mic:boolean):Promise<{id:string}>;
  ready(id:string,mic:boolean):Promise<void>;
  append(id:string,bytes:ArrayBuffer):Promise<void>;
  finish(id:string,incomplete?:boolean):Promise<RecordingFile>;
  discard(id:string):Promise<void>;
  extend(id:string):Promise<void>;
  upload(id:string):Promise<AttachmentView>;
  save(id:string):Promise<'saved'|'cancelled'>;
  recover():Promise<RecordingFile[]>;
  onControl(callback:(control:RecordingControl)=>void):()=>void;
  onState(callback:(state:RecordingState|null)=>void):()=>void;
  control(action:'stop'|'discard'|'extend'):void;
  move(phase:'start'|'move'|'end',screenX:number,screenY:number):void;
}
