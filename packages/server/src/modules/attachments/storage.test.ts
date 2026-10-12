import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm,writeFile,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ImageStorage,processImage } from './storage.ts';
import { screenshotFixture,orientedFixture } from '../../../test/fixtures/images.ts';
import { IMAGE_LIMITS } from '@ash/shared';

test('image validation preserves originals and makes bounded, oriented derivatives',async()=>{
  const bytes=await screenshotFixture(),result=await processImage(bytes);
  assert.equal(result.metadata.original.width,960);assert.equal(result.metadata.thumbnail.width,320);
  assert.ok(result.metadata.model.sizeBytes<=IMAGE_LIMITS.modelBytes);assert.deepEqual(result.blobs[0].bytes,bytes);
  const portrait=await processImage(await orientedFixture());
  assert.equal(portrait.metadata.original.width,80);assert.equal(portrait.metadata.original.height,120);
  assert.equal(portrait.metadata.model.width,80);assert.equal(portrait.metadata.model.height,120);
  assert.equal((await sharp(portrait.blobs[1].bytes).metadata()).orientation,undefined);
});
test('invalid, animated, excessively large and truncated inputs are rejected',async()=>{
  await assert.rejects(processImage(Buffer.from('<svg></svg>')),/valid, still/);
  await assert.rejects(processImage(Buffer.alloc(IMAGE_LIMITS.perFile+1)),/10 MiB/);
  const tooManyPixels=await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(processImage(tooManyPixels),/20 megapixels/);
  const png=await screenshotFixture();await assert.rejects(processImage(png.subarray(0,png.length/2)),/valid, still/);
  const animation=Buffer.alloc(20);animation.writeUInt32BE(8);animation.write('acTL',4);animation.writeUInt32BE(2,8);
  await assert.rejects(processImage(Buffer.concat([png.subarray(0,33),animation,png.subarray(33)])),/valid, still/);
});
test('storage rejects missing, corrupt and symlinked blobs and normalizes clipboard orientation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ash-image-storage-'));await mkdir(join(root,'files'));t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new ImageStorage(root),id=randomUUID(),result=await processImage(await orientedFixture());
  await storage.publish(id,result.blobs);assert.deepEqual(await storage.read(id,result.metadata.original),result.blobs[0].bytes);
  const clipboard=await sharp(await storage.clipboard(id,result.metadata.original)).metadata();assert.equal(clipboard.width,80);assert.equal(clipboard.height,120);
  await assert.rejects(storage.read(randomUUID(),result.metadata.original),/missing or damaged/);
  await assert.rejects(storage.read('../outside',result.metadata.original));
  const path=join(storage.root,id,result.metadata.original.hash),outside=join(root,'outside');
  await writeFile(outside,result.blobs[0].bytes);await rm(path);await symlink(outside,path);
  await assert.rejects(storage.read(id,result.metadata.original),/missing or damaged/);
  await rm(path);await writeFile(path,Buffer.alloc(result.metadata.original.sizeBytes));
  await assert.rejects(storage.read(id,result.metadata.original),/missing or damaged/);
  await storage.remove(id);
});
