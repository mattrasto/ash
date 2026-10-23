import type { SolarState } from '../../timing.ts';
export class SceneRenderer {
  constructor(canvas: HTMLCanvasElement);
  settings: Record<string, unknown> & { solar?: SolarState };
  metrics: {frames: number; totalMs: number; samples:number[]};
  reduced: MediaQueryList;
  load(scene: {width:number;height:number;source:string;mask:string;candidate:string;depth:string;surfaces:string}): Promise<boolean>;
  set(settings: Record<string, unknown>): void;
  setSolar(solar: SolarState, transition?: boolean): void;
  scrubSolar(solar: SolarState): void;
  pause(paused?: boolean): void;
  cancelLoad(): void;
  hover(x: number | null, y?: number): void;
  resize(): void;
  geometry(): {viewport:{width:number;height:number};backing:{width:number;height:number};nativeArt:{width:number;height:number};effects:{width:number;height:number};artwork:{x:number;y:number;width:number;height:number};sourceCrop:{x:number;y:number;width:number;height:number}} | null;
  request(): void;
  dispose(): void;
  nightVisible(): boolean;
  waterAvailable(): boolean;
  waterPresent(): boolean;
}
