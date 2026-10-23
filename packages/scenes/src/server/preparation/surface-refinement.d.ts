import type { Segmentation } from './types.ts';
export function shorelineCrops(surfaces: Uint8Array, width: number, height: number): {left: number; top: number; width: number; height: number}[];
export function refineWaterBoundaries(rgb: Uint8Array, sky: Uint8Array, coarse: Uint8Array, depth: Uint8Array, width: number, height: number, segment: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<Segmentation[]>, progress?: (stage: string) => void): Promise<{pixels: Buffer; coverage: Record<string, number>; cropCount: number; correctedPixels: number}>;
