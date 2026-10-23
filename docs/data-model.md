# Data model

Initial six-table design accepted, 2026-10-09 · Image extension accepted, 2026-10-12 · PITR operation pending

[DBML](../specs/data/model.dbml) · [Artifact rules](../specs/features/artifacts.md) · [Instruction rules](../specs/features/instructions.md) · [Open decisions](../specs/open-questions.md)

## Storage

One private Ash instance uses one database and initially one backend. Current rows are authoritative; recovery follows [ART-R08](../specs/features/artifacts.md#rules). The backend assigns timestamps and record IDs; uploads accept a client-generated UUID as their idempotent identity. `updated_at` starts at `created_at` and normally changes with editable fields; Thread metadata edits preserve activity ordering as described under [visibility](#thread-visibility). Naming follows the [engineering agreement](../specs/product.md#confirmed-engineering-agreement).

### First-phase coverage

The initial [thread journey](../specs/features/threads.md) uses six tables; [image input](../specs/features/images.md) adds two attachment tables and permits threadless description Runs. [Topics and instruction editing](features/topics-context.md) add a membership version to Threads. Tool execution adds [private provider continuations](#run-state-and-errors), and incoming processing adds [intake checkpoints](#incoming-item-checkpoints-and-presentation).

| Capability | Stored data |
| --- | --- |
| Create/rename Topics and Threads; change membership | `topics.name`, `threads.title`, `thread_topics`; Topic soft deletion uses `deleted_at`. |
| Archive/pin Threads | `threads.is_archived`, `threads.is_pinned`. |
| Edit independently owned instructions | `instructions.key/name/text`; global slots use keys, Topic/Thread editors use owner FKs. |
| Save and order messages | Surface `payload.speaker/content`, `thread_id`, `created_at` and `id`. |
| Submit without duplicates | `runs.input_artifact_id`, `request_key`, `request_hash`; unique constraints. |
| Stream, reconnect, cancel and retry | Saved Surface content; Run `state`, `status`, `error`, timestamps and `retry_of_id`. |
| Inspect context and select retry results | Request payloads retain messages, instruction identities, limits, omissions, provider/model/options; Run input links and status select the answer under CONV-R15. |
| Persist images and descriptions | `attachments`, `artifact_attachments`, immutable instance files and description Runs. |
| Restore after data loss | All product tables, physical backups/archived WAL and matching attachment files. |

Typed drafts and selection state belong to the desktop client. Provider credentials and model configuration belong to the backend configuration.

## Permissions and Decisions extension

Tables, immutable answers and single-rule Permissions with reviewed overrides implemented, 2026-10-14 · [Delivery plan](plans/permissions-decisions-tests.md).

| Addition | Canonical design |
| --- | --- |
| `decisions` | [Reviewed requests, immutable resolutions and scoped approval](features/decisions.md#storage). |
| `permissions` | [Editable standing policy](features/permissions.md#persistence). |
| Run dependency/checkpoint data, waiting status and constraints | [Run state dependencies](features/decisions.md#run-state-dependencies) and [existing Run changes](features/decisions.md#existing-run-changes). |
| Permission-evaluation Act payload | [Captured evaluation evidence](features/permissions.md#evaluation-artifacts). |

Keep feature ownership separate. Use foreign keys for relational references and validate JSON references in resolution/checkpoint data and Permission override links. The new Permission policy uses existing columns; its [contract and migration](features/permissions.md#persistence) replace resource/activity and mixed matchers without adding entity, relationship or version tables. Waiting tool steps resume within their original Run under the [execution contract](features/decisions.md#execution-integration). Retention/erasure policy belongs to the separate security/privacy design. Schema changes follow the [synchronization workflow](architecture.md#schema-workflow).

## Adapt extension

`threads.interaction_mode`, `adapt_workspaces` and `adapt_executions` persist coding routing, source identity and operational reconciliation. Immutable `coding_request` and `coding_evidence` Acts retain context and cumulative source checkpoints. `adapt_preparation`, `adapt_candidate` and `adapt_application` Acts retain verification requests, frozen local builds and Decision-linked application outcomes. The private Workspace controller references those records; protected filesystem journals own version switching. [Persistence and ownership](features/adapt.md#persistence) · [Local application](features/adapt.md#local-application).

## Run boundary

A Run tracks an Act workflow and its outputs, including Surface Artifacts. Routine Listen/Input/Filter/Route processing and intake action/presentation assessment do not create Run rows. Those stages may use workers or model calls; using a worker does not itself create a product Run.

A workflow may contain several model calls using different providers or models. Each call has its own Artifact payload. Find produced Artifacts through `artifacts.run_id`; the checkpoint references those currently needed by the workflow.

Thread Runs produce one answer through one or more model/tool calls. User Input and its directly mirrored Surface precede that Run and have no producing `run_id`. Image-description Runs consume an upload Input, have null `thread_id`, and produce an internal result Act without a Surface. [Tool execution](features/tools.md#execution-and-inspection) defines multi-call checkpoints; Decision waits resume from saved tool progress; other threadless workflows still need contracts.

## Artifacts and placement

`artifacts.source_id` points to an existing Artifact and cannot change. Insert parents before children and reject cycles.

For Surface Artifacts, `thread_id` is the current owner; speaker and message content live in the payload. Other layers' optional `thread_id` retains its original meaning. Surface payloads retain `initial_thread_id`; recorded routing decisions and `runs.thread_id` preserve processing provenance independently of moves. JSON references are validated on write, not enforced by SQL foreign keys.

Query a thread's Surface rows with `ORDER BY created_at ASC, id ASC`, backed by the `(thread_id, created_at, id)` index. This implements [ART-R03](../specs/features/artifacts.md#rules) without a separate position column.

A move updates `thread_id` and `updated_at` in one transaction; grouped moves are atomic. Lock affected threads in stable ID order. Moves during active work remain a product question.

For the first text path, an Input creates a user Surface and a `model_request` Act. The response Surface sources that Act. Streaming grows its payload content under [ART-R09](../specs/features/artifacts.md#rules), without an Artifact per chunk.

### Example rows

Illustrative IDs; all four records are associated with thread T. R is the response Run.

| Record | Layer | source_id | run_id | payload.speaker |
| --- | --- | --- | --- | --- |
| I: incoming message | input | null | null | absent |
| U: visible user message | surface | I | null | user |
| C: captured model request | act | I | R | absent |
| A: reply being generated | surface | C | R | ash |

R consumes I; it does not produce I or U. Its checkpoint identifies A as the current response, whose generation indicator derives from R's status. U is saved user content and has no generation indicator. Do not infer the lifecycle of every Artifact from `run_id`: a running Run already has a finished, immutable request C.

### Artifact payloads

Every payload has a required string `type` validated against its layer. The application validates each shape on write.

| Layer / type | Payload content |
| --- | --- |
| Input / `text_input` | Original text-only input and any source metadata. |
| Input / `message_input` | Original text (possibly empty) and ordered `attachmentIds`. |
| Input / `image_upload` | Uploaded `attachmentId` and filename. |
| Act / `image_description` | `attachmentId` and the completed generated description text. |
| Act / `model_request` | Exact model-visible messages, instruction/context selection, and this call's `provider`, `model` and `options`. See [captured requests](#instructions-and-captured-requests). |
| Surface / `message` | `initial_thread_id`, `speaker`, ordered `content` blocks and any presentation metadata. |

`payload.speaker` is required for Surface messages: `user` for the mirrored user message, `ash` for the reply. Omit it from other payloads; internal model roles belong in `messages`. Surface messages support text blocks and `{type: "image" | "video", attachmentId}` blocks. For example:

```json
{
  "type": "message",
  "initial_thread_id": "00000000-0000-0000-0000-000000000001",
  "speaker": "ash",
  "content": [{ "type": "text", "text": "Here is the repair checklist." }]
}
```

An empty response starts with an empty `content` array. Streaming may append blocks or grow the active text block while its Run is running. Only that response's content is mutable; speaker, captured requests, source links and original provenance are not.

`payload.occurred_at` is optional source metadata. Use it when an external event happened at a meaningful known time, such as an email sent at 09:00 but ingested at 09:10. Omit it when unknown or when it would merely repeat `created_at`. Store timestamps with an explicit time zone. For example, a future email Input might contain:

```json
{
  "type": "email_input",
  "occurred_at": "2026-10-09T09:00:00-07:00",
  "subject": "Repair appointment",
  "body": "The technician arrives tomorrow."
}
```

Its `created_at` would be 09:10. The two times answer when the source event happened and when Ash saved it.

## Incoming-item checkpoints and presentation

[Behavior](../specs/features/artifacts.md#incoming-item-slice) · [Implementation](features/artifacts.md)

`incoming_items.id` is a restrictive FK to its immutable `incoming_input` root. `source_key` hashes the source namespace/event identity; `request_hash` binds the original source metadata, content and trusted explicit target. Matching deliveries return the original receipt, even if their transport IDs differ. Neither identity field is mutable.

`state` holds the current stage (`filter`, `route`, `assess`, `dispatch`, `done`), `parentId`, nullable `currentRequestId`, destination `threadId`, `planId`, `sourceSurfaceId` and eventual `runId`. `status` distinguishes queued/processing, waiting for Thread capacity, completed, dropped, failed and interrupted. Stage evidence and its checkpoint commit together. Receipt status `completed` means intake finished; linked Run status independently describes action progress.

| Payload | Content |
| --- | --- |
| Input / `incoming_input` | Original text, source namespace/event identity/label/optional HTTP(S) URL, optional occurredAt and explicit target. |
| Filter/Route/Act / `engine_request` | Stage, exact validated `model_request`, instruction identities/order and bounded selection scope. No producing Run. |
| Filter/Route/Act / `engine_response` | Public output text and allowlisted provider execution metadata. |
| Filter / `filter_result` | Pass/drop and concise reason. |
| Route / `route_result` | Existing/new choice, saved destination, explicit-target flag, rationale and ambiguity/assumption. |
| Act / `act_plan` | Independent action, showSource and showResponse choices plus reason. This intake assessment does not itself start an action workflow. |
| Filter/Route/Act / `engine_error` | Stage, safe code/message and bounded public invalid output when present. |
| Surface / `message` with `speaker: source` | Source label/identity, original text and `inputArtifactId`; sourced from the presentation plan. |

Database triggers freeze incoming roots and engine evidence. On explicit intake Retry, an unfinished stage copies its captured request into a new immutable attempt; completed stage/placement records remain unchanged. Startup interrupts unfinished intake without provider dispatch. A waiting-capacity checkpoint is not a Decision or a product Run.

For warranted work, `Threads.acceptIncoming` saves the existing Run/checkpoint and captured request in the intake transaction. `request.incoming` identifies the Input and response visibility. If a source entry is hidden, that Input still enters this Run once as labeled external evidence. Response context is captured at Run acceptance, including after a busy Thread becomes available. Normal response Topic retrieval remains scoped to the destination's memberships.

The shared executor retains its final `model_output` as `response_artifact_id` when response visibility is false; no Surface is created. Visible replies retain their usual Surface checkpoint. Later history selects visible source entries and latest completed replies by root Input identity; response-only entries do not require a mirrored user message. Hidden internal results stay out of Thread history and Topic retrieval.

## Image storage and description Runs

`attachments` owns one upload Input, immutable filename/source metadata, the latest description Run/result text, creation time and optional expiry. Metadata contains original/model/thumbnail descriptors (SHA-256, MIME type, bytes and displayed dimensions), plus the transform version. Storage paths derive from the instance root, attachment UUID and descriptor hash; payloads never accept arbitrary filesystem paths.

`artifact_attachments` gives every Input, Surface, description record and captured request a restrictive FK reference to its image. Requests retain references even when they use only a description. Submission locks attachments, verifies availability/budgets, clears expiry and inserts references in the same transaction as acceptance. Original bytes and descriptors never change. [IMG-R09](../specs/features/images.md#rules) owns lifetime; [implementation](features/images.md#storage-and-execution) owns publication and cleanup.

Upload acceptance creates `image_upload` → `model_request` in a transaction, with a queued threadless Run and complete checkpoint. The request's `purpose: image_summary` distinguishes its adapter configuration. Completion atomically creates `image_description`, updates the Run checkpoint/status and caches text on the attachment. Error/interruption leaves the image usable. Retry creates another Run/request with frozen content and updates the attachment's current Run pointer. Null thread IDs do not occupy the per-thread active-Run slot.

Structured request messages embed immutable image descriptors, detail settings and then-current description text. `selection.images` records the representation, reason, source Artifact and description Run identity. See [IMG-R03–06](../specs/features/images.md#rules) for retry/context rules; existing string-content text requests remain valid.

## Video attachments

[Video attachments and recording](features/recording-feedback.md) reuse `attachments` and `artifact_attachments`; image metadata remains backward-readable. Video metadata adds original/playback/thumbnail descriptors, duration and audio availability. Optional frame descriptors, measured times and known capture origin reuse that metadata. Only `frames`/`frameError` are mutable for preparation retries; `attachment_source_immutable` protects the remaining fields. Captured requests retain their original descriptors when this cache changes. A `video_upload` Input owns the asset and a threadless caption/transcript Summary Run. Surface messages use `{type: "video", attachmentId}` blocks. Captured chat requests retain `selection.videos` source descriptors, then-current analysis identity and restrictive asset references; model-visible text contains bounded caption/transcript or a pending/unavailable marker.

A video-only submission has an Input and mirrored Surface without a response Run. Its submission UUID is the Input ID; `message_input.submissionHash` preserves the submitted-content identity. A submission-key advisory lock serializes these receipts with normal response submissions, so duplicate delivery reuses the recorded input and changed content is rejected. No application audit log or additional table is introduced.

Video analysis records `video_analysis` plans with frozen source descriptors, instruction text and processing bounds; `video_model_request` captures each supplied media hash/offset, prompt, response schema and sampling settings. `video_model_response` retains visible structured output and allowlisted execution metadata. `video_understanding` collects source-relative transcript/observations and explicit coverage/limitations. Original media and supplied derivatives remain immutable. The attachment caches caption text; its Summary Run points to the canonical result Artifact, from which views load narration.

Explicit tools place these records beneath the current `tool_call` within its chat Run, preserving the one-initial-Run-per-Input constraint. Completed equivalent analysis can be reused after current/captured scope checks. Background caption failures preserve completed partial evidence and allow an explicit new retry Run. No new table or migration is needed. [Processing and inspection](features/recording-feedback.md#video-understanding).

## Instructions and captured requests

`instructions` stores current name/text for a common editor. `topics.instruction_id` and `threads.instruction_id` are nullable, unique FKs implementing [INST-R02](../specs/features/instructions.md#rules). Null means no custom document. Global documents instead have a unique stable `key`, currently `response`, `image-description`, `video-caption`, `video-understanding`, `engine-filter`, `engine-route`, `engine-assess`, `thread-visibility` and `thread-naming`; Topic/Thread documents have a null key.

The unique constraints prevent sharing within each owner type, but not across Topics and Threads. For ownership changes, use a `READ COMMITTED` transaction: lock the Instruction row, then check both owner tables in a separate query so the check sees changes committed while waiting for the lock. Reject a different owner or a global key. All attachment/key changes must follow this lock protocol; an owned document cannot become a global prompt. Create/copy and attach a document atomically. Soft-deleting a Topic retains its document; erasure remains G06. See [PostgreSQL snapshot behavior](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

A `model_request` Act stores the exact ordered model-visible messages, instruction IDs/owner identities, message-array indexes, Topic scope and factual omissions/limits. Selected instruction text is already in the messages; do not resolve current Instructions to inspect an old execution. Capture provider-adapter additions too; credentials and private model reasoning are excluded. [Scoped selection and retrieval](features/topics-context.md#capture-and-retrieval) define the additive metadata and compatibility rules.

Build thread context from Surface messages under [CONV-R05 and CONV-R15](../specs/features/threads.md#requirements). Do not include their Input or Act copies as additional messages. For each Input, choose its completed Run with the greatest `(ended_at, id)` and include that Run's response if it is in the current Thread. Apply context limits after selection and record compact omission counts in the request. An Input without a completed response contributes its user message only.

Conversation model routing adds an immutable preparation Act and atomic selection checkpoint before inference; [routing persistence](features/model-routing.md#code-and-persistence) owns its payload/state contract.

Select and record the call's provider, exact model identifier and generation options before committing that request. Dispatch must use those recorded values; choosing a different request requires another Artifact, not mutation of a frozen one. A saved request records prepared work, not proof that the provider accepted or completed it.

Each call gets its own request Artifact, including explicit retries. A retry copies the previous frozen model-visible content instead of reading current instructions or thread; its call record retains that retry's selected provider/model/options. The original input and `retry_of_id` retain the relationship to the earlier execution. The initial live retry policy follows [CONV-R16](../specs/features/threads.md#requirements).

## Run state and errors

`runs.state` holds the latest persisted workflow checkpoint. Store execution progress and Artifact references; keep transcripts and tool results in Artifacts. Future wait/resume behavior will define its own checkpoint shape.

The first response workflow uses this minimal shape at acceptance:

```json
{
  "request_artifact_id": "00000000-0000-0000-0000-000000000002",
  "response_artifact_id": null
}
```

`request_artifact_id` is required and immutable for this workflow; it references this Run's frozen `model_request` Act. `response_artifact_id` stays null until a response is saved, then references this Run's Surface (or its result Act for a description). Create the result and set the reference atomically. A completed empty chat reply still has a Surface; incoming internal work instead references its final model output under the incoming-item contract above. Failure/cancellation before output may have none. In that case, display the Run's outcome beside its originating user message.

An automatic Adapt handoff retains this original request and Run. `state.adapt.requestArtifactId` references its additional frozen `coding_request`, sourced from the initiating tool call. The mode, execution binding and completed tool result commit together. Workspace refresh saves a new immutable `coding_evidence` checkpoint sourced from its predecessor; private integration state retains the installed baseline and conflict paths. [Adapt workflow](features/adapt.md#automatic-entry-and-parallel-changes).

Validate each reference's existence, layer, type and producing Run on write; JSON references have no SQL FKs. Commit checkpoint changes with their related Artifacts/outcome. Terminal Runs freeze the checkpoint; status and error remain separate columns.

`runs.error` is null when no failure is recorded. Otherwise it is an object with string `code`, string `message` and optional `details`, for example:

```json
{
  "code": "provider_timeout",
  "message": "The model provider did not respond in time."
}
```

Optional `state.model` holds the latest call's allowlisted provider diagnostics: `requestId`, `responseId`, resolved `model`, provider `status`, and optional `usage` (input/output/total/cached-input/reasoning token counts). Missing usage is unknown. Tool workflows retain metadata separately for each round; the latest call is not a total across the Run. Fields freeze with the terminal checkpoint. Add JSON indexes only for actual queries.

Optional `state.tools` has version 1, a checkpoint counter, ordered model rounds and calls, and result/error accounting. Call records reference immutable `tool_call` and `tool_result` Acts and contain lifecycle/authorization evidence. Completed model rounds produce `model_output` Acts. `model_request.tools` captures definitions, resource descriptions, instructions, limits and ordered continuation references/results. Optional `availabilityIssues` in requests and checkpoints retain safe public capability diagnostics. Existing payloads without these fields remain valid.

Each captured source excerpt gains a dispatcher-owned `citationId`; the handler's reference `id` stays unchanged. Call checkpoints retain both `referenceIds` and optional `citationIds`. [Citation lookup and historical compatibility](features/tools.md#execution-and-inspection).

`provider_continuations` links one private JSON output-item array to its output Artifact and Run. Runtime roles can select/insert, not update/delete; inspection never joins this table. Public output payloads retain its hash/byte count, checked before replay. A database trigger prevents updating captured request/output/call/result payloads or deleting thread captures; expired threadless image summaries retain their existing cleanup path.

Known Decision checkpoints support [durable continuation](features/decisions.md#execution-integration). Other interrupted execution follows [execution and transactions](#execution-and-transactions).

## Thread visibility

[VIS-R01–13](../specs/features/thread-visibility.md#rules) defines archive, revival, pins and naming. `is_archived` and `is_pinned` remain independent booleans. Manual metadata edits preserve `updated_at`, which orders Threads by meaningful activity. `threads.initial_title`, validated `threads.lifecycle` and `thread_assessments` implement the [checkpoint and conflict contract](features/thread-visibility.md#persistence-and-conflicts). Independent `thread_assessments.request` and `.result` retain evidence; `application_changes` stores controls and actual transitions. Migration preserves archive/pin state and manual title ownership without inference.

## Execution and transactions

1. Check `request_key` before rejecting a busy thread. A matching command hash returns the existing Run; conflicting reuse fails. Recheck under the target thread lock so concurrent duplicate submissions cannot create two Runs. The unique key is the final guard.
2. In one transaction, persist Input, user Surface and queued Run; capture a consistent thread/instruction selection, select the provider/model/options, insert the request Act and complete `state`. Insert the Run before its Act; an incomplete checkpoint is allowed only inside this transaction. Retry transaction conflicts before dispatch. Commit before any provider call.
3. Claim work with an atomic queued-to-running transition and set `started_at`. Only the process that successfully claims the row dispatches the captured request. Persist the response Surface and checkpoint reference together, then persist content before delivering it to the client.
4. Every response-content or checkpoint write locks the Run and verifies it is still running. Cancellation and settlement use the same row lock. Commit any final content/checkpoint together with status/error/end time; late output cannot overwrite a stopped Run. Completed empty visible responses still have a Surface with an empty content array.

One queued/running execution per thread initially prevents concurrent response generation there. `created_at` records persistence; `started_at` may be later while work waits for capacity, or null if stopped before execution. Client reconnect reads saved rows without dispatching again. Settled Runs never reset to queued.

Explicit retry creates another Run with a new command key, the same input/target and `retry_of_id` pointing to the previous settled Run. Its new call record follows the [captured request contract](#instructions-and-captured-requests). It creates no duplicate user Surface and leaves the prior outcome intact. Fresh context or a changed prompt is a new submission.

The deployment must enforce one backend owner before startup recovery. After a restart, resume only eligible [Decision checkpoints](features/decisions.md#execution-integration); mark other queued/running executions interrupted before accepting work. The response reflects that Run outcome without an Artifact status update. Never automatically repeat an active provider call or a dispatched action with an unknown outcome. Leases, worker takeover, general background waits and multiple workers require a separate execution design.

## Application edits and undo

[ART-R10](../specs/features/artifacts.md#rules) defers broader application audit history; [VIS-R13](../specs/features/thread-visibility.md#rules) retains Thread controls and transitions in `application_changes`, outside Artifacts. Ordinary edits update current rows. Desktop session undo may retain the previous value and the value it wrote, then issue a reversing backend command that compares the expected current value before applying. Grouped reversals are transactional. This supports recent manual edits without promising persistent history or undo across devices/restarts.

Use stable entity IDs and idempotent organization commands for transport retries. Compare expected prior values before edits so stale retries cannot overwrite newer changes. Run submissions use `request_key` and `request_hash` for their duplicate-delivery guard.

## Constraints beyond DBML

DBML includes primary, unique and foreign keys plus row checks. Migrations must also add:

```sql
CREATE UNIQUE INDEX one_active_run_per_thread
  ON runs (thread_id)
  WHERE status IN ('queued', 'running');

CREATE UNIQUE INDEX one_initial_run_per_input
  ON runs (input_artifact_id)
  WHERE retry_of_id IS NULL;
```

Transactional writers must also enforce:

- Artifact layer/type references, valid payload shapes, immutable provenance and allowed response-content writes. Surface ownership is required directly on its row.
- A Run's input is Input. Its checkpoint and error follow the [state contract](#run-state-and-errors); no accepted thread Run commits without its complete request snapshot.
- A retry points to a previously settled Run with the same input/thread and copies its captured model-visible content; it cannot form a cycle.
- A completed first-journey Run has a persisted response, including an explicitly empty one. Terminal Runs reject further content/checkpoint writes.
- Instruction ownership follows the [cross-table locking rule](#instructions-and-captured-requests). Memberships and new Instruction attachments cannot target soft-deleted Topics.

Database migrations govern schema changes, including changes to JSON payload/state structure. Validate those structures in shared application contracts when implementation begins.

## Backup and recovery

Use PostgreSQL point-in-time recovery (PITR): a physical base backup plus a continuous archive of WAL through the desired recovery point. A SQL dump plus WAL is not sufficient. Local WAL is recycled, so merely enabling ordinary database logging is not a backup strategy. See [PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html).

Restore into an isolated PostgreSQL instance with Ash workers and external dispatch disabled. Verify the database at the selected time before applying startup interruption handling or promoting it. PITR restores the whole cluster, including its then-current schema; use compatible PostgreSQL and application versions. It does not selectively undo one thread, migrate history into a new model, or reverse external actions. Selected-row recovery requires restoring a separate copy and deliberately reconciling the data.

Recovery is limited by retained base backups, uninterrupted archived WAL and archive lag. G03 must set backup storage, retention, acceptable data loss and recovery time, archive monitoring and restore-drill ownership. Back up configuration and immutable attachment files alongside the database. A restore must include every referenced image hash before enabling dispatch; the database cannot reconstruct missing pixels. External actions may already have happened after the recovery point while their request keys are absent from the restored data; reconcile that work before resubmitting client queues.

PITR is a chosen design, not configured or verified by this DBML change. Permanent erasure remains G06 and must cover live rows, captured requests and backup retention. Restrictive foreign keys prevent accidental cascades; they are not an erasure policy.

## Verification

Validate the diagram with the official [DBML CLI](https://dbml.dbdiagram.io/cli/), currently pinned for design checks to `@dbml/cli@10.3.1`:

```sh
dbml2sql specs/data/model.dbml --postgres -o /tmp/ash-model.sql
```

SQL export validates structure only. Implementation must verify thread C01–C14, artifact A01–A09 and instruction I01–I03, including backup restoration with no external dispatch. Backup restore drills are separate from [development resets](development.md). After implementation, follow the [migration-to-DBML workflow](architecture.md#schema-workflow).
