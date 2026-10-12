import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { Uuid, ImageFile, ImageMetadata, IMAGE_LIMITS, type RequestImage } from '@ash/shared';

export class AttachmentError extends Error {
  constructor(public status:number,message:string) {super(message);}
}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const sharpOptions={limitInputPixels:IMAGE_LIMITS.pixels,failOn:'warning' as const};
function animatedPng(bytes:Buffer) {
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
  for(let offset=8;offset+12<=bytes.length;) {
    const length=bytes.readUInt32BE(offset);
    if(bytes.toString('ascii',offset+4,offset+8)==='acTL')return true;
    if(length>bytes.length-offset-12)return false;
    offset+=length+12;
  }
  return false;
}
export async function processImage(bytes:Buffer) {
  if (!bytes.length || bytes.length>IMAGE_LIMITS.perFile) throw new AttachmentError(413,'Each image must be at most 10 MiB.');
  try {
    if(animatedPng(bytes))throw new Error('Animated PNG');
    const meta=await sharp(bytes,sharpOptions).metadata();
    const media={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'} as const;
    if (!meta.format || !(meta.format in media) || (meta.pages??1)>1 || !meta.width || !meta.height || meta.width*meta.height>IMAGE_LIMITS.pixels)
      throw new Error('Unsupported image');
    // Fully decode even a small input; metadata inspection alone accepts truncated images.
    const thumb=await sharp(bytes,sharpOptions).rotate().resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer({resolveWithObject:true});
    let model:typeof thumb|undefined;
    for (const width of [2560,2048,1536,1024]) {
      model=await sharp(bytes,sharpOptions).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer({resolveWithObject:true});
      if(model.data.length<=IMAGE_LIMITS.modelBytes) break;
    }
    if(!model || model.data.length>IMAGE_LIMITS.modelBytes) throw new Error('Image cannot fit');
    const rotated=!!meta.orientation && meta.orientation>=5;
    const original=ImageFile.parse({hash:digest(bytes),mimeType:media[meta.format as keyof typeof media],sizeBytes:bytes.length,
      width:rotated?meta.height:meta.width,height:rotated?meta.width:meta.height});
    const descriptor=(value:typeof thumb)=>ImageFile.parse({hash:digest(value.data),mimeType:'image/webp',sizeBytes:value.data.length,width:value.info.width,height:value.info.height});
    return {metadata:ImageMetadata.parse({original,model:descriptor(model),thumbnail:descriptor(thumb),transform:'rotate-strip-webp-v1'}),
      blobs:[{image:original,bytes},{image:descriptor(model),bytes:model.data},{image:descriptor(thumb),bytes:thumb.data}]};
  } catch(error) {
    if(error instanceof AttachmentError)throw error;
    throw new AttachmentError(400,'Use a valid, still PNG, JPEG or WebP image no larger than 20 megapixels.');
  }
}
export class ImageStorage {
  readonly root:string;
  constructor(private instanceRoot:string) {this.root=join(instanceRoot,'files','attachments');}
  async prepare() {
    for(const path of [this.instanceRoot,join(this.instanceRoot,'files')])await this.directory(path);
    await mkdir(this.root,{recursive:true,mode:0o700});await this.directory(this.root);
  }
  private async directory(path:string) {
    const stat=await lstat(path);
    if(stat.isSymbolicLink() || !stat.isDirectory())throw new AttachmentError(409,'Image storage is not a regular instance directory.');
  }
  async publish(id:string,blobs:Array<{image:ImageFile;bytes:Buffer}>) {
    Uuid.parse(id);await this.prepare();
    const staging=join(this.root,`.staging-${randomUUID()}`);
    await mkdir(staging,{mode:0o700});
    try {
      for(const {image,bytes} of new Map(blobs.map(blob=>[blob.image.hash,blob])).values()) {
        const file=await open(join(staging,ImageFile.parse(image).hash),'wx',0o600);
        try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
      }
      await rename(staging,join(this.root,id));
    }finally{await rm(staging,{recursive:true,force:true});}
  }
  async read(id:string,image:ImageFile) {
    Uuid.parse(id);ImageFile.parse(image);
    try {
      await this.prepare();await this.directory(join(this.root,id));
      const file=await open(join(this.root,id,image.hash),constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const stat=await file.stat();
        if(!stat.isFile() || stat.nlink!==1 || stat.size!==image.sizeBytes)throw new Error('Invalid blob');
        const bytes=await file.readFile();
        if(digest(bytes)!==image.hash)throw new Error('Corrupt blob');
        return bytes;
      }finally{await file.close();}
    }catch{throw new AttachmentError(409,'The saved image is missing or damaged. Reattach it to send a new message.');}
  }
  async dataUrl(image:RequestImage) {
    return `data:${image.image.mimeType};base64,${(await this.read(image.attachmentId,image.image)).toString('base64')}`;
  }
  async clipboard(id:string,image:ImageFile) {
    return sharp(await this.read(id,image),sharpOptions).rotate().png().toBuffer();
  }
  async remove(id:string) {Uuid.parse(id);await this.prepare();await rm(join(this.root,id),{recursive:true,force:true});}
  async sweepUnpublished(known:Set<string>,now=Date.now()) {
    await this.prepare();
    for(const entry of await readdir(this.root,{withFileTypes:true})) {
      if(known.has(entry.name))continue;
      if(!entry.name.startsWith('.staging-') && !Uuid.safeParse(entry.name).success)continue;
      const path=join(this.root,entry.name),stat=await lstat(path);
      if(now-stat.mtimeMs>60*60*1000)await rm(path,{recursive:true,force:true});
    }
  }
}
