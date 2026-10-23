import type {Prisma} from '@prisma/client';
import type {RunState} from '@ash/shared';
import type { RequestPayload, ToolAction, ToolAuthorization, ToolAvailabilityIssue, ToolDefinition, ToolResource, ToolResult } from '@ash/shared';

export interface ToolContext {
  readonly runId: string;
  readonly threadId: string;
  readonly callId: string;
  readonly signal: AbortSignal;
  /** Trusted authorization boundary, also used for targets discovered by traversal. */
  readonly authorize: (action: ToolAction, options?:{optional?:boolean}) => Promise<ToolAuthorization>;
}

export interface PreparedToolAction {
  readonly action: ToolAction;
}

/** Database-only effects commit atomically with the saved tool result. No external effects. */
export type ToolCommit=(tx:Prisma.TransactionClient,state:ReturnType<typeof RunState.parse>)=>Promise<void>;

export interface ToolHandler<Args, Prepared extends PreparedToolAction> {
  readonly definition: ToolDefinition;
  /** Runtime argument validation; no IO or effects. */
  parse(input: unknown): Args;
  /** Constrained resolution only; must not perform the requested action. */
  prepare(args: Args, context: ToolContext): Promise<Prepared>;
  execute(action: Prepared, context: ToolContext): Promise<ToolResult>;
  commit?(action:Prepared,context:ToolContext,tx:Prisma.TransactionClient,state:ReturnType<typeof RunState.parse>):Promise<void>;
}

/** A prepared closure retains typed arguments without exposing them to another handler. */
export interface ToolRegistration {
  readonly definition: ToolDefinition;
  prepare(input: unknown, context: ToolContext): Promise<{
    action: ToolAction;
    execute(context: ToolContext): Promise<ToolResult>;
    commit?:ToolCommit;
  }>;
}

/** Dispatcher-owned citation identity; index is the reference's zero-based result position. */
export function toolCitationId(callId: string, index: number): string {
  return `cite:${callId}:${index + 1}`;
}

export function registerTool<Args, Prepared extends PreparedToolAction>(handler: ToolHandler<Args, Prepared>): ToolRegistration {
  return {
    definition: handler.definition,
    async prepare(input, context) {
      context.signal.throwIfAborted();
      const prepared = await handler.prepare(handler.parse(input), context);
      return { action: prepared.action, execute: current => handler.execute(prepared, current),...(handler.commit?{commit:(tx,state)=>handler.commit!(prepared,context,tx,state)}:{}) };
    },
  };
}

/** Captured availability describes resources; it is never a grant of access. */
export interface ToolAvailability {
  definitions: readonly ToolDefinition[];
  resources: ToolResource[];
  issues: ToolAvailabilityIssue[];
}
export interface ToolRuntime {
  readonly tools: readonly ToolRegistration[];
  resources(runId: string, threadId: string, capturedRequest?: RequestPayload): Promise<ToolResource[]>;
  /** Optional availability snapshot; legacy runtimes keep using resources. */
  availability?(runId: string, threadId: string, capturedRequest?: RequestPayload): Promise<ToolAvailability>;
  authorize(action: ToolAction, context: Omit<ToolContext, 'authorize'>): Promise<ToolAuthorization>;
}

export async function toolAvailability(runtime: ToolRuntime, runId: string, threadId: string, request?: RequestPayload): Promise<ToolAvailability> {
  if (runtime.availability) return runtime.availability(runId, threadId, request);
  const resources = await runtime.resources(runId, threadId, request);
  return { definitions: resources.length ? runtime.tools.map(tool => tool.definition) : [], resources, issues: [] };
}

/** Each runtime owns its registered operation names, including discovered-resource checks. */
export function composeToolRuntimes(...runtimes: ToolRuntime[]): ToolRuntime {
  const owners = new Map<string, ToolRuntime>();
  for (const runtime of runtimes) for (const tool of runtime.tools) {
    if (owners.has(tool.definition.name)) throw new Error('Duplicate tool registration');
    owners.set(tool.definition.name, runtime);
  }
  const availability: NonNullable<ToolRuntime['availability']> = async (runId, threadId, request) => {
    const snapshots = await Promise.all(runtimes.map(runtime => toolAvailability(runtime, runId, threadId, request)));
    return { definitions: snapshots.flatMap(snapshot => [...snapshot.definitions]), resources: snapshots.flatMap(snapshot => snapshot.resources), issues: snapshots.flatMap(snapshot => snapshot.issues) };
  };
  return {
    tools: runtimes.flatMap(runtime => [...runtime.tools]),
    availability,
    async resources(runId, threadId, request) { return (await availability(runId, threadId, request)).resources; },
    async authorize(action, context) {
      const owner = owners.get(action.operation);
      if (!owner) return { outcome: 'denied', code: 'unknown_operation', message: 'No runtime authorizes this operation.', configurationRevision: 'none', evaluator: 'not-performed' };
      return owner.authorize(action, context);
    },
  };
}

/** A trusted handler failure whose message is safe for model and public inspection. */
export class ToolActionFailure extends Error {
  constructor(readonly code: string, message: string, readonly denied = false) { super(message); }
}

/** Authorization suspended the call. Adapters must propagate this through traversal catches. */
export class ToolSuspension extends Error {}
