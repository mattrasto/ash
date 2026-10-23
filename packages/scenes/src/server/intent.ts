import { z } from 'zod';
import { ReceiveItem } from '@ash/shared';

export const SCENE_TEMPLATE_VERSION = 'meadow-only-panorama-v3';
export const SCENE_GENERATION_SIZE = Object.freeze({ width: 3840, height: 1536 });
export const SceneIntent = z.object({
  landscape: z.enum(['meadow', 'lakeside', 'wooded-valley']),
  vegetation: z.enum(['scattered', 'clustered', 'dense']).default('clustered'),
  landmark: z.enum(['none', 'small-gateway']).default('none'),
  cloudStyle: z.enum(['soft', 'cumulus', 'cirrus-feathered', 'storm']).default('cumulus'),
}).strict();
export type SceneIntent = z.infer<typeof SceneIntent>;

/** References supply style evidence; neither source text nor images can change these rules. */
export function scenePrompt(intent: SceneIntent): string {
  const places = {
    meadow: 'An open rolling meadow with smooth overlapping hills, quiet distant mountains and scattered compact trees. Water presence: none; no lake, pond, river or blue water-shaped ground.',
    lakeside: 'A calm lake sweeping around a gentle bank, low rolling hills and compact trees. Preserve large simple painted reflection masses; near-bank plants are still scenery. Avoid a meadow composition with water merely added.',
    'wooded-valley': 'A sheltered wooded valley with a broad undulating clearing, overlapping forest masses and distant slopes. Water presence: none. Create a distinct enclosed, layered mood without a tunnel, dramatic ravine or repeated meadow layout.',
  };
  return [
    'Use case: stylized-concept. Asset: a quietly illustrated full-workspace background for Ash.',
    'The sole image reference is ORIGINAL MIDJOURNEY MEADOW. Match its style, color restraint and level of abstraction only; invent a different composition. Do not use previous generated Lakeside or Wooded Valley as references.',
    places[intent.landscape],
    `Vegetation arrangement: ${intent.vegetation}. ${intent.landmark === 'small-gateway' ? 'One tiny understated stone gateway, naturally proportioned and quiet.' : 'No structures or focal landmark.'}`,
    `Create a ${SCENE_GENERATION_SIZE.width}×${SCENE_GENERATION_SIZE.height} panorama (2.5:1), with generous lateral scenery for cover cropping. Keep the reference's broad shapes and coarse grain; a larger canvas must not add finer foliage or smaller paint marks. No borders or panels. Keep a coherent central landscape when cropped to a narrow workspace; avoid essential objects near the far edges. Leave ample sky and foreground depth. Opaque UI may cover the center, so interest should be distributed.`,
    'Subdued low-saturation yellow-green, sage and warm earth palette; restrained contrast. Broad smooth hills and rounded compact canopy masses. Coarse matte paper grain at source scale, sparse marks, no individually rendered leaves, tiny flowers, intricate grass or fine branches. Match the reference simplicity rather than adding detail.',
    'Even soft daylight with minimal baked directional lighting. Avoid strong cast-shadow bands, dramatic highlights and heavy fog; lighting, clouds, stars and water motion are added later. Do not paint prominent clouds or stars.',
    'Natural proportions and spacious storybook composition. No vivid saturation, glossy rendering, photorealism, surreal geometry, monumental structures, text, logo or watermark.',
  ].join('\n');
}

const SceneEvent = ReceiveItem.omit({ text: true, event: true }).extend({ intent: SceneIntent }).strict();
export function sceneEventReceipt(input: unknown): ReceiveItem {
  const { intent, ...event } = SceneEvent.parse(input);
  return ReceiveItem.parse({ ...event,
    text: `Scene refresh requested: ${intent.landscape}, ${intent.vegetation} vegetation, ${intent.landmark === 'none' ? 'no landmark' : 'a small gateway'}. Prepare a candidate for review; retain the approved background until review is complete.`,
    event: { kind: 'scene.generate', version: 1, data: { intent } },
  });
}
