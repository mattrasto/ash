import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import type { ToolJson } from '@ash/shared';
import { SCENE_ASSET_KEYS,SCENE_ARTWORK_LIMITS,validSceneArtworkSize, type SceneAsset, type SceneAssetKey, type SceneBundle, type SceneProfile } from '../contracts.ts';
import { SceneIntent, scenePrompt, SCENE_TEMPLATE_VERSION, SCENE_GENERATION_SIZE } from './intent.ts';
import { automaticSceneProfile } from './profile.ts';
import { SceneError, sceneHash, serializeScene, validateSceneAssetPixels } from './storage.ts';
import type { SceneService } from './service.ts';

export interface SceneWorkContext { runId: string; threadId: string; callId: string; signal: AbortSignal }
export interface SceneWorkScope { inputId: string; callArtifactId: string; intent?: SceneIntent }
/** Host transactions check the live Run and tool-call state before each capture. */
export interface SceneExecutionHost {
  scope(context: SceneWorkContext): Promise<SceneWorkScope>;
  capture(context: SceneWorkContext, sourceId: string, payload: { type: 'feature_evidence'; feature: 'scenes'; stage: string; data: ToolJson }): Promise<string>;
}
export function sceneExecutionHost(base: {
  scope(context: SceneWorkContext): Promise<SceneWorkScope & { event?: { kind: string; version: number; data: Record<string, ToolJson> } }>;
  capture: SceneExecutionHost['capture'];
}): SceneExecutionHost {
  return { capture: base.capture,
    async scope(context) {
      const scope = await base.scope(context);
      if (scope.event?.kind !== 'scene.generate') return scope;
      if (scope.event.version !== 1) throw new SceneWorkflowFailure('scene_event_version', 'This scene event has an unsupported version.');
      return { ...scope, intent: SceneIntent.parse(scope.event.data.intent) };
    } };
}
const Configuration = z.object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(200),
  options: z.object({ quality: z.string().max(80).nullable(), format: z.literal('png'), width: z.number().int().positive(), height: z.number().int().positive(), seed: z.number().int().nullable() }).strict(),
}).strict();
const GenerationMetadata = z.object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(200), requestId: z.string().max(256).nullable(), seed: z.number().int().nullable(),
  usage: z.object({ inputTokens: z.number().finite().nonnegative().optional(), outputTokens: z.number().finite().nonnegative().optional(), images: z.number().int().nonnegative().optional(), costUsd: z.number().finite().nonnegative().optional() }).strict().nullable(),
}).strict();
export type SceneGeneratorConfiguration = z.infer<typeof Configuration>;
export interface SceneGenerationRequest {
  configuration: SceneGeneratorConfiguration; prompt: string; templateVersion: string; intent: SceneIntent;
  reference: { role: 'style-only'; sceneId: 'meadow'; sha256: string; bytes: Uint8Array };
  recent: { id: string; sourceHash: string }[];
}
export interface SceneGenerationAdapter {
  availability(): Promise<{ available: boolean; issues: string[] }>;
  configuration(): SceneGeneratorConfiguration;
  /** Exactly one dispatch; implementations must disable automatic provider retries. */
  generate(request: SceneGenerationRequest, signal: AbortSignal): Promise<{ bytes: Uint8Array; metadata: {
    provider: string; model: string; requestId: string | null; seed: number | null;
    usage: { inputTokens?: number; outputTokens?: number; images?: number; costUsd?: number } | null;
  } }>;
}
export interface ScenePreparationAdapter {
  availability(): Promise<{ available: boolean; issues: string[] }>;
  prepare(source: Uint8Array, options: { signal?: AbortSignal }): Promise<{
    width: number; height: number; assets: Record<SceneAssetKey, Buffer>;
    provenance: unknown;
    geometry: { skyCoverage: number; surfaceCoverage: Record<string, number> };
  }>;
}
export interface SceneCandidate {
  version: 1; id: string; inputId: string; runId: string; status: 'review'; createdAt: string;
  manifest: Omit<SceneBundle, 'verification'>;
  gates: Record<'art' | 'preparation' | 'rendering' | 'motion', { status: 'review'; reason: string }>;
  evidenceHash: string; evidenceArtifactId: string;
}
export class SceneWorkflowFailure extends Error {
  constructor(readonly code: string, message: string, readonly effect: 'none' | 'unknown' = 'none') { super(message); }
}
const uuid = (value: string) => z.string().uuid().parse(value);
const json = (value: unknown): ToolJson => {
  const text = serializeScene(value);
  if (Buffer.byteLength(text) > 512 * 1024) throw new SceneWorkflowFailure('scene_capture_limit', 'Scene evidence exceeds its capture limit.');
  return JSON.parse(text);
};
const MAX_SOURCE = 24 * 1024 * 1024;
const MAX_CANDIDATES = 512 * 1024 * 1024;

/** Owned unapproved evidence. It cannot be loaded as an approved playback manifest. */
export class SceneCandidateStorage {
  readonly root: string;
  constructor(private instanceRoot: string) { this.root = join(instanceRoot, 'files', 'scene-candidates'); }
  private async directory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SceneError(409, 'Candidate storage is not a regular instance directory.');
  }
  async prepare() { for (const path of [this.instanceRoot, join(this.instanceRoot, 'files'), this.root, join(this.root, 'events')]) await this.directory(path); }
  async write(path: string, bytes: string | Uint8Array) {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  }
  private async read(path: string, limit: number) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new SceneError(409, 'Candidate evidence is invalid.');
      return await file.readFile();
    } finally { await file.close(); }
  }
  private async usage() {
    let total = 0;
    const events = await readdir(join(this.root, 'events'), { withFileTypes: true });
    if (events.length >= 512) throw new SceneWorkflowFailure('scene_candidate_record_limit', 'Scene candidate history reached its record limit. Review retained evidence before requesting another scene.');
    for (const entry of events) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/.test(entry.name)) throw new SceneError(409, 'Candidate history contains an unsupported entry.');
      const stat = await lstat(join(this.root, 'events', entry.name));
      if (stat.isSymbolicLink() || stat.nlink !== 1) throw new SceneError(409, 'Candidate history is not regular instance metadata.');
      total += stat.size;
    }
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue;
      for (const file of await readdir(join(this.root, entry.name), { withFileTypes: true })) {
        if (!file.isFile()) throw new SceneError(409, 'Candidate storage contains an unsupported entry.');
        total += (await lstat(join(this.root, entry.name, file.name))).size;
      }
    }
    return total;
  }
  async claim(inputId: string, callId: string, intentHash: string): Promise<{ fresh: boolean; callId: string }> {
    await this.prepare();
    const prior = await this.prior(inputId, intentHash);
    if (prior) return { fresh: false, callId: prior };
    const path = join(this.root, 'events', `${uuid(inputId)}.json`);
    if (await this.usage() + 128 * 1024 * 1024 > MAX_CANDIDATES) throw new SceneWorkflowFailure('scene_candidate_storage_full', 'Scene candidate storage is full. Review or remove retained candidates before generating another.');
    try { await this.write(path, serializeScene({ callId: uuid(callId), intentHash })); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = JSON.parse(String(await this.read(path, 4096)));
      if (previous.intentHash !== intentHash) throw new SceneWorkflowFailure('scene_event_changed', 'This event already captured a different scene intent.');
      return { fresh: false, callId: uuid(previous.callId) };
    }
    await this.directory(join(this.root, uuid(callId)));
    return { fresh: true, callId };
  }
  async prior(inputId: string, intentHash: string): Promise<string | null> {
    await this.prepare();
    let bytes: Buffer;
    try { bytes = await this.read(join(this.root, 'events', `${uuid(inputId)}.json`), 4096); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const previous = JSON.parse(String(bytes));
    if (previous.intentHash !== intentHash) throw new SceneWorkflowFailure('scene_event_changed', 'This event already captured a different scene intent.');
    return uuid(previous.callId);
  }
  async saveAssets(id: string, assets: Record<SceneAssetKey, Buffer>, width: number, height: number) {
    const metadata = {} as Record<SceneAssetKey, SceneAsset>;
    for (const key of SCENE_ASSET_KEYS) {
      const bytes = assets[key];
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_SOURCE) throw new SceneWorkflowFailure('scene_asset_invalid', 'Prepared scene assets exceed their bounds.');
      const sha256 = sceneHash(bytes), asset: SceneAsset = { path: `assets/${key}.png`, sha256, bytes: bytes.length, width, height, mediaType: 'image/png' };
      await validateSceneAssetPixels(bytes, asset, key);
      try { await this.write(join(this.root, uuid(id), sha256), bytes); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || sceneHash(await this.read(join(this.root, id, sha256), MAX_SOURCE)) !== sha256) throw error; }
      metadata[key] = asset;
    }
    return metadata;
  }
  async save(candidate: SceneCandidate) {
    const data = serializeScene(candidate);
    if (Buffer.byteLength(data) > 512 * 1024) throw new SceneWorkflowFailure('scene_evidence_limit', 'Scene evidence exceeds its capture limit.');
    await this.write(join(this.root, uuid(candidate.id), 'candidate.json'), serializeScene({ hash: sceneHash(data), data: candidate }));
  }
  async get(id: string): Promise<SceneCandidate> {
    try {
      const path = join(this.root, uuid(id));
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
      const saved = JSON.parse(String(await this.read(join(path, 'candidate.json'), 600 * 1024)));
      if (sceneHash(serializeScene(saved.data)) !== saved.hash || saved.data.id !== id || saved.data.status !== 'review') throw new Error();
      return saved.data;
    } catch { throw new SceneError(404, 'This completed scene candidate is unavailable.'); }
  }
  async asset(id: string, hash: string) {
    const candidate = await this.get(id);
    const asset = Object.values(candidate.manifest.assets).find(asset => asset.sha256 === hash);
    if (!asset || !/^[a-f0-9]{64}$/.test(hash)) throw new SceneError(404, 'This asset does not belong to the candidate.');
    const bytes = await this.read(join(this.root, id, hash), MAX_SOURCE);
    if (bytes.length !== asset.bytes || sceneHash(bytes) !== hash) throw new SceneError(409, 'The candidate asset is damaged.');
    return bytes;
  }
}

export class SceneWorkflow {
  readonly candidates: SceneCandidateStorage;
  private mutations: Promise<unknown> = Promise.resolve();
  private executing = false;
  constructor(private options: { scenes: SceneService; instanceRoot: string; host: SceneExecutionHost; generator?: SceneGenerationAdapter; preparer: ScenePreparationAdapter }) {
    this.candidates = new SceneCandidateStorage(options.instanceRoot);
  }
  async availability() {
    let generation = { available: false, issues: ['No backend image generator is configured. The interactive built-in image tool is available only in Codex.'] };
    if (this.options.generator) {
      try { generation = await this.options.generator.availability(); }
      catch { generation = { available: false, issues: ['The backend image generator is unavailable.'] }; }
    }
    const preparation = await this.options.preparer.availability();
    return { available: generation.available && preparation.available, issues: [...generation.issues, ...preparation.issues] };
  }
  configuration(): SceneGeneratorConfiguration | null { return this.options.generator ? Configuration.parse(this.options.generator.configuration()) : null; }
  async execute(intent: SceneIntent, context: SceneWorkContext, expectedConfiguration?: SceneGeneratorConfiguration | null): Promise<SceneCandidate> {
    if (this.executing) throw new SceneWorkflowFailure('scene_pipeline_busy', 'Another scene candidate is being created. The approved background has been kept.');
    this.executing = true;
    try { return await this.run(intent, context, expectedConfiguration); } finally { this.executing = false; }
  }
  private async run(intent: SceneIntent, context: SceneWorkContext, expectedConfiguration?: SceneGeneratorConfiguration | null): Promise<SceneCandidate> {
    context.signal.throwIfAborted();
    const scope = await this.options.host.scope(context);
    if (scope.intent && serializeScene(scope.intent) !== serializeScene(intent)) throw new SceneWorkflowFailure('scene_intent_changed', 'Use the structured intent captured by this scene event.');
    const intentHash = sceneHash(serializeScene(intent));
    const prior = await this.candidates.prior(scope.inputId, intentHash);
    if (prior) {
      try { return await this.candidates.get(prior); }
      catch { throw new SceneWorkflowFailure('scene_outcome_requires_reconciliation', 'This event already began a scene attempt. Inspect its captured outcome before requesting a new event; generation was not repeated.', 'unknown'); }
    }
    const readiness = await this.availability();
    if (!readiness.available) throw new SceneWorkflowFailure('scene_unavailable', readiness.issues.join(' ').slice(0, 1000));
    // Serialize admission/storage reservations without blocking unrelated Runs or rendering.
    const admission = this.mutations.then(() => this.candidates.claim(scope.inputId, context.callId, intentHash));
    this.mutations = admission.catch(() => undefined);
    const claim = await admission;
    if (!claim.fresh) {
      try { return await this.candidates.get(claim.callId); }
      catch { throw new SceneWorkflowFailure('scene_outcome_requires_reconciliation', 'This event already began a scene attempt. Inspect its captured outcome before requesting a new event; generation was not repeated.', 'unknown'); }
    }
    const capture = async (stage: string, data: unknown) => {
      context.signal.throwIfAborted();
      parent = await this.options.host.capture(context, parent, { type: 'feature_evidence', feature: 'scenes', stage, data: json(data) });
    };
    let parent = scope.callArtifactId, dispatched = false;
    try {
      const state = await this.options.scenes.getState();
      const meadow = await this.options.scenes.getBundle('meadow');
      const reference = await this.options.scenes.readAsset('meadow', meadow.assets.source.sha256);
      const recent = [state.manifest, state.previous].filter((scene): scene is SceneBundle => !!scene).map(scene => ({ id: scene.id, sourceHash: scene.assets.source.sha256 }));
      const configuration = Configuration.parse(this.options.generator!.configuration());
      if (expectedConfiguration !== undefined && serializeScene(configuration) !== serializeScene(expectedConfiguration)) throw new SceneWorkflowFailure('scene_generator_changed', 'The image generator configuration changed after authorization. Start a new scene request.');
      if (configuration.options.width !== SCENE_GENERATION_SIZE.width || configuration.options.height !== SCENE_GENERATION_SIZE.height) throw new SceneWorkflowFailure('scene_generation_size', 'The generator must support the configured wide artwork size.');
      const request: SceneGenerationRequest = { configuration, intent, prompt: scenePrompt(intent), templateVersion: SCENE_TEMPLATE_VERSION,
        reference: { role: 'style-only', sceneId: 'meadow', sha256: meadow.assets.source.sha256, bytes: reference.bytes }, recent };
      await capture('generation-request', { ...request, reference: { ...request.reference, bytes: reference.bytes.length }, recentScope: 'current-and-previous' });
      context.signal.throwIfAborted(); dispatched = true;
      const generated = await this.options.generator!.generate(request, context.signal);
      context.signal.throwIfAborted();
      const bytes = Buffer.from(generated.bytes);
      if (!bytes.length || bytes.length > MAX_SOURCE) throw new SceneWorkflowFailure('scene_generation_invalid', 'The generator returned an oversized or empty image.');
      const sourceHash = sceneHash(bytes);
      await this.candidates.write(join(this.candidates.root, context.callId, sourceHash), bytes);
      let info: Metadata | undefined;
      try { info = await sharp(bytes, { failOn: 'warning', limitInputPixels: SCENE_ARTWORK_LIMITS.maxPixels }).metadata(); } catch { /* Keep the failed original and its hash in the captured outcome. */ }
      const parsedGeneration = GenerationMetadata.safeParse(generated.metadata);
      const generation = parsedGeneration.success ? parsedGeneration.data : null;
      await capture('generation-result', { sourceHash, bytes: bytes.length, width: info?.width ?? null, height: info?.height ?? null, decoded: !!info, generation });
      if (!info || info.format !== 'png' || !info.width || !info.height || (info.pages ?? 1) !== 1 || (info.orientation ?? 1) !== 1 || !validSceneArtworkSize(info.width,info.height)) throw new SceneWorkflowFailure('scene_generation_framing', 'Generated art must be a still PNG at least 3840×1536, with a 2.5:1 aspect ratio (±1%), no edge above 4096 pixels and no more than 8.29 megapixels. The approved background has been kept.');
      if (recent.some(scene => scene.sourceHash === sourceHash)) throw new SceneWorkflowFailure('scene_duplicate_art', 'The generator returned an unchanged recent scene.');
      if (!generation || generation.provider !== configuration.provider || generation.model !== configuration.model) throw new SceneWorkflowFailure('scene_generation_provenance', 'The generator did not identify the captured provider and model.');
      const prepared = await this.options.preparer.prepare(bytes, { signal: context.signal });
      context.signal.throwIfAborted();
      if (prepared.width !== info.width || prepared.height !== info.height || sceneHash(prepared.assets.source) !== sourceHash) throw new SceneWorkflowFailure('scene_preparation_alignment', 'Preparation changed the original image or its dimensions.');
      const assets = await this.candidates.saveAssets(context.callId, prepared.assets, prepared.width, prepared.height);
      await capture('preparation-result', { assets, provenance: prepared.provenance, geometry: prepared.geometry });
      const profile: SceneProfile = automaticSceneProfile(intent, prepared.geometry, sourceHash);
      await capture('profile-proposal', { version: 'geometry-profile-v1', profile });
      const manifest: Omit<SceneBundle, 'verification'> = {
        kind: 'ash-scene', version: 1, rendererVersion: 1, mapVersion: 1,
        id: context.callId, name: intent.landscape === 'lakeside' ? 'Lakeside' : intent.landscape === 'wooded-valley' ? 'Wooded Valley' : 'Meadow',
        width: prepared.width, height: prepared.height, assets, profile, framing: { mode: 'cover', orientation: 0 },
        provenance: { sourceRepository: 'ash-scene-workflow', sourceRevision: SCENE_TEMPLATE_VERSION,
          generation: { configuration, prompt: request.prompt, templateVersion: request.templateVersion, intent, referenceHash: request.reference.sha256, sourceHash, metadata: generation }, preparation: prepared.provenance },
      };
      const gates: SceneCandidate['gates'] = {
        art: { status: 'review', reason: 'Review style, composition, detail, baked shadows and duplicate appearance against original Meadow.' },
        preparation: { status: 'review', reason: 'Decoding, alignment, hashes and map IDs passed. Visual boundaries still require review.' },
        rendering: { status: 'review', reason: 'Phase, crop, cloud and star evidence must be rendered and reviewed.' },
        motion: { status: 'review', reason: 'Ordered motion evidence is required; still images cannot pass this gate.' },
      };
      const evidenceHash = sceneHash(serializeScene({ manifest, gates }));
      await capture('review-required', { candidateId: context.callId, evidenceHash, gates });
      const candidate: SceneCandidate = { version: 1, id: context.callId, inputId: scope.inputId, runId: context.runId, status: 'review', createdAt: new Date().toISOString(), manifest, gates, evidenceHash, evidenceArtifactId: parent };
      await this.candidates.save(candidate);
      return candidate;
    } catch (error) {
      if (context.signal.aborted) throw error;
      const original = error instanceof SceneWorkflowFailure ? error : new SceneWorkflowFailure('scene_pipeline_failed', 'Scene generation or preparation could not complete. The approved background has been kept.');
      const failure = dispatched ? new SceneWorkflowFailure(original.code, original.message, 'unknown') : original;
      await capture('failed', { code: failure.code, message: failure.message, effect: failure.effect });
      throw failure;
    }
  }
}
