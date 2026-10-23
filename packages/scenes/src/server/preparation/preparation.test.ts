import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ScenePreparer, MODEL_IDS, verifyModelInstallation, type SceneModelInstallation, type SceneModelPin, type PreparationAssetKey } from './index.ts';
import { prepareWithInference } from './core.js';
import { refineWaterBoundaries } from './surface-refinement.js';

const injected = new URL('./test-inference.js', import.meta.url);
async function artwork() {
  const width = 32, height = 24, rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(y < 10 ? [110, 150, 220] : x > 19 && y > 15 ? [15, 40, 110] : x < 6 && y > 14 ? [20, 70, 20] : [60, 90, 40], (y * width + x) * 3);
  return sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('explicit off-thread preparation preserves source, aligned maps, material classes, tone and bounded geometry', async () => {
  const preparer = new ScenePreparer({ inferenceModule: injected }), source = await artwork(), stages: string[] = [];
  assert.deepEqual(await preparer.availability(), { available: true, issues: [] });
  const result = await preparer.prepare(source, { onProgress: stage => stages.push(stage) });
  assert.deepEqual(result.assets.source, source); assert.equal(result.provenance.sourceHash, sha(source));
  assert.equal(result.provenance.runtime, 'injected-test-inference'); assert.deepEqual(result.provenance.models, []);
  assert.ok(result.provenance.diagnostics.workerThreadId > 0);
  assert.ok(stages.includes('Refining sky edges')); assert.ok(result.provenance.diagnostics.horizonCrops > 0);
  const raw = {} as Record<PreparationAssetKey, Buffer>;
  for (const [key, bytes] of Object.entries(result.assets)) {
    const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, result.width); assert.equal(metadata.height, result.height);
    raw[key as PreparationAssetKey] = await sharp(bytes).ensureAlpha().raw().toBuffer();
  }
  for (let p = 0; p < raw.source.length; p += 4) {
    assert.ok(raw.surfaces[p] <= 5); assert.equal(raw.surfaces[p], raw.surfaces[p + 1]); assert.equal(raw.surfaces[p], raw.surfaces[p + 2]);
    if (raw.mask[p] >= 128) { assert.equal(raw.depth[p], 0); assert.equal(raw.surfaces[p], 5); }
    else assert.ok(raw.depth[p] >= 1);
    for (let c = 0; c < 3; c++) assert.ok(raw.candidate[p + c] >= raw.source[p + c], 'Tone lift never darkens source channels.');
  }
  assert.ok(result.geometry.skyCoverage > .2 && result.geometry.skyCoverage < .6);
  assert.ok(result.geometry.surfaceCoverage.water > 0);
  assert.ok(result.geometry.foregroundDepth.p90 > result.geometry.foregroundDepth.p10);
  assert.deepEqual(result.geometry.framing, { mode: 'cover', orientation: 0 });
});

test('missing models are unavailable before inference, and installation locks reject missing, corrupt, symlinked and unpinned weights', async t => {
  const preparer = new ScenePreparer(); assert.equal((await preparer.availability()).available, false);
  await assert.rejects(preparer.prepare(await artwork()), /models are not installed/);
  const root = await mkdtemp(join(tmpdir(), 'ash-scene-model-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
  const models: SceneModelPin[] = [];
  for (const role of ['sky', 'surfaces', 'depth'] as const) {
    const id = MODEL_IDS[role], files = [];
    for (const path of ['config.json', 'preprocessor_config.json', 'onnx/model.onnx']) {
      const bytes = Buffer.from(`${role}:${path}`), destination = join(root, id, path);
      await mkdir(join(destination, '..'), { recursive: true }); await writeFile(destination, bytes);
      files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
    models.push({ role, id, revision: 'a'.repeat(40), files });
  }
  const installation: SceneModelInstallation = { runtimeVersion: '4.3.1', cacheRoot: root, models };
  await verifyModelInstallation(installation);
  const branch = structuredClone(installation); branch.models[0].revision = 'main';
  await assert.rejects(verifyModelInstallation(branch), /pinned commit/);
  const path = join(root, models[0].id, models[0].files[2].path), original = Buffer.from(`sky:onnx/model.onnx`);
  await writeFile(path, Buffer.alloc(original.length)); await assert.rejects(verifyModelInstallation(installation), /SHA-256/);
  const outside = join(root, 'outside'); await writeFile(outside, original); await rm(path); await symlink(outside, path);
  await assert.rejects(verifyModelInstallation(installation)); await rm(path);
  await assert.rejects(verifyModelInstallation(installation), /ENOENT/);
});

test('cancellation terminates an unresponsive inference worker and releases the adapter', async () => {
  const preparer = new ScenePreparer({ inferenceModule: new URL('./test-slow-inference.js', import.meta.url) }), abort = new AbortController();
  const pending = preparer.prepare(await artwork(), { signal: abort.signal });
  setTimeout(() => abort.abort(new DOMException('Cancelled by test', 'AbortError')), 30);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await preparer.availability()).available, true);
});

test('ambiguous sky, invalid depth and unaligned inference fail without producing a scene', async () => {
  const source = await artwork();
  const allSky = { sky: async (_pixels: Uint8Array, width: number, height: number) => [{ label: 'sky', mask: { data: new Uint8Array(width * height).fill(255) } }], surfaces: async () => [], depth: async () => new Float32Array() };
  await assert.rejects(prepareWithInference(source, allSky), /Sky separation is uncertain/);
  const { createInference } = await import('./test-inference.js');
  const inference = await createInference();
  await assert.rejects(prepareWithInference(source, { ...inference, depth: async (_pixels: Uint8Array, width: number, height: number) => new Float32Array(width * height).fill(NaN) }), /invalid values/);
  await assert.rejects(prepareWithInference(source, { ...inference, surfaces: async () => [{ label: 'water', mask: { data: new Uint8Array(1) } }] }), /not aligned/);
  const transparent = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(new ScenePreparer({ inferenceModule: injected }).prepare(transparent), /opaque background/);
});

test('shoreline recipe shrinks only corroborated foreground water labels and preserves painted reflections', async () => {
  const width=64,height=64,n=width*height,rgb=Buffer.alloc(n*3,80),sky=new Uint8Array(n),coarse=new Uint8Array(n),depth=new Uint8Array(n).fill(50);
  const tree=new Uint8Array(n),water=new Uint8Array(n),terrain=new Uint8Array(n);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;coarse[p]=y<32?1:3;
    if(y<32)terrain[p]=255;else water[p]=255;
    const foreground=x>=10&&x<18&&y>=32&&y<41,reflection=x>=30&&x<38&&y>=44&&y<53,isolated=x>=48&&x<56&&y>=44&&y<53;
    if(foreground||reflection||isolated){tree[p]=255;water[p]=0;if(!reflection)depth[p]=140;}
  }
  const result=await refineWaterBoundaries(rgb,sky,coarse,depth,width,height,async()=>[
    {label:'grass',mask:{data:terrain}},{label:'tree',mask:{data:tree}},{label:'water',mask:{data:water}},
  ]);
  assert.ok(result.cropCount>0);assert.ok(result.correctedPixels>0);
  assert.equal(result.pixels[35*width+14],2,'A near object touching known land is removed from the water map.');
  assert.equal(result.pixels[48*width+34],3,'A painted tree reflection at water depth stays water.');
  assert.equal(result.pixels[48*width+52],3,'An isolated uncertain object is not guessed to be foreground.');
  for(let p=0;p<n;p++)if(coarse[p]!==3)assert.equal(result.pixels[p],coarse[p],'Refinement never creates new water.');
});
