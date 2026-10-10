# Persisted chat test plan

Scope accepted: deterministic text chat and Artifact/context inspection. [Verification results](../features/conversations.md#verification).

Product rules: [Conversations](../../specs/features/conversations.md), [Artifacts](../../specs/features/artifacts.md), [data model](../data-model.md). Topic management, instruction editing, archive/pin UI, live providers and PITR operation are outside this implementation slice. Existing accepted behavior for those features remains future work.

## Automated coverage

| Scenario | Required result | Level |
| --- | --- | --- |
| Migration and upgrade | All six product tables, FKs, checks and partial indexes exist. Repeated migration preserves existing scratchpad and chat data; runtime cannot migrate. | PostgreSQL integration |
| First exchange · C01 | One Input, one user Surface, one Run and its frozen request Act; one response Surface after completion. Only Surfaces appear in chat. | API + desktop |
| Follow-up · C03 | Base instructions and this thread's selected Surface messages appear exactly once in the captured request. Other threads are absent. | Unit + API + desktop |
| Inspection · C04 | User/reply inspection exposes source links, Run checkpoint/outcome, exact captured messages, instruction identity, provider/model/options and omissions. | API + desktop |
| Duplicate delivery · C05 | Concurrent identical keys return the same Run, including while busy and after completion. Conflicting key reuse fails. Separate keys are separate commands. | PostgreSQL integration |
| Concurrent work · C08 | One active Run per thread; a blocked submission changes no rows. Another thread can run. Typed drafts survive polling and thread changes. | API + desktop |
| Streaming · ART-R09 | Visible content was committed first. One response Surface grows; no chunk Artifacts. Terminal outcome freezes content/checkpoint. | API |
| Reconnect · C06 | Closing/reopening the client during generation recovers the same Run without dispatching again. | Desktop |
| Stop/fail/retry · C07 | Queued cancellation has no start time; running cancellation retains partial text; later chunks cannot change it. Retry uses a new Run/request/response and the same Input, preserving the frozen request content. | API + desktop |
| Restart · C11 | Completed state survives. Queued/running work becomes interrupted and is not dispatched automatically. Failure before output is still visible. A second backend owner is rejected. | PostgreSQL + process integration |
| Context limit · C12 | Older complete conversation groups are omitted at the configured bound. Current input and instructions remain, with explicit omission metadata. | Unit + API |
| Retry context · C14 | Only the latest completed reply per Input is selected. Failed/partial/superseded replies remain visible and are excluded; failed retries do not displace a completed answer. | Unit + API |
| Instance isolation | Preview/test data, credentials, files and client preferences remain independent; reset only affects its owned instance. | Existing workflow suite + chat integration |
| Schema drift | Prisma, migrated PostgreSQL and DBML agree on columns, types, defaults, nullability, keys and relationships. SQL-only checks are verified separately. | Schema integration |

## Desktop demonstration

1. Start a disposable instance. Create a thread and exchange two messages. Observe streaming and inspect the follow-up's exact context and causal records.
2. Switch threads while typing and while a response runs; return and confirm draft/state preservation.
3. Cancel a slow response, inspect its partial content, retry, then send a follow-up. Inspect which attempt entered context.
4. Close/reopen the desktop during a response. Restart the backend during another response. Confirm completion versus interruption is accurately distinguished.
5. Inspect persisted content after a full stop/start. Verify developer storage checks still work.

## Execution and evidence

Run `pnpm verify` for typechecking, isolated builds, unit tests, real PostgreSQL checks and Electron interaction. Reports must identify source fingerprint, lockfile, schema/fixture versions, deterministic model mode, scenarios, failures/skips and screenshots. Verification uses disposable instances and does not reset the persistent preview.

Review transaction boundaries, snapshot consistency, terminal-write guards, credential handling and cleanup separately after tests. Record actual results in [implementation notes](../features/conversations.md); do not treat this plan as evidence of a pass.

PITR needs separate backup storage/retention decisions and an isolated restore drill with dispatch disabled. Restart persistence tests do not establish backup recovery. Live-model quality and provider spending are not exercised by the deterministic adapter.
