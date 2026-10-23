import { DEFAULT_LOCATION, SCENE_ASSET_KEYS, validateLocation, validateSceneBundle, type SceneBundle, type ResolvedSceneBundle, type SceneLocation, type ScenePhase, type ScenePlaybackStatus } from '../contracts.ts';
import { phaseSolarState,type SolarState } from '../timing.ts';
import { prepareSceneAssets, retainSceneAssets } from './assets.ts';
import { SceneRenderer } from './engine/renderer.js';
import {sceneTuning,scenePreview,localSceneMinutes,scrubbedSolar,tuningProfile,type SceneTuning} from './scene-tuning.ts';

export class ScenePlaybackController {
  readonly renderer: SceneRenderer;
  private phase: ScenePhase = 'automatic';
  private location: SceneLocation = DEFAULT_LOCATION;
  private request?: AbortController;
  private sequence = 0;
  private disposed = false;
  private timer: ReturnType<typeof setInterval>;
  private active?: ResolvedSceneBundle;
  private previousHashes: string[] = [];
  private retainedPreviousHashes?: string[];
  private paused = false;
  private phaseAnchor?:number;
  private heldSolar?:SolarState;
  private listeners = new AbortController();
  private tuning?:SceneTuning;
  private tuningOff:()=>void;
  private tuningTimer?:ReturnType<typeof setInterval>;
  private scrubSolar?:SolarState;
  constructor(private canvas: HTMLCanvasElement, private onStatus: (status: ScenePlaybackStatus) => void = () => {}) {
    this.renderer = new SceneRenderer(canvas);
    this.tuningOff=sceneTuning.subscribe(value=>{
      const previous=this.tuning;this.tuning=value;
      if(value.enabled||previous?.enabled)this.applyTuning();
      if(value.time!==previous?.time)this.clock(true);
      if(value.open&&!this.tuningTimer)this.tuningTimer=setInterval(()=>this.publishTuning(),200);
      else if(!value.open){clearInterval(this.tuningTimer);this.tuningTimer=undefined;}
    });
    this.clock(false);
    this.timer = setInterval(() => { if (!document.hidden) this.clock(false); }, 30000);
    const signal = this.listeners.signal;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.clock(false); }, { signal });
    canvas.addEventListener('waterstate', () => this.reportReady(), { signal });
    window.addEventListener('pageshow', () => this.clock(false), { signal });
  }
  setContext(phase: ScenePhase, location: SceneLocation = DEFAULT_LOCATION, paused = false, phaseAnchor?:number): void {
    if (this.disposed) return;
    const changed = phase !== this.phase || JSON.stringify(location) !== JSON.stringify(this.location)||phaseAnchor!==this.phaseAnchor;
    const phaseChanged=phase!==this.phase;
    if(changed){this.heldSolar=undefined;this.scrubSolar=undefined;}
    this.phaseAnchor=phaseAnchor;
    this.phase = phase; this.location = validateLocation(location);
    if (paused !== this.paused) { this.paused = paused; this.renderer.pause(paused); }
    if(phaseChanged&&this.tuning?.time!==null)sceneTuning.update(value=>({...value,time:null}));
    this.clock(changed); this.reportReady();
  }
  clock(transition = false, now: Date | number = Date.now()): void {
    if (!this.disposed) {
      if(this.tuning?.enabled&&this.tuning.time!==null){
        this.scrubSolar??=scrubbedSolar(this.tuning.time,this.phaseAnchor??Number(now),this.location);
        this.renderer.scrubSolar(this.scrubSolar);this.publishTuning();return;
      }
      const state=this.phase==='automatic'?phaseSolarState(now,this.location,this.phase):(this.heldSolar??=phaseSolarState(this.phaseAnchor??now,this.location,this.phase));
      this.renderer.setSolar(state, transition);
      this.publishTuning();
    }
  }
  private applyTuning():void{
    this.scrubSolar=undefined;
    if(!this.active)return;
    const value=this.tuning,override=value?.enabled?value.drafts[this.active.manifest.id]:undefined;
    this.renderer.set({...tuningProfile(this.active.manifest.profile,override),shadowProjection:'depth',cloudSync:false,
      ...(value?.enabled&&value.cloudPosition!==null?{cloudPosition:value.cloudPosition,speed:0}:{})});
    this.publishTuning();
  }
  private publishTuning():void{
    if(!this.tuning?.enabled||!this.active)return;
    const settings=this.renderer.settings;
    scenePreview.set({id:this.active.manifest.id,name:this.active.manifest.name,profile:this.active.manifest.profile,
      waterAvailable:this.renderer.waterPresent(),time:localSceneMinutes(settings.solar?.timestamp??Date.now(),this.location),
      cloudPosition:Number(settings.cloudPosition)||0,reducedMotion:this.renderer.reduced.matches});
  }
  setRetainedPrevious(manifest?: SceneBundle | null): void {
    if (manifest) validateSceneBundle(manifest);
    this.retainedPreviousHashes = manifest === undefined ? undefined : manifest ? SCENE_ASSET_KEYS.map(key => manifest.assets[key].sha256) : [];
    if (!this.active && this.retainedPreviousHashes) this.previousHashes = this.retainedPreviousHashes;
  }
  async load(bundle: ResolvedSceneBundle): Promise<boolean> {
    if (this.disposed) return false;
    const sequence = ++this.sequence; this.request?.abort(); this.renderer.cancelLoad(); const request = new AbortController(); this.request = request;
    const start = performance.now(); this.onStatus({ state: 'loading', sceneId: bundle.manifest.id, water: 'absent' });
    let prepared: Awaited<ReturnType<typeof prepareSceneAssets>> | undefined;
    try {
      prepared = await prepareSceneAssets(bundle, request.signal); request.signal.throwIfAborted();
      if (sequence !== this.sequence || this.disposed) return false;
      const loaded = await this.renderer.load({ width: bundle.manifest.width, height: bundle.manifest.height, ...prepared.urls });
      if (!loaded || sequence !== this.sequence || this.disposed) return false;
      // Playback fills the workspace even for legacy manifests reviewed with square margins.
      this.renderer.set({ ...bundle.manifest.profile, framing: 'cover', orientation: bundle.manifest.framing.orientation });
      const oldHashes = this.active ? SCENE_ASSET_KEYS.map(key => this.active!.manifest.assets[key].sha256) : [];
      const hashes = SCENE_ASSET_KEYS.map(key => bundle.manifest.assets[key].sha256);
      this.previousHashes = oldHashes.length ? oldHashes : (this.retainedPreviousHashes ?? this.previousHashes);
      this.active = bundle; this.applyTuning();this.clock(false); this.reportReady(performance.now() - start);
      void retainSceneAssets([...hashes, ...this.previousHashes]); return true;
    } catch (error) {
      if (sequence === this.sequence && !this.disposed && !request.signal.aborted) this.onStatus({ state: 'error', sceneId: bundle.manifest.id, water: this.waterState(), error: error instanceof Error ? error.message : 'Scene could not be loaded.' });
      if (sequence === this.sequence) void retainSceneAssets([...(this.active ? SCENE_ASSET_KEYS.map(key => this.active!.manifest.assets[key].sha256) : []), ...this.previousHashes]);
      return false;
    } finally { prepared?.dispose(); }
  }
  private waterState(): ScenePlaybackStatus['water'] {
    if (!this.active || !this.active.manifest.profile.water) return 'absent';
    if (!this.renderer.waterPresent()) return 'absent';
    if (!this.renderer.waterAvailable()) return 'still';
    return this.paused || this.renderer.reduced.matches ? 'still' : 'animated';
  }
  private reportReady(loadMs?: number): void { if (this.active && !this.disposed) this.onStatus({ state: 'ready', sceneId: this.active.manifest.id, water: this.waterState(), ...(loadMs === undefined ? {} : { loadMs }) }); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.sequence++; this.request?.abort(); clearInterval(this.timer);clearInterval(this.tuningTimer);this.tuningOff(); this.listeners.abort(); this.renderer.dispose(); }
}
