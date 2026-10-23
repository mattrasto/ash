import type { CodingRequest, ModelExecution, AdaptCheckpoint,AdaptPreviewCommand,AdaptPreviewState } from '@ash/shared';
import type { AdaptApplicationView,AdaptRefreshRequest,AdaptRefreshResult } from '@ash/shared';

export interface SourceSnapshot {revision:string;tree:string;archive:Buffer}
export interface EnvironmentLease {id:string;generation:number}
export interface HarnessSession {id:string}
export interface CodingInput {text:string;images:string[]}
export interface RequiredInput {id:string;turnId:string;question:string;reason:string}
export interface HarnessObservation {
  status:'working'|'waiting'|'completed'|'failed'|'cancelled';text:string;questions:RequiredInput[];
  model?:ModelExecution;error?:string;
}
export interface EnvironmentProvider {
  readonly id:string;
  prepare(key:string,source:SourceSnapshot,checkpoint:AdaptCheckpoint|null,generation:number):Promise<EnvironmentLease>;
  ready(lease:EnvironmentLease):Promise<boolean>;
  release(lease:EnvironmentLease):Promise<void>;
}
export interface CodingHarness {
  readonly id:string;readonly model:string;readonly configuration?:CodingRequest['configuration'];
  create(key:string,lease:EnvironmentLease,request:CodingRequest):Promise<HarnessSession>;
  find(key:string):Promise<HarnessSession|null>;
  submit(session:HarnessSession,input:CodingInput,key:string):Promise<void>;
  observe(session:HarnessSession):Promise<HarnessObservation>;
  answer(session:HarnessSession,question:RequiredInput,value:unknown,key:string):Promise<void>;
  cancel(session:HarnessSession,key:string):Promise<void>;
  checkpoint(session:HarnessSession):Promise<{patch:string;tree:string;checks:string}>;
  close(session:HarnessSession):Promise<void>;
}
export interface CodingBinding {
  id:string;label:string;harness:CodingHarness;environment:EnvironmentProvider;
  capabilities:{steering:boolean;prewarming:boolean;forceDestroy:boolean};
}
export class AdaptError extends Error {constructor(readonly status:number,message:string){super(message);}}
export class EnvironmentExpired extends Error {}
export class DispatchUnknown extends Error {}
export class ProviderFailure extends Error {constructor(readonly retryable:boolean,readonly code:string,message:string){super(message);}}

/** Native presentation is independent of the remote coding runtime. */
export interface PreviewController {
  readonly available:boolean;
  status(workspaceId:string):Promise<AdaptPreviewState>;
  command(workspace:{id:string;threadId:string;checkpoint:AdaptCheckpoint|null},command:AdaptPreviewCommand):Promise<AdaptPreviewState>;
  /** Follow a checkpoint only while its preview is open; never reopen a closed window. */
  sync(workspace:{id:string;threadId:string;checkpoint:AdaptCheckpoint|null}):Promise<AdaptPreviewState>;
}

/** Protected local verification/version switching is independent of coding and previews. */
export interface ApplicationController {
  readonly available:boolean;
  readonly unavailableReason?:string;
  status(candidateId?:string):Promise<AdaptApplicationView>;
  prepare(input:{candidateId:string;workspaceId:string;threadId:string;checkpoint:AdaptCheckpoint;action:'apply'|'restore';baselineVersion?:string}):Promise<AdaptApplicationView>;
  refresh?(input:AdaptRefreshRequest):Promise<AdaptRefreshResult>;
  apply(candidateId:string,decisionId:string):Promise<AdaptApplicationView>;
}
