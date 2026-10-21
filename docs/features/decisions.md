# Decisions design

Implemented for current tool workflows, 2026-10-14 · [Delivery and verification](../plans/permissions-decisions-tests.md)

[Behavior and acceptance](../../specs/features/decisions.md) · [Permissions implementation](permissions.md#current-implementation) · [Current execution contract](../data-model.md#execution-and-transactions)

## Service boundary

Use a separate Decisions feature for request creation, querying, snoozing and responses. It depends on neither a particular tool nor an instruction/code-edit workflow. Permissions supplies permission-specific request details; other features supply choices or questions. Callers consume responses through a stable request/dependency identity, not a live client callback.

Implementation is `packages/server/src/modules/decisions/`, with full-page desktop presentation under `packages/client/src/renderer/features/decisions/`. Shared contains only cross-process request/view/response contracts. The execution system coordinates the caller, Decisions and Permissions; the Decision service does not dispatch tools or resolve policy.

## Storage

Use one `decisions` table for an immutable reviewed request and its single resolution. Work dependencies stay in existing Run state. Answers follow [DEC-R12](../../specs/features/decisions.md#rules); no answer versions, amendment history or withdrawal records are needed. The [data model](../data-model.md#permissions-and-decisions-extension) includes the separate `permissions` table.

### decisions

| Fields | Purpose |
| --- | --- |
| `id` | Stable identity allocated before creation and reused on delivery retries. No separate request key or stored request hash. |
| `request` JSONB | Immutable typed question, context and response definition. Choices have stable option IDs. Permission requests include the reviewed action/evaluation; arbitrary options cannot dispatch code. Feature-specific details belong in this payload when needed. |
| `thread_id?`, `source_artifact_id?` | Optional primary conversation and originating evidence, with foreign keys. Placement and provenance are distinct; neither is required for a standalone Decision. |
| `status`, `snoozed_until?`, `due_at?` | Request lifecycle, attention deferral and optional substantive deadline. |
| `resolution` JSONB, optional | Single immutable terminal result: an answer or cancellation. Defined payload shapes hold the answer/comment or reason, source information and resolution time. Null while pending or snoozed. |
| `created_at`, `updated_at` | Creation and current-state timestamps. |

Use typed resolution shapes: an answer carries `kind: answer`, `submissionId`, `value`, optional `comment`, `source` (Decision controls or chat), `sourceArtifactId` for chat answers and `resolvedAt`; cancellation carries `kind: cancellation`, `reason` and `resolvedAt`. The server establishes source and time. Validate source Artifact references in application code. An answer can also carry a reason when the response requires explanation. Work outcomes live on the consumer, never as later edits to this resolution.

On creation retry, compare immutable creation fields, not the current lifecycle; return the existing Decision on a match and reject conflicting reuse of its ID. Resolve under a row lock: only pending or snoozed requests can acquire an answer. An identical response retry returns the saved resolution; reject reuse of its submission ID with different content and any conflicting second answer. Terminal states never reopen. Snoozing changes attention only. Index status/time and linked-Thread lookup.

The response UI reuses a submission ID only while the chosen answer and comment are unchanged. After a failed request, a different choice, edited text/comment or Skip sends that current response with a new ID; the immutable saved answer remains authoritative if the earlier request actually succeeded.

Changed requests follow [DEC-R09](../../specs/features/decisions.md#rules) through ordinary cancellation and creation. The consumer checkpoints the cancelled dependency and any newly required Decision ID; Decisions have no replacement links. Save lifecycle and dependency changes consistently so recovery cannot consume the obsolete request or lose a still-required question.

Route ordinary chat answers under [DEC-R11](../../specs/features/decisions.md#rules) through the same response transaction, binding the Decision ID and source Input. Recheck lifecycle after interpreting the message so a stale interpretation cannot resolve a cancelled request. A concurrent answer or cancellation keeps its saved result while the accepted chat Run proceeds. Unexpected interpretation errors still dispatch the already-committed Run and propagate to the caller; delivery retries return that Run. The backend must reject permission approval submitted through this chat path.

Keep the reviewed request and response after resolution. Ordinary UI creation/resolution does not require a new Artifact merely to record an application edit under ART-R06. An Ash-generated request or a chat answer can link to its existing Artifact. Foreign-key deletion must preserve retained evidence; erasure and retention remain G06/G09. Start with one optional primary Thread link; extra Thread appearances can link to the same Decision without changing its ownership.

### Run state dependencies

| Fields | Purpose |
| --- | --- |
| `decisionId`, `stepKey` | The immutable Decision needed by a particular step in `runs.state`. Its ID identifies both the reviewed request and its single answer. |
| `status`, `consumedAt?` | Waiting, consumed or cancelled dependency. Consumed means work has started using the answer, not that a side effect succeeded. |
| `resultArtifactId?` | Optional outcome/evidence reference; existing tool-call state still records dispatch and result. |

Use a bounded dependency list in Run state. One Run can need several Decisions; a standalone Decision needs no Run. Reusing an ordinary answer does not broaden a permission approval's action scope. Permission approval must match the reviewed caller/step/action binding. A validated retry can reuse it under [PERM-R25](../../specs/features/permissions.md#permission-behavior); another Run cannot claim it merely by adding the Decision ID or a retry link to its state.

Claim each dependent step once and persist consumption with its next checkpoint before any model call or action uses the answer. Validate Decision references and reject duplicate step/dependency entries. These JSON references have application validation rather than foreign-key enforcement, consistent with existing checkpoint references; retained checkpoints must keep their referenced Decisions available. Immutable answers remove the need to coordinate answer edits with first consumption.

Discover waiting consumers through Run status and checkpoint data when an answer arrives and during recovery. Add a JSON index if query volume warrants it. A separate relationship table would provide direct SQL joins, foreign keys and cross-Run dependency management, but none is required for current Run-owned continuation.

On work cancellation, mark its outstanding dependencies cancelled and apply [DEC-R13](../../specs/features/decisions.md#rules) to unanswered Decisions. Check remaining active dependencies and any independent purpose before cancelling the request. Coordinate with response saving and continuation through the same locking discipline; an already-saved answer remains recorded, but cannot restart the cancelled consumer.

The Decision owns [permission-specific approval data](permissions.md#approval-data-on-decisions); the Run owns whether and how the answer was consumed. Do not copy the approval into a second authority record. Current Permissions evaluation still determines whether the proposed action can proceed.

### Existing Run changes

The nonterminal `waiting` status keeps `ended_at` null; checkpoint/tool-call shapes identify held steps and dependencies. The migration, shared contracts, recovery and cancellation include this status. Under [DEC-R05](../../specs/features/decisions.md#rules), a fully waiting Run must not reserve the Thread's active execution slot. Resumption keeps the original Run and queues eligible steps after any active Run in that Thread. The existing partial unique index still applies only to queued/running Runs. One answered dependency can resume its step while siblings remain held.

## Execution integration

- `ToolExecutor.execute` restores the last completed model round, retains its output/continuation and dispatches only queued or held calls. It reconstructs preparation closures; completed calls keep their original results.
- `ToolExecutor.call` saves the Decision/dependency before leaving active execution. Preparation/authorization has a separate allowance for evaluation; execution uses the registered tool deadline. Human waiting retains no open tool call. Repeated guard checks reuse evaluation only while the action, rule snapshots and answer remain unchanged, with current capability checks still running.
- `Threads.resumeWaiting` locks the Thread and Run before claiming continuation. It runs after responses, after active work settles and periodically, so a lost notification does not lose an answer. Snooze affects attention, not eligibility after an answer.
- `Threads.recover` resumes known checkpoints of Decision-dependent work and leaves unresolved waits intact. Active model calls remain interrupted; dispatched calls without known outcomes remain unknown and cannot replay automatically.

Handoff:

1. Save the Decision and its work dependency/checkpoint consistently before leaving active execution. Repeating this transition returns the same outstanding request.
2. Save a response through a transaction that checks the immutable request and current lifecycle. The saved record remains discoverable if the process stops before notifying its consumer.
3. A consumer automatically claims eligible continuation durably under [DEC-R10](../../specs/features/decisions.md#rules). Recheck cancellation and whether the request still addresses the work. Permission consumers pass the response back to Permissions with the current action and policy.
4. Dispatch only after current checks pass and the work remains eligible to run. Coordinate cancellation through the execution owner under DEC-R13. Persist known progress and outcomes; recover completed consumption without replay. Side-effect guarantees come from the execution adapter's idempotency or outcome reconciliation, not from the existence of an approved Decision.

Resource guards can discover another input requirement during traversal. Adapters propagate authorization suspension through traversal catches. Current filesystem operations are safe reads; held preparation is reconstructed while completed sibling calls remain recorded. Future effect adapters must define their suspension and outcome-reconciliation boundaries before enabling execution. Keep independent work separate from work that requires the answer. Do not hold a transaction, provider stream or open tool call for the duration of user waiting. The scheduler retains wakeups arriving during an active scan and scans again before becoming idle; an answer cannot be lost between saved waiting state and dispatch.

Continuation uses the same Run; explicit retries use the existing linked-Run contract. Approval reuse for retries follows [PERM-R25](../../specs/features/permissions.md#permission-behavior); current Run consumption follows the approval contract above. General background jobs and new external-effect adapters remain future scope.

## Verification

Map implementation checks to the [acceptance examples](../../specs/features/decisions.md#acceptance-examples). Use boundary integration for duplicate/conflicting responses, immutable saved answers, stale responses to cancelled requests, changed requests and restart at request/response/consumption boundaries. Use a deterministic permission evaluator and a controlled action consumer to prove the shared contract without adding a new production capability.

Exercise the actual app for standalone questions, linked permission requests, snooze, full-page/Thread views, preserved navigation drafts and scroll and visible outcomes. Preserve existing configured-access tests and historical readers. Evaluator quality remains covered by the separate permission experiments; Decision tests must not mistake a mocked allow result for enforcement verification.
