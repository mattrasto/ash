export const SCENE_ASSET_KEYS = ['source', 'mask', 'candidate', 'depth', 'surfaces'] as const;
export const DEFAULT_SCENE_ID = 'meadow-panorama-v3';
export const SCENE_REPLACEMENTS: Readonly<Record<string,string>> = Object.freeze({ meadow:DEFAULT_SCENE_ID,'meadow-upscaled-v1':DEFAULT_SCENE_ID,lake:'lake-panorama-v3',valley:'valley-panorama-v3',
  'meadow-panorama-v1':DEFAULT_SCENE_ID,'lake-panorama-v1':'lake-panorama-v3','valley-panorama-v1':'valley-panorama-v3',
  'meadow-panorama-v2':DEFAULT_SCENE_ID,'lake-panorama-v2':'lake-panorama-v3','valley-panorama-v2':'valley-panorama-v3' });
export const RETIRED_SCENE_IDS: readonly string[] = Object.keys(SCENE_REPLACEMENTS);
export const SCENE_ARTWORK_LIMITS=Object.freeze({minWidth:3840,minHeight:1536,aspectRatio:2.5,aspectTolerance:.025,maxDimension:4096,maxPixels:8_294_400});
/** New artwork contract; retained legacy bundles remain decodable. */
export function validSceneArtworkSize(width:number,height:number){const p=SCENE_ARTWORK_LIMITS;return Number.isInteger(width)&&Number.isInteger(height)&&width>=p.minWidth&&height>=p.minHeight&&width<=p.maxDimension&&height<=p.maxDimension&&width*height<=p.maxPixels&&Math.abs(width/height-p.aspectRatio)<=p.aspectTolerance;}
export type SceneAssetKey = typeof SCENE_ASSET_KEYS[number];
export type ScenePhase = 'automatic' | 'dawn' | 'day' | 'dusk' | 'night';
export const SCENE_PHASES: readonly ScenePhase[] = ['automatic', 'dawn', 'day', 'dusk', 'night'];
export interface SceneLocation { name: string; latitude: number; longitude: number; timeZone: string }
export const DEFAULT_LOCATION: Readonly<SceneLocation> = Object.freeze({ name: 'San Francisco', latitude: 37.7749, longitude: -122.4194, timeZone: 'America/Los_Angeles' });
export interface SceneAsset { path: string; sha256: string; bytes: number; mediaType: 'image/png'; width: number; height: number }
/** Reviewed rendering choices only. Time, animation clocks, interaction and host preferences are separate. */
export interface SceneProfile {
  version: 1;
  daylight: number; clouds: boolean; cloudStyle: 'soft' | 'cumulus' | 'cirrus-feathered' | 'storm'; cloudSeed: number;
  amount: number; speed: number; cloudShadows: boolean; shadowStrength: number; shadowSoftness: number;
  water: boolean; waterStrength: number; waterSpeed: number; waterReflections: number;
  stars: boolean; starBrightness: number; starGlow: boolean; constellations: boolean; meteors: boolean;
}
export interface SceneBundle {
  kind: 'ash-scene'; version: 1; rendererVersion: 1; mapVersion: 1;
  id: string; name: string; width: number; height: number;
  assets: Record<SceneAssetKey, SceneAsset>;
  profile: SceneProfile;
  framing: { mode: 'contain' | 'cover'; orientation: number; protectedRegion?: { x: number; y: number; width: number; height: number } };
  provenance: { sourceRepository: string; sourceRevision: string; generation: unknown; preparation: unknown; profile?:unknown };
  verification: { status: 'verified'; method: 'reviewed-fixture'; reviewedAt: string; criteriaVersion: 1 };
}
export interface ResolvedSceneBundle { manifest: SceneBundle; assetUrls: Record<SceneAssetKey, string> }
export interface SceneChoices { selectedId: string; revision: number; scenes: { id: string; name: string }[] }
export interface ScenePlaybackStatus { state: 'loading' | 'ready' | 'error'; sceneId: string; water: 'animated' | 'still' | 'absent'; error?: string; loadMs?: number }

export function validateLocation(value: unknown): SceneLocation {
  if (!value || typeof value !== 'object') throw new Error('Scene location is missing.');
  const location = value as SceneLocation;
  if (typeof location.name !== 'string' || !location.name.trim() || location.name.length > 120 || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 || typeof location.timeZone !== 'string') throw new Error('Scene location is invalid.');
  try { new Intl.DateTimeFormat('en', { timeZone: location.timeZone }); } catch { throw new Error('Scene timezone is invalid.'); }
  return { name: location.name.trim(), latitude: location.latitude, longitude: location.longitude, timeZone: location.timeZone };
}

export function validateSceneBundle(input: unknown): SceneBundle {
  if (!input || typeof input !== 'object') throw new Error('Scene manifest is missing.');
  const b = input as SceneBundle;
  if (b.kind !== 'ash-scene' || b.version !== 1 || b.rendererVersion !== 1 || b.mapVersion !== 1) throw new Error('This scene needs an unsupported renderer or map version.');
  if (typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.id) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120) throw new Error('Scene identity is invalid.');
  if (!Number.isInteger(b.width) || !Number.isInteger(b.height) || b.width < 1 || b.height < 1 || b.width * b.height > 16_777_216) throw new Error('Scene dimensions are invalid.');
  if (!b.assets || !b.profile || !b.framing || !b.provenance || !b.verification) throw new Error('Scene metadata is incomplete.');
  for (const key of SCENE_ASSET_KEYS) {
    const a = b.assets[key];
    if (!a || a.mediaType !== 'image/png' || !/^[a-f0-9]{64}$/.test(a.sha256) || typeof a.path !== 'string' || !/^assets\/[a-zA-Z0-9_-]+\.png$/.test(a.path) || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > 24 * 1024 * 1024 || a.width !== b.width || a.height !== b.height) throw new Error(`Scene ${key} asset metadata is invalid.`);
  }
  const p = b.profile;
  if (p.version !== 1 || !['soft', 'cumulus', 'cirrus-feathered', 'storm'].includes(p.cloudStyle)) throw new Error('Scene profile version or cloud style is invalid.');
  for (const [key, max] of Object.entries({ daylight: 100, amount: 100, speed: 100, shadowStrength: 100, shadowSoftness: 100, waterStrength: 250, waterSpeed: 200, waterReflections: 100, starBrightness: 200 })) {
    const v = p[key as keyof SceneProfile];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error(`Scene profile ${key} is invalid.`);
  }
  if (!Number.isSafeInteger(p.cloudSeed) || p.cloudSeed < 1 || p.cloudSeed > 2147483647) throw new Error('Scene cloud seed is invalid.');
  for (const key of ['clouds', 'cloudShadows', 'water', 'stars', 'starGlow', 'constellations', 'meteors'] as const) if (typeof p[key] !== 'boolean') throw new Error(`Scene profile ${key} is invalid.`);
  const allowed = new Set(['version', 'daylight', 'clouds', 'cloudStyle', 'cloudSeed', 'amount', 'speed', 'cloudShadows', 'shadowStrength', 'shadowSoftness', 'water', 'waterStrength', 'waterSpeed', 'waterReflections', 'stars', 'starBrightness', 'starGlow', 'constellations', 'meteors']);
  if (Object.keys(p).some(key => !allowed.has(key))) throw new Error('Scene profile contains host or unsupported settings.');
  if (!['contain', 'cover'].includes(b.framing.mode) || !Number.isFinite(b.framing.orientation) || b.framing.orientation < 0 || b.framing.orientation >= 360) throw new Error('Scene framing is invalid.');
  const region = b.framing.protectedRegion;
  if (region && (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1)) throw new Error('Scene protected framing region is invalid.');
  if (b.verification.status !== 'verified' || b.verification.method !== 'reviewed-fixture' || b.verification.criteriaVersion !== 1 || !Number.isFinite(Date.parse(b.verification.reviewedAt))) throw new Error('Scene has no supported verification record.');
  if (typeof b.provenance.sourceRevision !== 'string' || !b.provenance.sourceRevision || typeof b.provenance.sourceRepository !== 'string' || !b.provenance.sourceRepository) throw new Error('Scene provenance is missing.');
  return b;
}

/** Interchange compatibility only; the two superseded cirrus engines are not included. */
export function migrateCloudStyle(style: string): SceneProfile['cloudStyle'] {
  if (style === 'cirrus' || style === 'cirrus-natural') return 'cirrus-feathered';
  if (style === 'wispy') return 'soft';
  if (style === 'illustrated') return 'cumulus';
  return ['soft', 'cumulus', 'cirrus-feathered', 'storm'].includes(style) ? style as SceneProfile['cloudStyle'] : 'cumulus';
}
