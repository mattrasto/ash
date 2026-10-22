# Thread visibility implementation

Accepted behavior, 2026-10-21 · Independent assessment/history storage implemented · Automated coverage below; live-model judgment remains to be evaluated

[Product rules and acceptance](../../specs/features/thread-visibility.md) · [Data model](../data-model.md) · [Testing](../testing.md)

## Boundaries

`modules/visibility/service.ts` owns assessment scheduling, immutable captures/results, safe application, startup interruption and deadline sweeps. It uses the existing configured model adapter and provider accounting, with distinct `thread_visibility` and `thread_naming` purposes. No tools or answer Runs are created. Permissions/Decisions retains authorization and waiting/resumption ownership.

`record_thread_activity` and `thread_run_activity` in migrations `202610210003_application_history` and `202610210004_waiting_visibility` invalidates the deadline and updates current state atomically with accepted source/user Surfaces, routed intake, queued work, tool results and terminal Runs. Stream chunks, waiting/resumption and metadata writes do not trigger it. Waiting Runs and linked pending/snoozed Decisions hold archive separately from queued/running execution, exposed as `waitingWork` alongside `activeWork`. `mediaActivity` observes saved descriptions before the Attachment update in the same transaction.

`Threads.updateThread` uses a command identity and expected lifecycle revision. Its one saved inverse supports session Undo; activity or a later automatic edit invalidates Undo. `initial_title` preserves creation idempotency across later naming. `Threads.markSeen` only advances the supplied cursor; polling cannot acknowledge a newer activity cursor on behalf of an older view.

`application_changes` retains accepted manual commands and actual transitions with their origin and optional source-Artifact/assessment reference. The command UUID deduplicates retries; automatic changes have generated identities. `recordThreadChange` and the activity SQL hook commit history with the current row. Archive/name transitions render as quiet notices; pins and title ownership remain available in history. These records never enter ordinary response/retrieval context or trigger activity themselves.

Manual Unarchive invalidates the old deadline and saves its application-change ID as the next assessment trigger. Explicit Recalculate and Automatic name also establish their own trigger when content exists, including migrated history with no previous trigger. Captures select recent changes alongside relevant content; no fixed manual hold remains. `sourceId` refers only to existing conversational/processing evidence; `changeId` separately identifies an explicit control. Meaningful activity replaces the trigger and clears `changeId`.

Migration `202610210003_application_history` copies exact historical model requests/results and command/notices into the independent tables, preserves notice IDs and times, then removes the migrated feature Artifacts. Older captures retain their original selection IDs; inspection resolves former controls/notices to application history. Unexpected non-feature descendants abort the transaction instead of deleting unrelated evidence. Ordinary conversation Artifacts remain intact. SQL constraints reject new Thread-management Artifacts; application history is immutable, and an assessment permits one terminal update after its immutable request capture.

`DraftPresenceSync` reports only changes between empty/nonempty draft state through `POST /api/threads/:id/draft`. The client persists its identity and monotonically increasing revisions before sending, retries after reconnect, and reconciles against saved server revisions after reload. Before clearing a saved hold, it waits for recording recovery and the initial native recording state; recovery failure preserves the hold and offers a reload retry. New draft presence can still be saved during recovery. The backend serializes presence updates and deadline enforcement on the Thread lock; stale revisions cannot clear a newer draft. Any client’s saved presence holds automatic archive across backend restart. These flags do not change activity/control revisions, create history or Artifacts, or schedule inference. Draft text and attachments remain in the existing local draft store.

## Cost and scheduling

Use the configured generative provider first. Existing provider/session options apply; this feature adds no hourly quota or token/character ceiling. Assessment context uses the product item window, saved media descriptions, current time and the backend's IANA time zone. Recent work outcomes and original incoming sources accompany their selected evidence. A previous finite result retains its selected items as deadline evidence even when they fall outside the recent window. Captures record item-window omissions.

The five-second pump checks due state, with the product debounce/throttle and a maximum 60-second trailing burst delay. Naming coalesces crossed Fibonacci thresholds until work settles. Two background workers bound simultaneous dispatch without occupying response capacity. List polling batches work-state queries; idle Threads never capture requests or call a provider. Deadline sweeps use current saved state and no inference.

Failures preserve safe visible state and inspectable output. No provider attempt is retried automatically. A cheap Jev gate remains a possible optimization only after measuring visibility-specific reuse accuracy, skip rate, latency and total cost.

## Persistence and conflicts

`threads.lifecycle` is a validated `ThreadLifecycle` checkpoint: activity/read/message counters, title ownership, control/version counters, deadline state, unread timestamps, pending/last-attempt timestamps, separate activity/control trigger references, per-client draft presence/revisions, last command and one Undo inverse. Archive and pin booleans remain independent columns. Existing titles migrate as manual; settled historical Surfaces seed message counts without scheduling inference.

`thread_assessments` owns the request JSON, revision capture and nullable terminal result, with one running assessment per Thread/kind enforced by a partial unique index. Results retain public output, usage, reason and applied/discarded/failed/interrupted status. It has no Artifact identity or source-chain requirement. The existing configured adapter, accounting and `ContextView` inspection are reused; `/api/thread-assessments/:id` and `/api/application-changes/:id` read saved evidence without dispatch. The Thread response returns conversation Artifacts and application changes separately; the client merges selected notices by creation time and stable identity.

Capture activity/control revisions and a fingerprint of relevant instructions, membership and Topic metadata. Compare again under the Thread lock before applying. Activity changes during inference preserve pending work; stale naming after new activity is coalesced into a fresh assessment. Context edits alone discard stale results without scheduling another call.

All activity and metadata writers lock the Thread. Run/intake callbacks may acquire that lock after their own row; visibility readers never lock a Run/intake after locking a Thread. The execution scheduler skips a locked waiting Run while holding its Thread, avoiding a lock cycle with concurrent settlement. Media completion locks referenced Threads in stable ID order before updating the Attachment, matching submission's Thread-before-Attachment ordering. No execution checkpoints or authorization ownership move into this module.

Startup runs execution/intake recovery first, then marks assessment attempts interrupted and consumes pending assessment schedules without dispatch. Existing deadlines are enforced immediately. Polling cannot replay unfinished inference. A new event or explicit recalculation may start a new attempt.

## Verification

`tests/integration/visibility.test.ts` uses real isolated PostgreSQL and controlled model output with an injected scheduler clock. It covers expiry, revival, grace, pins, read-cursor races, independent Fibonacci naming, duplicate commands, Undo conflicts, stale control/context edits, immutable independent inspection, zero Artifact writes, populated-history migration, item omissions, invalid output and restart without provider replay. Desktop coverage exercises the controls, archive/revival, initial naming notices, persistent history and draft protection. The [manual retest](../plans/thread-visibility-retest.md) uses single-token cues and ten-second deadlines.

Regression coverage includes explicit controls on migrated visible/internal-only history, delayed recording recovery across an expired deadline, and late history responses after switching the visibility panel. `visibility-decisions.test.ts` covers waiting/snoozed holds, a free execution slot, terminal counting, recovery with and without a saved answer, cancellation, scheduler lock contention and both migration orders. Desktop checks preserve unread activity and drafts behind Decisions.

Run quick verification while iterating and full verification on unchanged source for this schema/shared-contract change. Explore a disposable background desktop with synthetic data before handoff. Live-model deadline suitability and naming quality need separate empirical evaluation; deterministic checks establish state behavior, not model judgment.
