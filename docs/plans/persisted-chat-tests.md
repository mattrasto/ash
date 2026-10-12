# Persisted chat test plan

Scope: persisted text chat, deterministic and OpenAI adapters, Artifact/context inspection. [Verification results](../features/conversations.md#verification).

Product rules: [Conversations](../../specs/features/conversations.md), [Artifacts](../../specs/features/artifacts.md), [data model](../data-model.md). Topic management, instruction editing, pin UI and PITR operation remain deferred. Image coverage is in the [image test plan](../features/images.md#test-plan); conversation controls and streaming are in the [UX test plan](../features/conversation-ux.md#test-plan). Existing accepted behavior for those features remains future work.

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

Run `pnpm verify` for typechecking, isolated builds, unit tests, real PostgreSQL checks and Electron interaction. Reports must identify source fingerprint, lockfile, schema/fixture versions, model mode, live call count, scenarios, failures/skips and screenshots. Verification uses disposable instances and does not reset the persistent preview.

Review transaction boundaries, snapshot consistency, terminal-write guards, credential handling and cleanup separately after tests. Record actual results in [implementation notes](../features/conversations.md); do not treat this plan as evidence of a pass.

PITR needs separate backup storage/retention decisions and an isolated restore drill with dispatch disabled. Restart persistence tests do not establish backup recovery. Live-model quality and provider spending are not exercised by the deterministic adapter.

## OpenAI adapter

Run regression checks with deterministic responses and mocked provider streams; they have no paid-call budget and must not depend on live access. These cover persistence, context, cancellation, retries, failure handling and inspection.

Keep live checks separate. Use a cheaper model such as [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) for basic API compatibility, plus a small check on the interactive model when validating model-specific options or behavior. Cheap-model results do not establish the interactive model's quality. Live cost comes from the selected model, small inputs/outputs and a targeted case set.

If a live allowance is exhausted, record the affected cases as incomplete and continue independent offline checks. Resume only the outstanding live cases with an authorized allowance. Budget exhaustion is neither a passing result nor a reason to abandon unrelated testing; do not silently create fresh allowances or substitute models to turn a failed check green.

| Scenario | Required result | Level |
| --- | --- | --- |
| Wire request | Frozen messages/model/options sent to Responses; `store:false`; no tools or implicit provider conversation. Only text/refusals and allowlisted identifiers/usage reach stored state. | SDK with mocked HTTP + PostgreSQL |
| Provider outcomes | HTTP 401/403/404/429/500 and network failures make one attempt; raw errors/secrets are excluded. Incomplete/failed events, EOF and mismatched final text fail the Run. | Unit + PostgreSQL |
| Stop and retry | Aborts reach transport; timeout includes streaming. Partial output freezes. Explicit retry preserves its captured request; follow-ups exclude incomplete answers. | Unit + PostgreSQL |
| Live allowance | Concurrent reservations cannot exceed calls; expired sessions cannot dispatch. Reopen/reset retain counters. Sessions cannot cross instance ownership. | Unit + lifecycle integration |
| Interactive chat | Persistent preview can exceed five calls and ten minutes without a session limit; call count survives reopen. Disposable live instances still require explicit paired limits. UI omits the countdown for interactive sessions. | Unit + desktop/lifecycle integration |
| Credential boundary | Default launch ignores `.env.local` and inherited keys. Live mode reads only its key from an owner-only regular file. No session copy; API, inspection and frontend responses omit the key. Reset/disposal preserve the developer file. Tests use a fake key in a disposable checkout. | Unit + desktop/lifecycle integration |
| Inspection | Desktop shows provider/model, reported usage and IDs. Test-response controls are hidden in live mode. Expired-session failure is visible before any network call. | Real Electron + expired backend session |

### Live smoke test

Use an empty disposable instance with a [backend development key](../features/conversations.md#openai-mode) and an authorized model and session allowance. [Latest result and tested limits](../features/conversations.md#live-text-smoke-test). Repeating this procedure requires an allowance for that session.

1. Send a synthetic checklist request and follow-up; verify useful output and the exact captured context.
2. Inspect provider IDs/model and available token usage; compare against the provider dashboard when available.
3. Cancel a longer answer and explicitly retry once. Confirm partial/cancelled history and the separate retry Run.
4. Reopen/restart and verify no extra call or replenished allowance. End the session and dispose the instance.

Record the selected model, session ID, call slots consumed, reported usage, outcomes and source fingerprint. Do not claim an exact bill from missing usage or cancellation. Image generation and personal content are outside this check.
