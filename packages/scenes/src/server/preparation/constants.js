export const RECIPE = 'sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1';
export const RUNTIME_VERSION = '4.3.1';
export const MODEL_IDS = Object.freeze({
  sky: 'Xenova/segformer-b0-finetuned-ade-512-512',
  surfaces: 'Xenova/segformer-b2-finetuned-ade-512-512',
  depth: 'onnx-community/depth-anything-v2-small',
});
export const SURFACES = Object.freeze([
  { id: 0, key: 'other' }, { id: 1, key: 'terrain' }, { id: 2, key: 'vegetation' },
  { id: 3, key: 'water' }, { id: 4, key: 'structure' }, { id: 5, key: 'sky' },
]);
export const PREPARATION_LIMITS = Object.freeze({ sourceBytes: 24 * 1024 * 1024, outputBytes: 128 * 1024 * 1024, assetBytes: 24 * 1024 * 1024, pixels: 8_294_400, dimension: 4096, timeoutMs: 300_000 });
