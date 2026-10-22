# Artifact ownership and history

Ownership accepted, 2026-10-09 · Autonomous incoming-item behavior accepted, 2026-10-14 · Incoming slice implemented · Synthetic boundary and desktop checks passing

[Source](../HUMAN_SPEC.md) · [Data model](../../docs/data-model.md)

## Goal

Process inputs before their destination is known and reorganize visible threads while preserving their recorded origin and processing.

## Rules

- **ART-R01 — Surface ownership:** every Surface Artifact has exactly one current thread. Other artifacts do not require thread ownership, including Route and Act artifacts. This clarifies the source spec's statement that every artifact belongs to a thread.
- **ART-R02 — Thread associations:** an input's source thread, a routing destination and a run's execution target describe processing. These associations are distinct from current Surface ownership and retain their recorded meaning after a move.
- **ART-R03 — Moves and order:** Surface Artifacts display in ascending `(created_at, id)` order within their current thread. Moves change the current thread. Identity, creation time, content, source links and original processing provenance remain unchanged; intermediate move history is deferred under ART-R10.
- **ART-R04 — Groups and chains:** a move operates on explicitly selected Surface Artifacts, individually or together. An Artifact Chain has no single thread owner: its branches may surface in different threads. Moving selected entries preserves their causal links and does not move other branches or future results automatically.
- **ART-R05 — Active work:** moving a Surface Artifact must not implicitly retarget an active run. Whether to allow, block or explicitly coordinate such moves remains open.
- **ART-R06 — Engine records:** Artifacts represent inputs and records produced by the Input, Filter, Route, Act and Surface layers. Application changes, including thread creation/renaming and membership changes, update current rows. Actions in an Artifact Engine workflow produce Act records. Thread visibility/naming runs outside that engine and creates no Artifacts; [VIS-R13](thread-visibility.md#rules) owns its independent assessment and application-history records. A visible Thread annotation does not by itself require a Surface Artifact.
- **ART-R07 — Single source:** Input Artifacts are roots. Each subsequent Artifact has one immediate source; a source can produce many children. Cycles are prohibited, so chains form branching trees. Multiple-parent merging is deferred until a concrete workflow requires it. Context references do not become source relationships automatically.
- **ART-R08 — Recovery:** current database rows are authoritative. Recovery uses PostgreSQL physical base backups and archived WAL for point-in-time recovery (PITR); application-event reconstruction is not required. Artifacts retain recorded engine activity for inspection. This replaces the source spec's Replayable State requirement. Restoring data must not execute models, tools or external effects; operational requirements are in [backup and recovery](../../docs/data-model.md#backup-and-recovery).
- **ART-R09 — Streaming drafts:** the current response Surface's payload content may grow while its Run is running; a terminal Run outcome freezes that content. In the initial one-response-per-Run flow, display state comes from that Run: running means generating, completed means finished, and failed/cancelled/interrupted means stopped. There is no independent Artifact completeness field. Identity, source links, captured requests and original provenance remain immutable. Individual streaming chunks do not require history records.
- **ART-R10 — Application history and undo:** Thread controls and transitions retain separate application history under [VIS-R13](thread-visibility.md#rules). Broader audit history remains deferred, including memberships, moves and instruction edits. Desktop session state may support undo of manual edits by issuing reversing backend changes that reject conflicts with newer edits. This does not promise undo across restarts or devices. Captured model requests retain the instruction text actually used; PITR is recovery, not a searchable change history.

## Incoming-item slice

Accepted, 2026-10-14. Synthetic text items exercise the same ingestion boundary future Connections will use. Connection adapters, inferred Topic membership, moves/split/merge, notifications and device-specific presentation remain follow-ons.

- **ART-R11 — Receipt and Filter:** durably retain original text, source identity, optional source URL and event time before assessment. A source/event identity deduplicates delivery; changed content under that identity is rejected. Record pass/drop and a concise reason. Drop stops propagation, not retention; it creates no Thread, Run or Surface. Processing failures remain errors, not drops. Direct user messages retain their existing Filter/Route bypass.
- **ART-R12 — Autonomous Route:** preserve a trusted explicit Thread target. Otherwise choose the best-fitting existing Thread or create a new one for a separate matter or weak fit. Make a reasonable assumption when uncertain, including consequential conflicts among Topic routing instructions; record the assumption and placement rationale without asking or creating a Decision. Initial placement is automatic; later reorganization remains suggestion-based. Asking the user to double-check ambiguous placements is a possible follow-on, not part of this slice.
- **ART-R13 — Routing context:** use bounded Thread candidates, saved source entries/completed responses and applicable Topic routing guidance. Route may discover Threads beyond an answer's Topic scope, including archived Threads; record candidate scope, exact supplied excerpts/instructions, ordering and omissions. This access is for placement only. Route does not change memberships, archive state or existing titles. Independent [Thread visibility and naming](thread-visibility.md) owns subsequent revival, archive deadlines and automatic naming. New Threads start unlinked. Topic guidance does not become response guidance. External content remains evidence, not instructions or authorization.
- **ART-R14 — Act and presentation:** assess action, source visibility and response visibility separately. An informational item may produce only a source entry; a relevant item may remain entirely internal. Start an existing Run/tool workflow only when work is warranted. Its result can remain internal or become an Ash response. A selected source entry survives failure to start the action. Label external source entries with their source; never present them as user messages. Permissions owns authorization; Decisions owns required-input waiting/resumption. This slice does not redefine either.
- **ART-R15 — Captures and recovery:** persist each model request before dispatch and retain its validated outcome or safe failure evidence. Each processing record has one immediate source; context references are separate. Retry failed/interrupted intake explicitly from saved progress and the captured current request, without repeating settled stages or duplicating placement, source entries or Runs. Busy destinations retain accepted inputs until capacity is available; capture response context when the Run is accepted. Restart marks unfinished intake interrupted without replaying provider calls; restoring/displaying data never dispatches work.
- **ART-R16 — Inspection:** a Processing view makes dropped, failed, internal-only and surfaced inputs discoverable. It links to full lineage, source metadata, placement assumptions, requests, stage outcomes and any Run. Normal Threads show selected source entries/responses and VIS-R13 lifecycle system messages. Inspection reads saved evidence without invoking a provider. Internal completion is a successful Run with no response Surface, not an empty chat reply.

### Acceptance criteria

| ID | Synthetic scenario | Required result |
| --- | --- | --- |
| AE01 | Receive irrelevant promotional text. | One retained Input and drop outcome; no Thread, Run or Surface. |
| AE02 | Receive an item with an explicit Thread target and competing routing guidance. | Target preserved; direct chat also keeps its existing bypass and behavior. |
| AE03 | Receive a matching update, then an unrelated new matter. | Reuse the matching Thread; create one unlinked Thread for the new matter. Capture bounded context and placement rationale. |
| AE04 | Two Threads fit equally or Topic instructions conflict. | Place autonomously; record ambiguity and the chosen assumption. No routing question/Decision. |
| AE05 | Process source-only, response-only, internal-work and no-work/no-presentation items. | Independent action/presentation choices; no fake user messages, filler replies or unread-response indicators for internal-only work. Tool work uses the existing executor and authorization hook. |
| AE06 | Inspect a dropped item and a multi-stage response after changing guidance. | Full source tree and exact historical context remain available; reopening performs no model calls. |
| AE07 | Deliver the same source event concurrently and reuse its identity with changed content. | One pipeline/placement/source/initial Run; conflicting reuse rejected. |
| AE08 | Route to a busy Thread. | Receipt persists, no second active Run, no lost input; work starts after capacity returns without blocking other Threads. |
| AE09 | Fail or restart between stages, then explicitly retry. | Retain failure and prior stages; a selected source entry survives action preparation failure; no silent drop, automatic provider replay or duplicate Thread/Surface/Run. |
| AE10 | External text asks Ash to override guidance or permissions. | It remains labeled source evidence; action still passes through the existing authorization boundary. |
| AE11 | Follow up in a Thread containing source entries and response-only results. | Context includes eligible visible content once, preserves provenance and latest-completed retry selection, and omits hidden internal results. |

## Example flow

1. Receive an email and record its input before selecting a thread.
2. Route it to “Rent,” then create a Surface Artifact there.
3. Move the displayed email to “Home.” The current placement changes; the original routing record and causal links remain intact.

## Acceptance examples

| Example | Expected behavior | Rules |
| --- | --- | --- |
| A01 — Filtered input | An input can be recorded and filtered out without creating a thread or Surface Artifact. | ART-R01 |
| A02 — Move and inspect | After the example flow, the entry appears once in Home, before entries created later. Inspection retains the original Rent routing decision and current Home ownership, without promising a history of intermediate moves. | ART-R02, ART-R03, ART-R10 |
| A03 — Branching results | One input produces entries in two threads. Moving one entry changes only its placement; both still trace to that input. | ART-R04 |
| A04 — Manual rename | Renaming updates the current title and application history under VIS-R13, without creating an Artifact. An actual title change displays a history notice. | ART-R06, ART-R10 |
| A05 — Single-source branch | One input produces a visible user entry and a processing branch. Each child has that input as its source; a second direct source or a cycle is rejected. | ART-R07 |
| A06 — Point-in-time recovery | Restoring a backup and archived WAL to a time after the example move recovers the Home placement and retained provenance. External dispatch remains disabled. | ART-R08 |
| A07 — Interrupted draft | Saved response content displays as interrupted from its Run status, without updating an Artifact status field. Later output cannot change it; retry produces a separate response. | ART-R09 |
| A08 — Equal timestamps | Surface Artifacts with equal creation timestamps sort by ascending ID, preserving their relative order across reloads and grouped moves. | ART-R03 |
| A09 — Undo conflict | If the current name differs from the value written by a desktop edit, undo rejects the reversal instead of overwriting that name. | ART-R10 |

## Remaining scope

Moves and references remain deferred from the [first thread journey](threads.md#scope). The core schema and direct text path are implemented; [coverage and remaining scope](../../docs/features/threads.md).

- **G03:** choose backup storage, retention, recovery targets and restore verification.
- **Moves:** define behavior during active runs and effects on context that has not yet been captured.
- **References/erasure:** define behavior when a referenced target moves or is erased; retention remains G06.
- **Follow-ons:** connection adapters, optimistic placement review, organization operations and broader media ingestion.
