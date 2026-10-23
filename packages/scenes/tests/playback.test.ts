import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { DEFAULT_LOCATION, migrateCloudStyle, validateSceneBundle } from '../src/contracts.ts';
import { fixtureManifests } from '../src/fixtures/manifests.ts';
import { solarState, phaseSolarState, interpolateSolarState } from '../src/timing.ts';
import { horizontal, starOpacity } from '../src/browser/engine/stars.js';
import { shadowSun } from '../src/browser/engine/depth-shadows.js';
import { prepareWater, waterPhase, waterArtworkRect, sampleSkyPalette } from '../src/browser/engine/water.js';
import { validateAssetBytes } from '../src/browser/assets.ts';
import { frameRect, backingSize } from '../src/browser/engine/scene.js';

test('cover framing fills every supported viewport without stretching at bounded output resolution', () => {
  for (const [width, height] of [[740, 650], [1040, 830], [1920, 1080], [5120, 2880]]) {
    for (const [sourceWidth, sourceHeight] of [[1024, 1024], [2048, 1152], [800, 1200]]) {
      const frame = frameRect(sourceWidth!, sourceHeight!, width!, height!);
      assert(frame.x <= 0 && frame.y <= 0);
      assert(frame.x + frame.width >= width! - 1e-8 && frame.y + frame.height >= height! - 1e-8);
      assert(Math.abs(frame.width / sourceWidth! - frame.height / sourceHeight!) < 1e-8, 'source proportions are unchanged');
      for (const [x, y] of [[0, 0], [width!, height!], [width! / 2, height! / 2], [width! * .2, height! * .8]]) {
        const point = {x:(x!-frame.x)/frame.width*sourceWidth!,y:(y!-frame.y)/frame.height*sourceHeight!};
        assert(point); assert(point.x >= -1e-8 && point.x <= sourceWidth! + 1e-8); assert(point.y >= -1e-8 && point.y <= sourceHeight! + 1e-8);
        assert(Math.abs(frame.x + point.x / sourceWidth! * frame.width - x!) < 1e-8);
        assert(Math.abs(frame.y + point.y / sourceHeight! * frame.height - y!) < 1e-8);
      }
    }
    for (const scale of [1, 2, 3]) {
      const backing = backingSize(width!, height!, scale);
      assert(backing.width * backing.height <= 8_294_400); assert(backing.width <= 4096 && backing.height <= 4096);
      // Pixel rounding is confined to the backing store; framing and inverse coordinates stay in full CSS dimensions.
      assert(Math.abs(backing.width / width! - backing.height / height!) <= 1 / width! + 1 / height!);
    }
  }
  assert(backingSize(5120, 2880, 2).scale < 1, 'large screens use bounded internal resolution while filling their CSS viewport');
  assert.deepEqual(backingSize(5120,2880,2),{width:3840,height:2160,scale:.75});
});

test('native artwork and bounded water maps share normalized crop coordinates',()=>{
  const water={x:320,y:600,width:960,height:400,sourceWidth:1600,sourceHeight:1600};
  for(const [width,height]of [[2048,2048],[3966,1586]]){
    const crop=waterArtworkRect(water,width!,height!);
    assert.equal(crop.x/width!,water.x/water.sourceWidth);assert.equal(crop.y/height!,water.y/water.sourceHeight);
    assert.equal(crop.width/width!,water.width/water.sourceWidth);assert.equal(crop.height/height!,water.height/water.sourceHeight);
  }
  const pixels=new Uint8Array(4*4*4).fill(180),compact=new Uint8Array(4*4).fill(255),rgba=new Uint8Array(4*4*4).fill(255);
  assert.deepEqual(sampleSkyPalette(pixels,compact,4,4,.5),sampleSkyPalette(pixels,rgba,4,4,.5));
});

test('reviewed fixtures have complete compatible bundles and independently checked assets', async () => {
  for (const manifest of fixtureManifests) {
    assert.equal(validateSceneBundle(manifest), manifest);
    for (const asset of Object.values(manifest.assets)) {
      const data = await readFile(new URL(`../src/fixtures/${asset.path}`, import.meta.url));
      await validateAssetBytes(data, asset);
    }
  }
  const corrupt = structuredClone(fixtureManifests[0]!);
  corrupt.profile.amount = NaN; assert.throws(() => validateSceneBundle(corrupt), /profile amount/);
  corrupt.profile.amount = 40; Object.assign(corrupt.profile, { time: 720 }); assert.throws(() => validateSceneBundle(corrupt), /host or unsupported/);
  const unsupported = structuredClone(fixtureManifests[0]!); unsupported.rendererVersion = 2 as 1;
  assert.throws(() => validateSceneBundle(unsupported), /unsupported/);
  const asset = fixtureManifests[0]!.assets.mask, bytes = new Uint8Array(await readFile(new URL(`../src/fixtures/${asset.path}`, import.meta.url)));
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await assert.rejects(validateAssetBytes(bytes, asset), /integrity/);
});

test('solar timing follows season and coordinates, handles polar regions and ignores timezone labels for geometry', () => {
  const summer = solarState(Date.parse('2026-06-21T20:10:00Z'), DEFAULT_LOCATION);
  const winter = solarState(Date.parse('2026-12-21T20:10:00Z'), DEFAULT_LOCATION);
  assert(summer.altitude > 74 && summer.altitude < 77);
  assert(winter.altitude > 27 && winter.altitude < 31);
  const utc = solarState(summer.timestamp, { ...DEFAULT_LOCATION, timeZone: 'UTC' });
  assert.equal(utc.altitude, summer.altitude); assert.equal(utc.azimuth, summer.azimuth);
  const morning = solarState(Date.parse('2026-10-22T14:30:00Z'), DEFAULT_LOCATION);
  assert(Math.abs(morning.altitude) < 3); assert(morning.rising); assert(morning.lightingTime > 330 && morning.lightingTime < 390);
  for (const latitude of [89.9, -89.9]) {
    const location = { name: 'Polar test', latitude, longitude: 0, timeZone: 'UTC' };
    const june = solarState(Date.parse('2026-06-21T12:00:00Z'), location), december = solarState(Date.parse('2026-12-21T12:00:00Z'), location);
    assert.equal(june.regime, latitude > 0 ? 'polar-day' : 'polar-night'); assert.equal(december.regime, latitude > 0 ? 'polar-night' : 'polar-day');
    assert([june, december].every(s => [s.altitude, s.azimuth, s.lightingTime].every(Number.isFinite)));
  }
});

test('stars and cloud shadows share the solar projection and scene orientation', () => {
  const state = solarState(Date.parse('2026-10-22T15:30:00Z'), DEFAULT_LOCATION);
  const sun = horizontal(state.rightAscension, state.declination, state);
  assert(Math.abs(sun.altitude - state.altitude) < 1e-8); assert(Math.abs(sun.azimuth - state.azimuth) < 1e-8);
  assert.equal(starOpacity(-1, 45, 2), 0); assert.equal(starOpacity(2, 45, -20, 1), 0);
  assert(starOpacity(2, 45, -20) > starOpacity(2, .1, -20));
  const dawn = phaseSolarState(state.timestamp, DEFAULT_LOCATION, 'dawn'), dusk = phaseSolarState(state.timestamp, DEFAULT_LOCATION, 'dusk');
  assert(shadowSun(dawn).x > 0); assert(shadowSun(dusk).x < 0);
  const rotated = shadowSun(dawn, 180); assert(Math.abs(rotated.x + shadowSun(dawn).x) < 1e-8);
});

test('held phases keep astronomical rotation fixed and transitions take the short angular path', () => {
  const morning = Date.parse('2026-10-22T15:30:00Z'), evening = Date.parse('2026-10-22T23:30:00Z');
  for (const phase of ['dawn', 'day', 'dusk', 'night'] as const) {
    assert.deepEqual(phaseSolarState(morning, DEFAULT_LOCATION, phase), phaseSolarState(evening, DEFAULT_LOCATION, phase));
  }
  const a = solarState(morning), b = { ...a, azimuth: 1, localSiderealTime: 1 };
  const middle = interpolateSolarState({ ...a, azimuth: 359, localSiderealTime: 359 }, b, .5);
  assert.equal(middle.azimuth, 0); assert.equal(middle.localSiderealTime, 0);
  assert.equal(waterPhase({ waterPosition: 0 }), waterPhase({ waterPosition: 100 }));
  assert.equal(migrateCloudStyle('cirrus'), 'cirrus-feathered'); assert.equal(migrateCloudStyle('cirrus-natural'), 'cirrus-feathered');
});

test('Lakeside water geometry excludes every terrain pixel and foreground canopy; other fixtures remain still', async () => {
  for (const scene of fixtureManifests) {
    const read = (key: 'surfaces' | 'depth' | 'mask') => sharp(new URL(`../src/fixtures/${scene.assets[key].path}`, import.meta.url).pathname).ensureAlpha().raw().toBuffer();
    const [surfaces, depth, mask] = await Promise.all([read('surfaces'), read('depth'), read('mask')]);
    const sky = new Uint8ClampedArray(mask); for (let p = 0; p < sky.length; p += 4) sky[p + 3] = sky[p]!;
    const water = prepareWater(surfaces, depth, sky, scene.width, scene.height);
    if (scene.id !== 'lake-panorama-v3') { assert.equal(water, null); continue; }
    assert(water); assert(water.height < scene.height * .4);
    let moving = 0;
    for (let y = 0; y < water.height; y++) for (let x = 0; x < water.width; x++) if (water.pixels[(y * water.width + x) * 4]) {
      const p: number = ((y + water.y) * scene.width + x + water.x) * 4;
      assert.equal(surfaces[p], 3); assert(sky[p + 3]! < 32); moving++;
    }
    assert(moving > 100000);
  }
});
