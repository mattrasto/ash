import type {SceneProfile} from './contracts.ts';

/** Starting points for authored/generated scene profiles; weather modifiers are future work. */
export const SCENE_BASELINE=Object.freeze({daylight:90,waterStrength:140,waterSpeed:70,waterReflections:60});
export type CloudStyleSettings=Pick<SceneProfile,'amount'|'speed'> & Partial<Pick<SceneProfile,'shadowStrength'|'shadowSoftness'>>;
export const CLOUD_STYLE_DEFAULTS:Readonly<Record<SceneProfile['cloudStyle'],CloudStyleSettings>>=Object.freeze({
  cumulus:{amount:60,speed:100,shadowStrength:25,shadowSoftness:20},
  'cirrus-feathered':{amount:50,speed:50},
  soft:{amount:60,speed:80,shadowStrength:20,shadowSoftness:50},
  storm:{amount:100,speed:80},
});
