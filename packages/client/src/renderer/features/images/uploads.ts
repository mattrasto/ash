import type { AttachmentView } from '@ash/shared';
export interface DraftImage {id:string;filename:string;size:number;status:'uploading'|'ready'|'error';progress:number;error?:string;preview?:string;kind?:'image'|'video';captureId?:string;incomplete?:boolean;attachment?:AttachmentView;recordingDraft?:'pending'|'inserted'|'empty'|'error';recordingDraftError?:string;generatedDraft?:string;transcriptResultId?:string;framePreparing?:boolean;withoutFrames?:boolean}
export function uploadImage(id:string,file:File,onProgress:(fraction:number)=>void,onRequest:(xhr:XMLHttpRequest)=>void):Promise<AttachmentView> {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();onRequest(xhr);
    const video=file.type.startsWith('video/')||/\.(mp4|mov|webm)$/i.test(file.name);
    xhr.open('PUT',`/api/attachments/${id}`);xhr.timeout=video?240000:60000;
    xhr.setRequestHeader('content-type',video?'application/x-ash-video':'application/octet-stream');xhr.setRequestHeader('x-image-filename',encodeURIComponent(file.name));
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(event.loaded/event.total);};
    xhr.onerror=()=>reject(new Error('Upload disconnected. Retry without losing your draft.'));
    xhr.ontimeout=()=>reject(new Error('Upload timed out. Retry without losing your draft.'));
    xhr.onabort=()=>reject(new Error('Upload cancelled.'));
    xhr.onload=()=>{
      let value:AttachmentView&{error?:string};
      try{value=JSON.parse(xhr.responseText);}catch{reject(new Error('Upload failed. Please retry.'));return;}
      if(xhr.status<200||xhr.status>=300)reject(new Error(value.error??'Upload failed. Please retry.'));else resolve(value);
    };
    xhr.send(file);
  });
}
