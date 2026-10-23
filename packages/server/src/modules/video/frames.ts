import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import sharp from 'sharp';
import {VideoFrame,type VideoMetadata} from '@ash/shared';
import {ImageStorage,AttachmentError} from '../attachments/storage.ts';
import {mediaCommand} from '../attachments/video.ts';

/** Original playback timeline, evenly sampled; no extra semantic processing. */
export function frameTimes(start:number,end:number,count=4){return Array.from({length:count},(_,i)=>start+(end-start)*i/count);}
export async function extractFrames(storage:ImageStorage,id:string,source:VideoMetadata,times:number[],signal:AbortSignal):Promise<VideoFrame[]>{
  if(times.length>4||times.some(t=>!Number.isFinite(t)||t<0||t>=source.durationSeconds))throw new AttachmentError(400,'Choose up to four frame times inside this video.');
  const path=await storage.checkedFile(id,source.playback,signal),parent=join(storage.root,'..','video-temp');
  await mkdir(parent,{recursive:true,mode:0o700});const dir=await mkdtemp(join(parent,'video-frames-'));
  try{
    const probe=JSON.parse(await mediaCommand(ffprobe.path,['-v','error','-show_entries','format=start_time','-of','json',path],20000,signal));
    const offset=Number(probe.format?.start_time??0);if(!Number.isFinite(offset))throw new AttachmentError(400,'The video timeline is unavailable.');
    const frames:VideoFrame[]=[];
    for(const time of [...new Set(times)]){
      signal.throwIfAborted();const png=join(dir,'frame.png'),webp=join(dir,'frame.webp');
      const log=await mediaCommand(ffmpeg!,['-nostdin','-v','info','-protocol_whitelist','file,pipe','-ss',String(time),'-copyts','-i',path,'-an','-vf',`select=gte(t\\,${time+offset}),showinfo,scale=w='min(2560,iw)':h='min(2560,ih)':force_original_aspect_ratio=decrease`,'-frames:v','1','-fps_mode','passthrough','-y',png],30000,signal,true);
      const pts=log.match(/\bn:\s*0\s+pts:.*?pts_time:([\d.e+-]+)/)?.[1],seconds=Number(pts)-offset;
      // Audio/container duration can extend beyond the final video frame, especially for a brief capture.
      if(pts===undefined&&frames.length)continue;
      if(pts===undefined||!Number.isFinite(seconds)||seconds<-.01||seconds>=source.durationSeconds+.05)throw new AttachmentError(400,'The frame timestamp could not be verified.');
      const bytes=await readFile(png);let frame;
      for(const width of [2560,2048,1536,1024]){frame=await sharp(bytes).resize({width,height:width,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});if(frame.data.length<=600*1024)break;}
      if(!frame||frame.data.length>600*1024)throw new AttachmentError(400,'The frame exceeds the image delivery limit.');
      const item=VideoFrame.parse({seconds:Math.max(0,seconds),playbackHash:source.playback.hash,transform:'frame-webp-v1',image:{hash:createHash('sha256').update(frame.data).digest('hex'),mimeType:'image/webp',sizeBytes:frame.data.length,width:frame.info.width,height:frame.info.height}});
      await writeFile(webp,frame.data,{mode:0o600});await storage.add(id,item.image,webp);
      if(!frames.some(f=>f.seconds===item.seconds))frames.push(item);
    }
    return frames;
  }finally{await rm(dir,{recursive:true,force:true});}
}
