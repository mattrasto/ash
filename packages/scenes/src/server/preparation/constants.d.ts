import type { ModelRole } from './types.ts';
export const RECIPE: 'sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1';
export const RUNTIME_VERSION: '4.3.1';
export const MODEL_IDS: Readonly<Record<ModelRole, string>>;
export const SURFACES: readonly {id: number; key: string}[];
export const PREPARATION_LIMITS: Readonly<{sourceBytes: number; outputBytes: number; assetBytes: number; pixels: number; dimension: number; timeoutMs: number}>;
