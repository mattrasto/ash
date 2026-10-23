import { fixtureManifests } from '../fixtures/manifests.ts';
import { DEFAULT_SCENE_ID, RETIRED_SCENE_IDS, type ResolvedSceneBundle, type SceneAssetKey } from '../contracts.ts';

// Literal URLs let Vite package all approved files for first launch without a server or inference.
const urls: Record<string, Record<SceneAssetKey, string>> = {
  'lake-panorama-v3': {
    source: new URL('../fixtures/assets/lake-panorama-v1.png', import.meta.url).href,
    mask: new URL('../fixtures/assets/lake-panorama-v1-mask.png', import.meta.url).href,
    candidate: new URL('../fixtures/assets/lake-panorama-v1-candidate.png', import.meta.url).href,
    depth: new URL('../fixtures/assets/lake-panorama-v1-depth.png', import.meta.url).href,
    surfaces: new URL('../fixtures/assets/lake-panorama-v1-surfaces.png', import.meta.url).href,
  },
  'valley-panorama-v3': {
    source: new URL('../fixtures/assets/valley-panorama-v1.png', import.meta.url).href,
    mask: new URL('../fixtures/assets/valley-panorama-v1-mask.png', import.meta.url).href,
    candidate: new URL('../fixtures/assets/valley-panorama-v1-candidate.png', import.meta.url).href,
    depth: new URL('../fixtures/assets/valley-panorama-v1-depth.png', import.meta.url).href,
    surfaces: new URL('../fixtures/assets/valley-panorama-v1-surfaces.png', import.meta.url).href,
  },
  'meadow-panorama-v3': {
    source: new URL('../fixtures/assets/meadow-panorama-v1.png', import.meta.url).href,
    mask: new URL('../fixtures/assets/meadow-panorama-v1-mask.png', import.meta.url).href,
    candidate: new URL('../fixtures/assets/meadow-panorama-v1-candidate.png', import.meta.url).href,
    depth: new URL('../fixtures/assets/meadow-panorama-v1-depth.png', import.meta.url).href,
    surfaces: new URL('../fixtures/assets/meadow-panorama-v1-surfaces.png', import.meta.url).href,
  },
};
export const bundledScenes: readonly ResolvedSceneBundle[] = fixtureManifests.filter(manifest=>!RETIRED_SCENE_IDS.includes(manifest.id)).map(manifest => ({ manifest, assetUrls: urls[manifest.id]! }));
export const fallbackScene = bundledScenes.find(scene => scene.manifest.id === DEFAULT_SCENE_ID) ?? bundledScenes[0]!;
