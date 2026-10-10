# Data model

Six-table design and PITR recovery accepted, 2026-10-09 · Physical details proposed · Unimplemented

[DBML](../specs/data/model.dbml) · [Artifact rules](../specs/features/artifacts.md) · [Instruction rules](../specs/features/instructions.md) · [Open decisions](../specs/open-questions.md)

## Storage

One private Ash instance uses one database and initially one backend. Current rows are authoritative; recovery follows [ART-R08](../specs/features/artifacts.md#rules). The backend assigns record IDs and timestamps. `updated_at` starts at `created_at` and changes with the row's editable fields. Naming follows the [engineering agreement](../specs/product.md#confirmed-engineering-agreement).

### First-phase coverage

Scope: the [text-conversation journey](../specs/features/conversations.md). No additional product tables or columns are needed for these requirements.

| Capability | Stored data |
| --- | --- |
| Create/rename Topics and Threads; change membership | `topics.name`, `threads.title`, `thread_topics`; Topic soft deletion uses `deleted_at`. |
| Archive/pin Threads | `threads.is_archived`, `threads.is_pinned`. |
| Edit base instructions | `instructions.key/name/text`; owner FKs also support later Topic/Thread editors. |
| Save and order messages | Surface `payload.speaker/content`, `thread_id`, `created_at` and `id`. |
| Submit without duplicates | `runs.input_artifact_id`, `request_key`, `request_hash`; unique constraints. |
| Stream, reconnect, cancel and retry | Saved Surface content; Run `state`, `status`, `error`, timestamps and `retry_of_id`. |
| Inspect context and select retry results | Request payloads retain messages, instruction identities, limits, omissions, provider/model/options; Run input links and status select the answer under CONV-R15. |
| Restore after data loss | All six tables, physical backups and archived WAL. |

Typed drafts and selection state belong to the desktop client. Provider credentials and model configuration belong to the backend configuration.

## Run boundary

A Run tracks an Act workflow and its outputs, including Surface Artifacts. Routine Listen/Input/Filter/Route processing does not create Run rows. Those stages may use workers or model calls; using a worker does not itself create a product Run.

A workflow may contain several model calls using different providers or models. Each call has its own Artifact payload. Find produced Artifacts through `artifacts.run_id`; the checkpoint references those currently needed by the workflow.

The first journey implements one response per Run. User Input and its directly mirrored Surface precede that Run and have no producing `run_id`. Multiple-call execution, independently finalized outputs, durable waits/resumption and threadless Act workflows still need execution contracts before implementation; the initial Run requires one Input and a target thread.

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
| Input / `text_input` | Original input text and any source metadata. |
| Act / `model_request` | Exact model-visible messages, instruction/context selection, and this call's `provider`, `model` and `options`. See [captured requests](#instructions-and-captured-requests). |
| Surface / `message` | `initial_thread_id`, `speaker`, ordered `content` blocks and any presentation metadata. |

`payload.speaker` is required for Surface messages: `user` for the mirrored user message, `ash` for the reply. Omit it from other payloads; internal model roles belong in `messages`. Surface messages use blocks so the payload can later include images, references and other structured content. The first text journey supports text blocks:

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

## Instructions and captured requests

`instructions` stores current name/text for a common editor. `topics.instruction_id` and `threads.instruction_id` are nullable, unique FKs implementing [INST-R02](../specs/features/instructions.md#rules). Null means no custom document. Global documents instead have a unique stable `key`, initially `response`; Topic/Thread documents have a null key.

The unique constraints prevent sharing within each owner type, but not across Topics and Threads. For ownership changes, use a `READ COMMITTED` transaction: lock the Instruction row, then check both owner tables in a separate query so the check sees changes committed while waiting for the lock. Reject a different owner or a global key. All attachment/key changes must follow this lock protocol; an owned document cannot become a global prompt. Create/copy and attach a document atomically. Soft-deleting a Topic retains its document; erasure remains G06. See [PostgreSQL snapshot behavior](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

A `model_request` Act stores the exact ordered model-visible messages, instruction IDs/owner identities, message-array indexes and exclusions/limits. Selected instruction text is already in the messages; do not resolve current Instructions to inspect an old execution. Capture provider-adapter additions too; credentials and private model reasoning are excluded.

Build conversation context from Surface messages under [CONV-R05 and CONV-R15](../specs/features/conversations.md#requirements). Do not include their Input or Act copies as additional messages. For each Input, choose its completed Run with the greatest `(ended_at, id)` and include that Run's response if it is in the current Thread. Apply context limits after selection and record omitted attempts/content in the request. An Input without a completed response contributes its user message only.

Select and record the call's provider, exact model identifier and generation options before committing that request. Dispatch must use those recorded values; choosing a different request requires another Artifact, not mutation of a frozen one. A saved request records prepared work, not proof that the provider accepted or completed it.

Each call gets its own request Artifact, including explicit retries. A retry copies the previous frozen model-visible content instead of reading current instructions or conversation; its call record retains that retry's selected provider/model/options. The original input and `retry_of_id` retain the relationship to the earlier execution. Model selection on retry remains G07/G09.

## Run state and errors

`runs.state` holds the latest persisted workflow checkpoint. Store execution progress and Artifact references; keep transcripts and tool results in Artifacts. Future wait/resume behavior will define its own checkpoint shape.

The first response workflow uses this minimal shape at acceptance:

```json
{
  "request_artifact_id": "00000000-0000-0000-0000-000000000002",
  "response_artifact_id": null
}
```

`request_artifact_id` is required and immutable for this workflow; it references this Run's frozen `model_request` Act. `response_artifact_id` stays null until a response is saved, then references this Run's Surface. Create the Surface and set the reference atomically. A completed empty reply still has a Surface; failure/cancellation before output may have none. In that case, display the Run's outcome beside its originating user message.

Validate each reference's existence, layer, type and producing Run on write; JSON references have no SQL FKs. Commit checkpoint changes with their related Artifacts/outcome. Terminal Runs freeze the checkpoint; status and error remain separate columns.

`runs.error` is null when no failure is recorded. Otherwise it is an object with string `code`, string `message` and optional `details`, for example:

```json
{
  "code": "provider_timeout",
  "message": "The model provider did not respond in time."
}
```

Per-call diagnostics belong with the call's records. Omit credentials and raw provider dumps. Add JSON indexes only for actual queries.

Persisting state does not implement safe continuation. The initial restart behavior remains interruption and explicit retry under [execution and transactions](#execution-and-transactions).

## Thread visibility

[CONV-R14](../specs/features/conversations.md#requirements) defines manual archive and pin behavior. `is_archived` and `is_pinned` are independent booleans, defaulting to false. Update the changed flag and `updated_at` together. Neither flag records when it changed or schedules a future action. Derive ongoing activity from Runs.

## Execution and transactions

1. Check `request_key` before rejecting a busy thread. A matching command hash returns the existing Run; conflicting reuse fails. Recheck under the target thread lock so concurrent duplicate submissions cannot create two Runs. The unique key is the final guard.
2. In one transaction, persist Input, user Surface and queued Run; capture a consistent conversation/instruction selection, select the provider/model/options, insert the request Act and complete `state`. Insert the Run before its Act; an incomplete checkpoint is allowed only inside this transaction. Retry transaction conflicts before dispatch. Commit before any provider call.
3. Claim work with an atomic queued-to-running transition and set `started_at`. Only the process that successfully claims the row dispatches the captured request. Persist the response Surface and checkpoint reference together, then persist content before delivering it to the client.
4. Every response-content or checkpoint write locks the Run and verifies it is still running. Cancellation and settlement use the same row lock. Commit any final content/checkpoint together with status/error/end time; late output cannot overwrite a stopped Run. Completed empty responses still have a Surface with an empty content array.

One queued/running execution per thread initially prevents concurrent response generation there. `created_at` records persistence; `started_at` may be later while work waits for capacity, or null if stopped before execution. Client reconnect reads saved rows without dispatching again. Settled Runs never reset to queued.

Explicit retry creates another Run with a new command key, the same input/target and `retry_of_id` pointing to the previous settled Run. Its new call record follows the [captured request contract](#instructions-and-captured-requests). It creates no duplicate user Surface and leaves the prior outcome intact. Fresh context or a changed prompt is a new submission.

The deployment must enforce one backend owner before startup recovery. After a restart, mark queued/running executions interrupted before accepting work; the response reflects that Run outcome without an Artifact status update. Never automatically repeat a provider call. Leases, worker takeover, general durable waits and multiple workers require a separate execution design.

## Application edits and undo

[ART-R10](../specs/features/artifacts.md#rules) defers application audit history. Ordinary edits update current rows. Desktop session undo may retain the previous value and the value it wrote, then issue a reversing backend command that compares the expected current value before applying. Grouped reversals are transactional. This supports recent manual edits without promising persistent history or undo across devices/restarts.

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
- A Run's input is Input. Its checkpoint and error follow the [state contract](#run-state-and-errors); no accepted conversation Run commits without its complete request snapshot.
- A retry points to a previously settled Run with the same input/thread and copies its captured model-visible content; it cannot form a cycle.
- A completed first-journey Run has a persisted response, including an explicitly empty one. Terminal Runs reject further content/checkpoint writes.
- Instruction ownership follows the [cross-table locking rule](#instructions-and-captured-requests). Memberships and new Instruction attachments cannot target soft-deleted Topics.

Database migrations govern schema changes, including changes to JSON payload/state structure. Validate those structures in shared application contracts when implementation begins.

## Backup and recovery

Use PostgreSQL point-in-time recovery (PITR): a physical base backup plus a continuous archive of WAL through the desired recovery point. A SQL dump plus WAL is not sufficient. Local WAL is recycled, so merely enabling ordinary database logging is not a backup strategy. See [PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html).

Restore into an isolated PostgreSQL instance with Ash workers and external dispatch disabled. Verify the database at the selected time before applying startup interruption handling or promoting it. PITR restores the whole cluster, including its then-current schema; use compatible PostgreSQL and application versions. It does not selectively undo one thread, migrate history into a new model, or reverse external actions. Selected-row recovery requires restoring a separate copy and deliberately reconciling the data.

Recovery is limited by retained base backups, uninterrupted archived WAL and archive lag. G03 must set backup storage, retention, acceptable data loss and recovery time, archive monitoring and restore-drill ownership. Back up configuration and any future external attachment/object storage separately. External actions may already have happened after the recovery point while their request keys are absent from the restored data; reconcile that work before resubmitting client queues.

PITR is a chosen design, not configured or verified by this DBML change. Permanent erasure remains G06 and must cover live rows, captured requests and backup retention. Restrictive foreign keys prevent accidental cascades; they are not an erasure policy.

## Verification

Validate the diagram with the official [DBML CLI](https://dbml.dbdiagram.io/cli/), currently pinned for design checks to `@dbml/cli@10.3.1`:

```sh
dbml2sql specs/data/model.dbml --postgres -o /tmp/ash-model.sql
```

SQL export validates structure only. Implementation must verify conversation C01–C14, artifact A01–A09 and instruction I01–I03, including backup restoration with no external dispatch. Backup restore drills are separate from [development resets](development.md). After implementation, follow the [migration-to-DBML workflow](architecture.md#schema-workflow).
