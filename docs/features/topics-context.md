# Topics and working context

Implemented · [Product rules](../../specs/features/topics-context.md) · [Accepted test plan](../plans/topics-context-tests.md)

## Ownership and operations

`modules/organization/service.ts` owns Topic operations, membership and instruction saves. `organization/routes.ts` exposes authenticated API operations; `contracts/organization.ts` validates strict commands. The sidebar owns expandable Topic groups and their create/rename/delete menus, plus the Thread membership submenu and drag targets. Checkbox changes use the loaded membership version; drops load current membership before adding a link. Both use the existing version-checked membership operation, surface failures and refresh saved state. The Topic row also creates a linked Thread directly. Both entity menus open the shared Settings instruction editor at that owner. Settings has a fixed viewport-capped frame and scrollable body; it contains no Topic-management tab.

Topic creation accepts a stable client UUID for transport retries. Rename/delete compare `updated_at`. Membership replacement locks its Thread, compares `threads.topics_version`, locks selected Topics in ID order, then updates joins and increments the version. Existing links retain `linked_at`; new links use the acceptance time. Identical retries are no-ops. `Threads.createThread` optionally accepts a Topic ID and creates the Thread and membership in one transaction after locking the active Topic; retrying an existing creation does not reapply later-removed membership. Soft deletion retains joins and instruction ownership but all active membership queries exclude deleted Topics.

A pending Thread creation reuses its UUID only for the same destination. Selecting a different Topic or the unlinked New Thread action starts a new command; an earlier creation whose response was lost keeps its original membership.

Instruction saves lock the owner and existing Instruction, validate exclusive ownership, then compare the document ID and timestamp. New owner documents are created and attached atomically. No operation accepts an existing Instruction ID for reassignment. Stale saves return 409; the editor preserves the draft and lets the user compare saved text before saving again. Empty owner text remains editable but contributes no guidance.

The additive migration `202610120002_topics_context` adds a nonnegative membership version with default zero. Older rows and request payloads remain readable. Product credentials can perform these operations but cannot change the schema.

## Capture and retrieval

`Threads.accept` captures applicable guidance, history and active Topic membership in its existing serializable submission transaction. `context/select.ts` records instruction IDs, owner identities and message indexes alongside exact ordered text. A structural composition message records response priority when Thread guidance applies. New omissions are counts; legacy per-Artifact omission metadata remains readable.

`context/retrieval.ts` is independent of execution. `searchForRun` and `readForRun` take trusted Run identity, strict model arguments and an abort signal. Each call reads a repeatable PostgreSQL snapshot and intersects captured Topic IDs with current active membership. Source membership is checked in that same snapshot. Retrieval linearizes at this snapshot: a change committed before the next call takes effect; it cannot retract a read already underway or a captured result.

Eligible sources are user Surface messages and the latest completed response per Input, ordered by creation time and ID. Current-thread messages and internal records are excluded. A SQL `EXISTS` check deduplicates threads shared by several Topics. Archived threads remain eligible. Search is literal and case-insensitive; it examines the newest bounded set before matching.

Results contain exact excerpts, source Artifact/Thread identities, offsets, total lengths, image/description Run identities, and scan/truncation flags. Image pixels are never retrieved by these handlers. Missing descriptions appear explicitly. UTF-16 offsets match JavaScript strings and never split surrogate pairs. Numeric limits are defined in `RETRIEVAL_LIMITS` and the [accepted test plan](../plans/topics-context-tests.md#accepted-numeric-limits); queries also have a three-second database statement deadline.

`context/tools.ts` adapts the service to the shared `registerTool` / `ToolRuntime` contract. `topic.search` and `topic.read` use the fixed built-in context-read policy. Their model arguments cannot supply Run identity, Topic scope, effects or permissions. Membership remains a separate context restriction. The existing dispatcher owns authorization recording, cancellation, result/continuation persistence and aggregate limits. The adapter bounds serialized results to 32 KiB including dispatcher citation metadata, marks any additional truncation, and returns Topic IDs rather than repeating Topic labels.

## Inspection and compatibility

`organization/ContextView.svelte` renders captured instruction documents, Topic scope, included messages and factual omissions. `RetrievedContext.svelte` renders exact structured Topic excerpts. Answer inspection defaults to the final request; selecting an execution step shows that request's captured context. Source actions open the original thread and Artifact. Historical views never resolve current instruction text or membership. Legacy global-only captures use their existing instruction key and omission fields.

Retrieval adapters emit structured data plus source references with an excerpt hash and location. The dispatcher captures that result and subsequent model requests. Topic deletion changes future eligibility, not these immutable records. Instruction history, Topic restore and permanent erasure remain outside this feature.

`main.ts` composes Topic retrieval with the configured filesystem runtime. Their definitions, scope checks and availability remain independent; both feed the same dispatcher and inspector. [Combined verification](tools.md#verification).
