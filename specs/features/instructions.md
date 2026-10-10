# Instructions

Scope-specific ownership, current text and execution snapshots accepted, 2026-10-09 · Unimplemented

[Source](../HUMAN_SPEC.md) · [First journey](conversations.md) · [Data model](../../docs/data-model.md#instructions-and-captured-requests)

## Goal

Give the Instructions editor one consistent document model while keeping each Topic and Thread's instructions independent and preserving what guided earlier executions.

## Rules

- **INST-R01 — Identity:** an Instruction has a stable identity and current editable text.
- **INST-R02 — Ownership:** each Topic or Thread may have one Instruction document of its own. Documents cannot be shared between Topics, Threads or global engine slots; copying text creates a separate Instruction. Global engine slots have separate documents identified by stable keys. The common table supports a consistent editor, not cross-scope reuse.
- **INST-R03 — Edits:** editing updates the owner's current document; later context captures use the new text. Revisions and edit audit history are deferred under [ART-R10](artifacts.md#rules).
- **INST-R04 — Execution history:** each model request captures the exact instruction text, order and identities it uses. Later edits or removal of an Instruction association cannot alter an already captured request, including queued work. Historical inspection reads the captured request, not current Instructions.

## Example flow

Create instructions for a Topic, then edit their text. A subsequent request that selects that Topic's instructions uses the new text; another Topic's document and an earlier captured request remain unchanged.

## Acceptance examples

| Example | Expected behavior |
| --- | --- |
| I01 — Exclusive ownership | Attaching the same Instruction to two Topics, two Threads, or a Topic and a Thread is rejected. A global Instruction cannot also belong to a Topic or Thread. |
| I02 — Independent edit | Editing one of two separate Instructions does not change the other. |
| I03 — Historical context | A recorded execution still shows the exact instruction text and identities it used after edits or removal of its current association. |

## Remaining scope

The first conversation journey exposes the base instructions only. G05 still governs selection, ordering and conflict handling across global/topic/thread scopes. Routing behavior and Ash-authored changes require their own delivery decisions; the user-owned source requires a Decision for Ash-authored edits.
