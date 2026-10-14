# Tool execution implementation

Implemented · [Verification](#verification)

[Accepted behavior](../../specs/features/tools.md) · [Approved delivery/test plan](../plans/inspectable-tools-tests.md)

## Handler registration

Use `registerTool(handler)` from `packages/server/src/modules/tools/contract.ts`. A handler provides a captured definition, runtime argument parser, constrained preparation and execution. The dispatcher calls preparation only after a complete model response, authorizes its normalized action, then executes with trusted Run/thread/call IDs and cancellation. Traversal calls `context.authorize` for each additional target. A handler's definition or result never grants access. A trusted `ToolActionFailure` can expose a safe error or denial; unexpected exceptions receive the generic sanitized error.

`ToolRuntime` supplies registrations, descriptive resources for each Run and a trusted authorization function. Its optional `availability` hook returns available registered definitions, resources and safe public issues; legacy runtimes continue using `resources`. These hooks receive the captured request during submission, before the new Run is committed. An unavailable runtime returns no definitions/resources and an issue rather than failing submission. `composeToolRuntimes` combines those snapshots without suppressing healthy runtimes and routes each action to the owner of its registered operation name; duplicate names fail. Retrieval handlers resolve membership and source scope in their owning service through the same authorization boundary. [Typed retrieval example](../../tests/support/retrieval-tool.ts).

Cross-process definitions, actions, results and references live in `packages/shared/src/contracts/tools.ts`. Current results support text, structured JSON and captured source references. Each reference has a kind, identity, label, observation time and resource-specific location. Filesystem handlers use paths/lines; retrieval handlers can use Artifact IDs/offsets. Provider types and private continuation remain server-only.

The dispatcher adds `citationId` to each returned source excerpt, preserving its original `id` and location. Handlers that truncate results can use `toolCitationId(context.callId, index)` to include this metadata in their byte accounting; `index` is the zero-based position in the returned reference array. Handler-supplied citation IDs are replaced by the dispatcher.

Shared exports are additive; requests without tools and legacy checkpoints retain their readers.

Filesystem setup and handler behavior: [read-only filesystem tools](filesystem.md).

## Execution and inspection

`modules/tools/executor.ts` owns model rounds, scheduling and transactional checkpoints. Independent calls may overlap; exclusive handlers wait for the batch to drain. Dependencies enter later rounds. Proposal order and call identity determine continuation ordering; timestamps show overlap. Duplicate Run claims cannot dispatch twice. The [data model](../data-model.md#run-state-and-errors) owns stored payload and checkpoint shapes.

The [execution limits](../plans/inspectable-tools-tests.md#execution-limits) bound each Run and call. Scheduling waits for each transactional result reservation to commit before admitting another call. Calls wait while active reservations consume capacity; completed results release unused reservations. Exhausted capacity stops further admission explicitly. Cancellation and deadlines prevent late output from changing terminal records.

Arguments are parsed with an iterative nesting check before repetition hashing and handler preparation. Excessive nesting becomes a recoverable `invalid_call`; the complete proposed argument string remains captured. New requests record `limits.argumentDepth`; historical requests without it use the default in the execution-limits table.

Resource descriptions in the model prompt have a 12,000-character budget; availability issues have a separate 2,000-character budget, both with explicit omitted counts. The captured request retains the complete bounded lists and exact supplied instructions. Optional `availabilityIssues` in the request and workflow preserve historical readers and show limitations even when progress is collapsed.

Stop/restart retains completed results and distinguishes queued/preparing/dispatched work. A dispatched call without a committed result is unknown; restart does not resume it. Explicit Retry uses the initial captured request with fresh scope checks and reads. Tools declaring that repetition requires reconciliation cannot execute on Retry.

OpenAI replay uses private output items plus matching results under `store:false`, with SDK retries disabled. Only public commentary, tool arguments/results and allowlisted metadata reach inspection. Neither encrypted reasoning nor reasoning summaries enter renderer/API records.

`ToolTrace.svelte` presents compact progress; `ToolInspection.svelte` exposes each round, its calls and access checks. Source citations use `ash-source:CITATION_ID` and open saved results without rereading source. The dispatcher assigns `cite:CALL_UUID:POSITION`, with one-based positions, so repeated source IDs remain distinct across calls and excerpts. Call checkpoints index these IDs for lookup. Historical source-ID links still resolve when exactly one saved result matches; ambiguous IDs show an unavailable-citation message. Opaque historical IDs support URI encoding and the full reference-ID length bound. These citations do not implement the deferred cross-thread Reference Artifact feature.

The contract reserves attachment result shapes, but current dispatch rejects them with `unsupported_attachment` until a runtime can authorize asset access.

## Verification

`tests/integration/tools.test.ts` covers TOOL-02, 06–14, 17–18, 22–23 against real PostgreSQL and synthetic retrieval handlers: validation, argument nesting, deadlines, scheduling, result reservation backpressure, cancellation, limits, duplicate delivery, interruption, immutable storage, partial capability availability and mocked stateless provider continuation. Citation rendering/lookup invariants are in `tests/boundary/markdown.test.ts`; feature suites cover their own handlers and desktop journeys. Full `pnpm verify` is the delivery gate.

Verified 2026-10-13 at code revision `d0af409`: full `pnpm verify` passed 64/64 scenarios, including [filesystem and hidden Electron checks](filesystem.md#verification). The separate review and restored-preview inspection passed; saved Artifact and Run hashes matched across restart. The user confirmed tools work. Evidence: `~/.ash-dev/evidence/b451b0afdad661b02b572e0d/`. Integration into `master` remains pending an explicit request.
