import { randomUUID, createHash } from 'node:crypto';
import { Prisma, type Artifact, type PrismaClient, type Run } from '@prisma/client';
import { InputPayload, MessagePayload, RequestPayload, RunState, RunError, RunStatus, ModelExecution, isActive, type ArtifactView, type RunView, type ModelMode } from '@ash/shared';
import { selectContext } from '../context/select.ts';
import { deterministicModel } from '../../platform/models/deterministic.ts';
import { ModelFailure, type ModelAdapter } from '../../platform/models/adapter.ts';

type Tx = Prisma.TransactionClient;
export class ConversationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const order = [{createdAt:'asc' as const}, {id:'asc' as const}];
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
export function artifactView(row: Artifact): ArtifactView {
  const payload = row.layer === 'input' ? InputPayload.parse(row.payload) : row.layer === 'surface' ? MessagePayload.parse(row.payload) : RequestPayload.parse(row.payload);
  return {...row, payload, createdAt:row.createdAt.toISOString(), updatedAt:row.updatedAt.toISOString()};
}
export function runView(row: Run): RunView {
  return {id:row.id, requestKey:row.requestKey, inputArtifactId:row.inputArtifactId, threadId:row.threadId, retryOfId:row.retryOfId,
    status:RunStatus.parse(row.status), state:RunState.parse(row.state), error:row.error === null ? null : RunError.parse(row.error),
    createdAt:row.createdAt.toISOString(), startedAt:row.startedAt?.toISOString() ?? null, endedAt:row.endedAt?.toISOString() ?? null};
}
export class Conversations {
  private jobs = new Map<string, {controller: AbortController; promise: Promise<void>}>();
  private stopping = false;
  constructor(readonly db: PrismaClient, private model: ModelAdapter = deterministicModel, private autoDispatch = true) {}

  async recover() {
    await this.db.run.updateMany({where:{status:{in:['queued','running']}}, data:{status:'interrupted', endedAt:new Date(), error:{code:'server_interrupted', message:'The backend stopped before this response finished. Retry explicitly to continue.'}}});
  }
  async createThread(id: string, title: string) {
    const existing = await this.db.thread.findUnique({where:{id}});
    if (existing) { if (existing.title !== title) throw new ConversationError(409, 'This thread ID already belongs to a different title.'); return existing; }
    const now = new Date();
    try { return await this.db.thread.create({data:{id,title,createdAt:now,updatedAt:now}}); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const saved = await this.db.thread.findUniqueOrThrow({where:{id}});
        if (saved.title === title) return saved;
        throw new ConversationError(409, 'This thread ID already belongs to a different title.');
      }
      throw error;
    }
  }
  listThreads() { return this.db.thread.findMany({where:{isArchived:false}, orderBy:[{updatedAt:'desc'},{id:'asc'}]}); }
  async readThread(threadId: string) {
    return this.db.$transaction(async tx => {
      const thread = await tx.thread.findUnique({where:{id:threadId}});
      if (!thread) throw new ConversationError(404, 'Thread not found.');
      const artifacts = await tx.artifact.findMany({where:{threadId,layer:'surface'},orderBy:order});
      const runs = await tx.run.findMany({where:{threadId},orderBy:order});
      return {thread, artifacts:artifacts.map(artifactView), runs:runs.map(runView)};
    }, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async inspect(id: string) {
    return this.db.$transaction(async tx => {
      let input = await tx.artifact.findUnique({where:{id}});
      if (!input) throw new ConversationError(404, 'Artifact not found.');
      const seen = new Set<string>();
      while (input.sourceId) {
        if (seen.has(input.id)) throw new Error('Cyclic Artifact source');
        seen.add(input.id); input = await tx.artifact.findUniqueOrThrow({where:{id:input.sourceId}});
      }
      const runs = await tx.run.findMany({where:{inputArtifactId:input.id},orderBy:order});
      const artifacts = await tx.artifact.findMany({where:{OR:[{id:input.id},{sourceId:input.id},{runId:{in:runs.map(run=>run.id)}}]},orderBy:order});
      const chain: Artifact[] = [];
      const append = (parent: Artifact) => { chain.push(parent); for (const child of artifacts.filter(item=>item.sourceId===parent.id)) append(child); };
      append(input);
      return {selectedId:id, input:artifactView(input), artifacts:chain.map(artifactView), runs:runs.map(runView)};
    }, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  private existing(row: Run, hash: string) {
    if (row.requestHash !== hash) throw new ConversationError(409, 'This submission key was already used for different content.');
    return row;
  }
  async submit(threadId: string, requestKey: string, text: string, mode: ModelMode) {
    return this.accept(threadId, requestKey, {kind:'send',text,mode});
  }
  async retry(id: string, requestKey: string, mode: ModelMode) {
    const previous = await this.db.run.findUnique({where:{id}});
    if (!previous) throw new ConversationError(404, 'Run not found.');
    return this.accept(previous.threadId, requestKey, {kind:'retry',previousId:id,mode});
  }
  private async accept(threadId: string, requestKey: string, command: {kind:'send';text:string;mode:ModelMode} | {kind:'retry';previousId:string;mode:ModelMode}) {
    if (this.stopping) throw new ConversationError(503, 'The backend is stopping.');
    const hash = createHash('sha256').update(JSON.stringify({threadId,...command})).digest('hex');
    const existing = await this.db.run.findUnique({where:{requestKey}});
    if (existing) return runView(this.existing(existing, hash));
    let saved: Run | undefined;
    for (let attempt=0; attempt<5; attempt++) {
      try {
        saved = await this.db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId}::uuid FOR UPDATE`;
          const thread = await tx.thread.findUnique({where:{id:threadId}});
          if (!thread) throw new ConversationError(404, 'Thread not found.');
          const duplicate = await tx.run.findUnique({where:{requestKey}});
          if (duplicate) return this.existing(duplicate,hash);
          if (await tx.run.findFirst({where:{threadId,status:{in:['queued','running']}}})) throw new ConversationError(409, 'A response is already active in this thread.');
          const now = new Date();
          let inputId: string;
          let request: RequestPayload;
          if (command.kind === 'send') {
            inputId = randomUUID();
            await tx.artifact.create({data:{id:inputId,layer:'input',sourceId:null,threadId,runId:null,actor:'user',payload:InputPayload.parse({type:'text_input',text:command.text}),createdAt:now,updatedAt:now}});
            await tx.artifact.create({data:{id:randomUUID(),layer:'surface',sourceId:inputId,threadId,runId:null,actor:'user',payload:MessagePayload.parse({type:'message',initial_thread_id:threadId,speaker:'user',content:[{type:'text',text:command.text}]}),createdAt:now,updatedAt:now}});
            const instruction = await tx.instruction.findUniqueOrThrow({where:{key:'response'}});
            const artifacts = await tx.artifact.findMany({where:{threadId,layer:'surface'},orderBy:order});
            const runs = await tx.run.findMany({where:{threadId}});
            request = RequestPayload.parse({type:'model_request',...this.model.configuration(command.mode),...selectContext(artifacts,runs,instruction)});
          } else {
            const previous = await tx.run.findUniqueOrThrow({where:{id:command.previousId}});
            if (isActive(previous.status)) throw new ConversationError(409, 'Wait for the previous Run to stop before retrying.');
            inputId = previous.inputArtifactId;
            const priorRequest = await tx.artifact.findUniqueOrThrow({where:{id:RunState.parse(previous.state).request_artifact_id}});
            const prior = RequestPayload.parse(priorRequest.payload);
            request = RequestPayload.parse({...prior,...this.model.configuration(command.mode,prior)});
          }
          const runId = randomUUID(), requestId = randomUUID();
          const state = RunState.parse({request_artifact_id:requestId,response_artifact_id:null});
          const run = await tx.run.create({data:{id:runId,inputArtifactId:inputId,threadId,retryOfId:command.kind === 'retry' ? command.previousId : null,status:'queued',state,requestKey,requestHash:hash,createdAt:now}});
          await tx.artifact.create({data:{id:requestId,layer:'act',sourceId:inputId,threadId,runId,actor:'ash',payload:asJson(request),createdAt:now,updatedAt:now}});
          await tx.thread.update({where:{id:threadId},data:{updatedAt:now}});
          return run;
        }, {isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
        break;
      } catch (error) {
        if (error instanceof ModelFailure) throw new ConversationError(409,error.message);
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (['P2034','P2002'].includes(error.code) || (error.code === 'P2010' && ['40001','40P01'].includes(String(error.meta?.code))));
        if (!retryable) throw error;
        const duplicate = await this.db.run.findUnique({where:{requestKey}});
        if (duplicate) { saved = this.existing(duplicate,hash); break; }
        if (attempt === 4) throw new ConversationError(409, 'Another submission changed this thread. Try again.');
      }
    }
    if (!saved) throw new Error('Submission was not saved');
    if (this.autoDispatch && saved.status === 'queued') this.dispatch(saved.id);
    return runView(saved);
  }
  dispatch(id: string) {
    if (this.stopping || this.jobs.has(id)) return;
    const controller = new AbortController();
    const promise = this.execute(id,controller.signal).finally(() => this.jobs.delete(id));
    this.jobs.set(id,{controller,promise});
    // Operational persistence failures are logged without request/provider contents.
    void promise.catch(() => console.error(JSON.stringify({event:'run-worker-error',runId:id})));
  }
  private async execute(id: string, signal: AbortSignal) {
    const claim = await this.db.run.updateMany({where:{id,status:'queued'},data:{status:'running',startedAt:new Date()}});
    if (!claim.count) return;
    try {
      const run = await this.db.run.findUniqueOrThrow({where:{id}});
      const request = await this.db.artifact.findUniqueOrThrow({where:{id:RunState.parse(run.state).request_artifact_id}});
      for await (const event of this.model.stream(RequestPayload.parse(request.payload),signal)) {
        if (typeof event === 'string') { if (!await this.writeResponse(id,event,false)) return; }
        else if (!await this.writeMetadata(id,event)) return;
      }
      await this.writeResponse(id,'',true);
    } catch (error) {
      await this.db.run.updateMany({where:{id,status:'running'},data:{status:'failed',endedAt:new Date(),error:{code:error instanceof ModelFailure ? error.code : 'response_failed',message:error instanceof ModelFailure ? error.message : 'The response could not be completed.'}}});
    }
  }
  private async writeMetadata(id: string, metadata: ModelExecution) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM runs WHERE id = ${id}::uuid FOR UPDATE`;
      const run = await tx.run.findUniqueOrThrow({where:{id}});
      if (run.status !== 'running') return false;
      const state = RunState.parse(run.state);
      state.model = ModelExecution.parse({...state.model,...metadata});
      await tx.run.update({where:{id},data:{state}});
      return true;
    });
  }
  private async writeResponse(id: string, chunk: string, complete: boolean) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM runs WHERE id = ${id}::uuid FOR UPDATE`;
      const run = await tx.run.findUniqueOrThrow({where:{id}});
      if (run.status !== 'running') return false;
      const state = RunState.parse(run.state), now = new Date();
      if (state.response_artifact_id) {
        const artifact = await tx.artifact.findUniqueOrThrow({where:{id:state.response_artifact_id}});
        const payload = MessagePayload.parse(artifact.payload);
        if (chunk) {
          if (!payload.content.length) payload.content.push({type:'text',text:chunk}); else payload.content[0].text += chunk;
          await tx.artifact.update({where:{id:artifact.id},data:{payload,updatedAt:now}});
        }
      } else {
        const responseId = randomUUID();
        await tx.artifact.create({data:{id:responseId,layer:'surface',sourceId:state.request_artifact_id,threadId:run.threadId,runId:id,actor:'ash',payload:MessagePayload.parse({type:'message',initial_thread_id:run.threadId,speaker:'ash',content:chunk ? [{type:'text',text:chunk}] : []}),createdAt:now,updatedAt:now}});
        state.response_artifact_id = responseId;
      }
      await tx.run.update({where:{id},data:{state,...(complete ? {status:'completed',endedAt:now} : {})}});
      return true;
    });
  }
  async cancel(id: string) {
    const saved = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM runs WHERE id = ${id}::uuid FOR UPDATE`;
      const run = await tx.run.findUnique({where:{id}});
      if (!run) throw new ConversationError(404,'Run not found.');
      if (!isActive(run.status)) return run;
      return tx.run.update({where:{id},data:{status:'cancelled',endedAt:new Date()}});
    });
    this.jobs.get(id)?.controller.abort();
    return runView(saved);
  }
  async stop() {
    this.stopping = true;
    await this.recover();
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));
  }
}
