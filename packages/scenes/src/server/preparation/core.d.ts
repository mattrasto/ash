import type { PreparedScene, PreparationInference, SceneModelPin } from './types.ts';
export function prepareWithInference(source: Uint8Array, inference: PreparationInference, options?: {models?: SceneModelPin[]; injected?: boolean; onProgress?: (stage: string) => void}): Promise<PreparedScene>;
