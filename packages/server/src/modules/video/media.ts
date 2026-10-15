import {mkdtemp,mkdir,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {VideoFile,type VideoPlan,type VideoModelRequest} from '@ash/shared';
import {ImageStorage} from '../attachments/storage.ts';
import {fileHash,mediaCommand} from '../attachments/video.ts';

export async function prepareVideoSegment(storage:ImageStorage,plan:VideoPlan,start:number,end:number,signal:AbortSignal):Promise<NonNullable<VideoModelRequest['media']>>{
  const source=plan.source.playback,path=await storage.checkedFile(plan.attachmentId,source,signal);
  if(start===0&&end===plan.source.durationSeconds&&source.sizeBytes<1_900_000_000)return {file:source,sourceOffset:0,start,end,fps:plan.fps,resolution:'high',transform:'playback'};
  const parent=join(storage.root,'..','video-temp');await mkdir(parent,{recursive:true,mode:0o700});
  const dir=await mkdtemp(join(parent,'video-analysis-')),output=join(dir,'segment.mp4');
  try{
    await mediaCommand(ffmpeg!,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',String(start),'-i',path,'-t',String(end-start),
      '-map','0:v:0','-map','0:a:0?','-map_metadata','-1','-vf',"scale=w='min(2560,iw)':h='min(1440,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
      '-c:v','libx264','-preset','veryfast','-crf','20','-maxrate','6M','-bufsize','12M','-c:a','aac','-b:a','96k','-movflags','+faststart','-y',output],180000,signal);
    const probe=JSON.parse(await mediaCommand(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',output],20000,signal));
    const video=probe.streams?.find((s:any)=>s.codec_type==='video'),duration=Number(probe.format?.duration);
    if(!video||!Number.isFinite(duration)||Math.abs(duration-(end-start))>.2)throw Error('Invalid prepared segment.');
    const file=VideoFile.parse({hash:await fileHash(output),mimeType:'video/mp4',sizeBytes:(await stat(output)).size,width:video.width,height:video.height});
    if(file.sizeBytes>120*1024*1024)throw Error('Prepared segment exceeded byte limit.');
    await storage.add(plan.attachmentId,file,output);
    return {file,sourceOffset:start,start,end,fps:plan.fps,resolution:'high',transform:'clip-v1'};
  }finally{await rm(dir,{recursive:true,force:true});}
}
