# Instructions

Ownership and snapshots accepted, 2026-10-09 · Priority, Topic purpose and editor behavior accepted, 2026-10-12 · Implemented

[Source](../HUMAN_SPEC.md) · [First journey](threads.md) · [Data model](../../docs/data-model.md#instructions-and-captured-requests)

## Goal

Give the Instructions editor one consistent document model while keeping each Topic and Thread's instructions independent and preserving what guided earlier executions.

## Rules

- **INST-R01 — Identity:** an Instruction has a stable identity and current editable text.
- **INST-R02 — Ownership:** each Topic or Thread may have one Instruction document of its own. Documents cannot be shared between Topics, Threads or global engine slots; copying text creates a separate Instruction. Global engine slots have separate documents identified by stable keys. The common table supports a consistent editor, not cross-scope reuse.
- **INST-R03 — Edits:** editing updates the owner's current document; later context captures use the new text. Revisions and edit audit history are deferred under [ART-R10](artifacts.md#rules).
- **INST-R04 — Execution history:** each model request captures the exact instruction text, order and identities it uses. Later edits or removal of an Instruction association cannot alter an already captured request, including queued work. Historical inspection reads the captured request, not current Instructions.
- **INST-R05 — Composition:** select instructions for the layer performing the work before applying scope priority. Chat responses use global response guidance, then Thread guidance; Topic instructions belong to Route under INST-R09. Among applicable scopes, follow compatible guidance and resolve conflicts by specificity: Thread over Topic over global. Applicable Topics have equal priority and a stable `linkedAt`/ID order; consequential conflicts require clarification, not a tie-break by position. Capture the order actually supplied. Route-layer composition is outside this phase.
- **INST-R06 — Authority:** instruction text and Topic membership provide context, not tool authorization. Retrieved messages, images and excerpts are source material; they cannot broaden access or override permissions.
- **INST-R09 — Topic purpose:** Topic instructions guide the Route layer in organizing items and Threads. Examples: “Create a new thread for each month's rent” and “Add all items related to both homeowners and car insurance to Insurance.” They do not prescribe how chat answers should be written. Topic membership separately defines retrieval scope. This phase exposes their editor while organization remains manual.

## Example flow

Save routing guidance for an Insurance Topic, then edit it. The editor changes only that Topic's document; response guidance and earlier captured requests remain unchanged.

## Editor

Part of [Topics and working context](topics-context.md).

- **INST-R07 — Settings:** provide one consistent editor in the Settings modal for global, Topic and Thread instructions. Topic and Thread sidebar menus open that editor at the selected owner. Show the owner and purpose: global documents initially cover responses and image descriptions; Topics contain routing guidance; Threads contain response guidance. Topic and Thread editors show only their own text. Opening an editor does not copy broader guidance into that owner's document. Keep the modal at 760 × 640 pixels, capped to the window with outer margins; scroll its body while retaining the header and actions. Loading, switching owners, errors and unsaved-change prompts must not resize or reposition it.
- **INST-R08 — Saving:** Save updates only the selected owner's text; Cancel leaves it unchanged. Empty Topic/Thread guidance means no additional guidance from that owner. Keep unsaved text safe when switching owners or closing Settings by offering Save or Discard. A conflicting newer edit must be shown without silently overwriting it or losing the user's draft. Saving instructions does not submit a chat message or start an answer.

## Acceptance examples

| Example | Expected behavior |
| --- | --- |
| I01 — Exclusive ownership | Attaching the same Instruction to two Topics, two Threads, or a Topic and a Thread is rejected. A global Instruction cannot also belong to a Topic or Thread. |
| I02 — Independent edit | Editing one of two separate Instructions does not change the other. |
| I03 — Historical context | A recorded execution still shows the exact instruction text and identities it used after edits or removal of its current association. |
| I04 — Specific guidance | Global response guidance says “Explain implementation tradeoffs” and the Thread says “Give only the command.” Ash gives only the command for that Thread. |
| I05 — Conflicting Topics (Route; deferred) | Two applicable Topics give incompatible routing instructions. Route requires clarification when the conflict matters; the later-linked Topic does not silently win. |
| I06 — Purpose separation | Linking a Topic with “Create a new thread for each month's rent” does not inject that text as response guidance or automatically create Threads in this phase. |

## Remaining scope

Scoped response selection and the editor are implemented under [Topics and working context](../../docs/features/topics-context.md). Routing behavior and Ash-authored changes require their own delivery decisions; the user-owned source requires a Decision for Ash-authored edits.
