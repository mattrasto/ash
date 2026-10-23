export type PreparationAssetKey = 'source' | 'mask' | 'candidate' | 'depth' | 'surfaces';
export type ModelRole = 'sky' | 'surfaces' | 'depth';
export interface SceneModelFile { path: string; sha256: string; bytes: number }
export interface SceneModelPin { role: ModelRole; id: string; revision: string; files: SceneModelFile[] }
/** Installation is a separate, explicit operation. Playback never installs or loads these models. */
export interface SceneModelInstallation { runtimeVersion: '4.3.1'; cacheRoot: string; models: SceneModelPin[] }
export interface PreparationAvailability { available: boolean; issues: string[] }
export interface PreparationOptions { signal?: AbortSignal; onProgress?: (stage: string) => void }
export interface PreparedScene {
  width: number;
  height: number;
  assets: Record<PreparationAssetKey, Buffer>;
  provenance: {
    recipe: 'sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1';
    sourceHash: string;
    runtime: string;
    models: SceneModelPin[];
    durationMs: number;
    diagnostics: {
      horizonCrops: number; shorelineCrops: number; correctedPixels: number;
      labels: string[]; surfaceLabels: string[]; depthNormalization: { low: number; high: number; percentiles: number[]; near: string; units: string; bits: number; sky: number };
      workerThreadId: number;
    };
    warnings: string[];
  };
  geometry: {
    skyCoverage: number;
    surfaceCoverage: Record<'other' | 'terrain' | 'vegetation' | 'water' | 'structure' | 'sky', number>;
    horizon: { samples: number[]; median: number; min: number; max: number };
    foregroundDepth: { p10: number; p50: number; p90: number };
    palette: { sky: [number, number, number]; land: [number, number, number] };
    landLuminanceRange: [number, number];
    /** Proposed automatic crop; verification still owns framing safety. */
    framing: { mode: 'cover'; orientation: 0 };
  };
}
export interface Segmentation { label: string; mask: { data: Uint8Array | Uint8ClampedArray; width?: number; height?: number } }
/** Local inference boundary, injectable only through trusted host code or a test worker module. */
export interface PreparationInference {
  sky(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Segmentation[]>;
  surfaces(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Segmentation[]>;
  depth(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Float32Array | Float64Array>;
  dispose?(): Promise<void>;
}
