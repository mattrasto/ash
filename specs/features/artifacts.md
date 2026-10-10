# Artifact ownership and history

Rules accepted by the user, 2026-10-09 · Unimplemented

[Source](../HUMAN_SPEC.md) · [Data model](../../docs/data-model.md)

## Goal

Process inputs before their destination is known and reorganize visible conversations while preserving their recorded origin and processing.

## Rules

- **ART-R01 — Surface ownership:** every Surface Artifact has exactly one current thread. Other artifacts do not require thread ownership, including Route and Act artifacts. This clarifies the source spec's statement that every artifact belongs to a thread.
- **ART-R02 — Thread associations:** an input's source thread, a routing destination and a run's execution target describe processing. These associations are distinct from current Surface ownership and retain their recorded meaning after a move.
- **ART-R03 — Moves and order:** Surface Artifacts display in ascending `(created_at, id)` order within their current thread. Moves change the current thread. Identity, creation time, content, source links and original processing provenance remain unchanged; intermediate move history is deferred under ART-R10.
- **ART-R04 — Groups and chains:** a move operates on explicitly selected Surface Artifacts, individually or together. An Artifact Chain has no single thread owner: its branches may surface in different threads. Moving selected entries preserves their causal links and does not move other branches or future results automatically.
- **ART-R05 — Active work:** moving a Surface Artifact must not implicitly retarget an active run. Whether to allow, block or explicitly coordinate such moves remains open.
- **ART-R06 — Engine records:** Artifacts represent inputs and records produced by the Input, Filter, Route, Act and Surface layers. Application changes, including thread creation/renaming and membership changes, update current rows. An action by Ash may produce an Act Artifact; a manual UI change does not require one.
- **ART-R07 — Single source:** Input Artifacts are roots. Each subsequent Artifact has one immediate source; a source can produce many children. Cycles are prohibited, so chains form branching trees. Multiple-parent merging is deferred until a concrete workflow requires it. Context references do not become source relationships automatically.
- **ART-R08 — Recovery:** current database rows are authoritative. Recovery uses PostgreSQL physical base backups and archived WAL for point-in-time recovery (PITR); application-event reconstruction is not required. Artifacts retain recorded engine activity for inspection. This replaces the source spec's Replayable State requirement. Restoring data must not execute models, tools or external effects; operational requirements are in [backup and recovery](../../docs/data-model.md#backup-and-recovery).
- **ART-R09 — Streaming drafts:** the current response Surface's payload content may grow while its Run is running; a terminal Run outcome freezes that content. In the initial one-response-per-Run flow, display state comes from that Run: running means generating, completed means finished, and failed/cancelled/interrupted means stopped. There is no independent Artifact completeness field. Identity, source links, captured requests and original provenance remain immutable. Individual streaming chunks do not require history records.
- **ART-R10 — Application history and undo:** audit history is deferred, including past names, memberships, moves and instruction edits. Desktop session state may support undo of manual edits by issuing reversing backend changes that reject conflicts with newer edits. This does not promise undo across restarts or devices. Captured model requests retain the instruction text actually used; PITR is recovery, not a searchable change history.

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
| A04 — Manual rename | Renaming a thread in the UI updates its title without creating an engine Artifact or persistent audit entry. | ART-R06, ART-R10 |
| A05 — Single-source branch | One input produces a visible user entry and a processing branch. Each child has that input as its source; a second direct source or a cycle is rejected. | ART-R07 |
| A06 — Point-in-time recovery | Restoring a backup and archived WAL to a time after the example move recovers the Home placement and retained provenance. External dispatch remains disabled. | ART-R08 |
| A07 — Interrupted draft | Saved response content displays as interrupted from its Run status, without updating an Artifact status field. Later output cannot change it; retry produces a separate response. | ART-R09 |
| A08 — Equal timestamps | Surface Artifacts with equal creation timestamps sort by ascending ID, preserving their relative order across reloads and grouped moves. | ART-R03 |
| A09 — Undo conflict | If the current name differs from the value written by a desktop edit, undo rejects the reversal instead of overwriting that name. | ART-R10 |

## Remaining scope

Moves and references remain deferred from the [first conversation journey](conversations.md#scope). The six-table model is accepted; physical details remain proposed until implemented and verified.

- **G03:** choose backup storage, retention, recovery targets and restore verification.
- **Moves:** define behavior during active runs and effects on context that has not yet been captured.
- **References/erasure:** define behavior when a referenced target moves or is erased; retention remains G06.
- **TODO:** specify the remaining Artifact Engine stages and inspection behavior.
