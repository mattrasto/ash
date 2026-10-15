import type {RecordingFile} from '@ash/shared';
export interface Recorder {ready:Promise<void>;stop():Promise<RecordingFile|null>;discard():Promise<void>}
export function recordScreen(threadId:string,mic:boolean,onExternalStop:()=>void):Recorder {
  let id:string|undefined,recorder:MediaRecorder|undefined,cancelled=false,started=false,stopping:Promise<RecordingFile|null>|undefined;
  const startup=new AbortController();
  let display:MediaStream|undefined,audio:MediaStream|undefined,queue:Promise<void>=Promise.resolve(),writeError:unknown,pendingChunks=0;
  let resolveStopped!:()=>void;const stopped=new Promise<void>(resolve=>resolveStopped=resolve);
  const release=()=>{for(const stream of [display,audio])stream?.getTracks().forEach(track=>track.stop());};
  async function acquire(request:Promise<MediaStream>){
    let abort!:()=>void;
    try{return await Promise.race([request.then(stream=>{
      if(cancelled){stream.getTracks().forEach(track=>track.stop());throw Error('Recording cancelled.');}
      return stream;
    }),new Promise<never>((_resolve,reject)=>{
      abort=()=>reject(Error('Recording cancelled.'));startup.signal.addEventListener('abort',abort,{once:true});
      if(startup.signal.aborted)abort();
    })]);}finally{startup.signal.removeEventListener('abort',abort);}
  }
  const ready=(async()=>{
    try {
      const capture=await window.ashRecording.begin(threadId,mic);id=capture.id;
      if(cancelled)throw Error('Recording cancelled.');
      display=await acquire(navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:30}},audio:false}));
      if(cancelled)throw Error('Recording cancelled.');
      if(mic)try{audio=await acquire(navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}}));}catch{}
      if(cancelled)throw Error('Recording cancelled.');
      const stream=new MediaStream([...display.getVideoTracks(),...(audio?.getAudioTracks()??[])]);
      const mimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:6_000_000,audioBitsPerSecond:96_000});
      recorder.addEventListener('dataavailable',event=>{if(!event.data.size)return;pendingChunks++;if(pendingChunks>8){writeError=Error('Recording storage is not keeping up.');release();if(recorder?.state==='recording')recorder.stop();onExternalStop();}queue=queue.then(async()=>{const bytes=await event.data.arrayBuffer();await window.ashRecording.append(id!,bytes);}).catch(error=>{writeError=error;release();if(recorder?.state==='recording')recorder.stop();onExternalStop();}).finally(()=>pendingChunks--);});
      recorder.addEventListener('stop',()=>{release();resolveStopped();},{once:true});
      recorder.addEventListener('error',()=>{writeError=Error('Recording was interrupted.');release();resolveStopped();onExternalStop();},{once:true});
      display.getVideoTracks()[0]?.addEventListener('ended',onExternalStop,{once:true});
      recorder.start(1000);await window.ashRecording.ready(id,!!audio);started=true;
    }catch(error){release();if(recorder?.state==='recording')recorder.stop();if(id)await window.ashRecording.discard(id).catch(()=>{});throw error;}
  })();
  const stop=():Promise<RecordingFile|null>=>{
    if(stopping)return stopping;
    stopping=(async()=>{if(!started){await discard();return null;}await ready;if(recorder?.state!=='inactive')recorder!.stop();release();await stopped;await queue;if(!id)throw Error('Recording did not start.');return window.ashRecording.finish(id,!!writeError);})();return stopping;
  };
  async function discard(){cancelled=true;startup.abort();release();if(recorder?.state==='recording')recorder.stop();await ready.catch(()=>{});await queue;if(id)await window.ashRecording.discard(id).catch(()=>{});}
  return {ready,stop,discard};
}
