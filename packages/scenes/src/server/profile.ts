import type { SceneProfile } from '../contracts.ts';
import type { SceneIntent } from './intent.ts';
import {SCENE_BASELINE,CLOUD_STYLE_DEFAULTS} from '../profile-defaults.ts';

export interface SceneGeometry {
  skyCoverage: number;
  surfaceCoverage: Record<string, number>;
}

/** Conservative proposal only: a profile cannot establish visual or motion acceptance. */
export function automaticSceneProfile(intent: SceneIntent, geometry: Pick<SceneGeometry, 'skyCoverage' | 'surfaceCoverage'>, sourceHash: string): SceneProfile {
  const sky = geometry.skyCoverage;
  const water = geometry.surfaceCoverage.water ?? geometry.surfaceCoverage['3'] ?? 0;
  if (!Number.isFinite(sky) || sky < 0 || sky > 1 || !Number.isFinite(water) || water < 0 || water > 1 || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('Scene geometry is invalid.');
  const hasSky = sky >= .02;
  const seed = Number.parseInt(sourceHash.slice(0, 8), 16) % 2147483646 + 1;
  return {
    version: 1, ...SCENE_BASELINE, clouds: hasSky, cloudStyle: intent.cloudStyle, cloudSeed: seed,shadowStrength:0,shadowSoftness:0,
    ...CLOUD_STYLE_DEFAULTS[intent.cloudStyle],
    cloudShadows: hasSky,
    water: intent.landscape === 'lakeside' && water >= .015,
    stars: hasSky, starBrightness: 120, starGlow: true, constellations: hasSky, meteors: hasSky,
  };
}
