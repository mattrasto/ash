# Persisted chat implementation

Deterministic slice implemented and verified, 2026-10-09

Scope and behavior: [conversation spec](../../specs/features/conversations.md). Verification scenarios: [test plan](../plans/persisted-chat-tests.md).

## Try it

Run `pnpm dev:setup`, then `pnpm dev`. Create a named thread, send a message and follow up. **Inspect** opens the Artifact chain; select its request Act or Ash Surface to see captured model messages, instruction identity, selection/omissions, generation options and Run checkpoint. The inspector refreshes while the selected chain has active work.

The **Test response settings** selector controls the deterministic adapter: normal, slow streaming, failure before output, failure after partial output, or an empty response. It is development behavior, saved in each model request. Explicit retries reuse the frozen message/context selection and use the current test setting. No provider credentials or external calls are used.

**Development checks** retains the original scratchpad for database/file/client isolation checks. Chat drafts and pending delivery keys live in the isolated desktop's browser storage. Accepted messages and execution state live in PostgreSQL.

## Implementation map

| Location | Responsibility |
| --- | --- |
| `packages/server/prisma/` | Six product tables, development baseline and committed SQL migrations. |
| `scripts/dev/product-database.ts` | Guarded baseline/deploy, seeded base instructions and restricted runtime grants. |
| `packages/server/src/modules/conversations/` | HTTP routes, submission transactions, streaming persistence, cancellation, retries and inspection. |
| `packages/server/src/modules/context/select.ts` | Current-thread Surface selection and omission metadata. |
| `packages/server/src/platform/models/deterministic.ts` | Reproducible streaming, controlled failure and cancellation. |
| `packages/shared/src/contracts/conversations.ts` | Command validation, payload/checkpoint schemas and client contracts. |
| `packages/client/src/renderer/features/conversations/Chat.svelte` | Thread list, transcript, composer, pending delivery and inspector. |

## Execution details

The backend owns execution independently of a desktop window. A dedicated database connection holds an advisory lock before unfinished work is marked interrupted. Loss of that connection terminates the backend; another process cannot perform startup recovery while the original owner holds the lock.

Submission uses a serializable transaction and thread lock. Conflicting transactions retry before dispatch. Each accepted command has a stable key and command hash; repeated delivery reads the existing Run before checking whether the thread is busy. Streaming writes and cancellation serialize on the Run row. Response creation, checkpoint changes and completion are committed together as required by the [data-model contract](../data-model.md#execution-and-transactions).

The desktop polls saved snapshots every 150 ms while a response is active and every 800 ms otherwise. This is the initial incremental delivery transport; no durable event stream is added. A reconnect fetches state without dispatching work. Snapshots use a consistent database transaction so content and Run outcome agree.

Context uses a 12,000-character budget and a 4,000-character input limit; this is an explicit test-model bound, not a token estimate. Selection follows CONV-R15. Older conversation groups are omitted together when they do not fit; the current message and base instructions must fit. The captured request records every selected source and excluded Surface.

## Schema operations

Prisma CLI/client are pinned to 6.19.3 and DBML CLI to 10.3.1. `pnpm db:generate` generates the client and runs automatically after dependency installation. Startup of a stopped instance applies committed migrations before launching its backend; a running preview needs Stop/Run after migration changes.

Existing `dev_meta`/`dev_scratch` tables are baselined only in an identity-checked development database. Product migrations then run using its owner role. Runtime credentials have no schema privileges and cannot change immutable identity/provenance columns. The shared bootstrap schema version remains 1; product structure is tracked in Prisma's migration table. Fixture version 2 adds seeded base instructions, including in an otherwise empty instance.

The schema test compares DBML-exported tables with the migrated database and checks Prisma drift. DBML's exporter emits deferrable foreign keys; deployed keys are immediate and non-deferrable. The comparison checks their targets/actions while allowing that exporter difference. SQL-only checks and partial indexes are tested separately.

## Limits

Topic management, instruction editing, archive/pin controls, Artifact moves, live providers and generalized background execution remain deferred. A persisted checkpoint does not imply automatic continuation. PITR operation and restore drills remain pending; restart tests establish persistence, not recovery from lost database storage.

## Verification

`pnpm verify` passed on 2026-10-09: typechecking, isolated build, 8 unit tests and 25 integration/desktop tests. Evidence: `~/.ash-dev/evidence/2ba6f2ea74eb63aa1c53b997/` (`report.json`, `checks.log`, `chat-server.log`, `chat-inspection.png`, `chat-reconnected.png`). The report records the tested source fingerprint and migration version.

A separate review pass checked transaction conflicts, immutable request/checkpoint handling, backend ownership, startup identity validation, late-output cancellation and uncertain-delivery keys. The running preview was also exercised through two messages and captured-context inspection. The migrated PostgreSQL schema was exported to DBML; automated comparisons found no structural drift. Deferred features above were not verified.
