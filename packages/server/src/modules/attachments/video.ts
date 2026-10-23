import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdtemp,readFile,stat,rm,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import sharp from 'sharp';
import {VideoMetadata,VideoFile,ImageFile,VIDEO_LIMITS} from '@ash/shared';
import {AttachmentError} from './storage.ts';

export async function mediaCommand(binary:string,args:string[],timeout=180000,signal?:AbortSignal,includeStderr=false) {
  return new Promise<string>((resolve,reject)=>{
    const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH},signal});let output='',errors='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
    child.stdout.on('data',chunk=>{if(output.length<1000000)output+=String(chunk);else child.kill('SIGKILL');});
    child.stderr.on('data',chunk=>{if(includeStderr){if(errors.length<1000000)errors+=String(chunk);else child.kill('SIGKILL');}else errors=(errors+String(chunk)).slice(-4000);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(includeStderr?output+errors:output);else reject(new AttachmentError(400,'The video could not be decoded or prepared for playback.'));});
  });
}
export async function fileHash(path:string){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
export async function processVideo(path:string,temporaryRoot:string) {
  const dir=await mkdtemp(join(temporaryRoot,'video-'));
  try {
    const file=await open(path,'r');const header=Buffer.alloc(4096);try{await file.read(header,0,4096,0);}finally{await file.close();}
    const ebml=header.readUInt32BE(0)===0x1a45dfa3&&header.includes(Buffer.from('webm'));
    const iso=header.toString('ascii',4,8)==='ftyp';
    if(!ebml&&!iso)throw new AttachmentError(400,'Choose a valid MP4, MOV or WebM video.');
    const probe=JSON.parse(await mediaCommand(ffprobe.path,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',path],20000));
    const video=probe.streams?.find((s:any)=>s.codec_type==='video'),audio=probe.streams?.find((s:any)=>s.codec_type==='audio');
    const formats=String(probe.format?.format_name??'').split(',');
    if(!video||!['mov','mp4','webm','matroska'].some(kind=>formats.includes(kind))||!video.width||!video.height||video.width*video.height>40_000_000)throw new AttachmentError(400,'Choose a valid MP4, MOV or WebM video.');
    const webm=formats.includes('webm')&&['vp8','vp9','av1'].includes(video.codec_name)&&(!audio||['opus','vorbis'].includes(audio.codec_name));
    const playbackPath=join(dir,webm?'playback.webm':'playback.mp4');
    const copy=webm||video.codec_name==='h264'&&(!audio||audio.codec_name==='aac');
    await mediaCommand(ffmpeg!,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',path,'-map','0:v:0','-map','0:a:0?','-map_metadata','-1',...(copy?['-c','copy']:['-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac']),...(webm?[]:['-movflags','+faststart']),'-y',playbackPath]);
    const playable=JSON.parse(await mediaCommand(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',playbackPath],20000));
    const duration=Number(playable.format.duration);
    if(!Number.isFinite(duration)||duration<=0)throw new AttachmentError(400,'The video has no playable duration.');
    const thumbnailPath=join(dir,'thumbnail.png');
    await mediaCommand(ffmpeg!,['-nostdin','-v','error','-i',playbackPath,'-ss',String(Math.min(.5,duration/2)),'-frames:v','1','-vf','scale=320:320:force_original_aspect_ratio=decrease','-y',thumbnailPath],20000);
    // A short clip may have no frame at its midpoint; the first frame still makes a valid thumbnail.
    const thumbnailBytes=await readFile(thumbnailPath).catch(async()=>{await mediaCommand(ffmpeg!,['-nostdin','-v','error','-i',playbackPath,'-frames:v','1','-vf','scale=320:320:force_original_aspect_ratio=decrease','-y',thumbnailPath],20000);return readFile(thumbnailPath);});
    const thumb=await sharp(thumbnailBytes).webp({quality:80}).toBuffer({resolveWithObject:true});
    const rawSize=(await stat(path)).size,playbackSize=(await stat(playbackPath)).size;
    if(rawSize>VIDEO_LIMITS.perFile||playbackSize>VIDEO_LIMITS.perFile)throw new AttachmentError(413,'Each video must be at most 2 GiB.');
    const rawFormat=formats.includes('webm')?'video/webm':formats.includes('mov')&&await isQuickTime(path)?'video/quicktime':'video/mp4';
    const original=VideoFile.parse({hash:await fileHash(path),mimeType:rawFormat,sizeBytes:rawSize,width:video.width,height:video.height});
    const playback=VideoFile.parse({hash:await fileHash(playbackPath),mimeType:webm?'video/webm':'video/mp4',sizeBytes:playbackSize,width:video.width,height:video.height});
    const thumbnail=ImageFile.parse({hash:createHash('sha256').update(thumb.data).digest('hex'),mimeType:'image/webp',sizeBytes:thumb.data.length,width:thumb.info.width,height:thumb.info.height});
    return {metadata:VideoMetadata.parse({original,playback,thumbnail,durationSeconds:duration,hasAudio:!!audio,transform:'video-playback-v1'}),blobs:[{image:original,path},{image:playback,path:playbackPath},{image:thumbnail,bytes:thumb.data}],dispose:()=>rm(dir,{recursive:true,force:true})};
  }catch(error){await rm(dir,{recursive:true,force:true});if(error instanceof AttachmentError)throw error;throw new AttachmentError(400,'Choose a valid MP4, MOV or WebM video.');}
}
async function isQuickTime(path:string){const {open}=await import('node:fs/promises');const file=await open(path,'r');try{const b=Buffer.alloc(16);await file.read(b,0,16,0);return b.toString('ascii',8,12)==='qt  ';}finally{await file.close();}}
