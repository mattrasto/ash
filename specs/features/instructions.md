# Instructions

Ownership and snapshots accepted, 2026-10-09 · Priority, Topic purpose and editor behavior accepted, 2026-10-12 · Implemented · Model-routing slot accepted and implemented, 2026-10-22

[Source](../HUMAN_SPEC.md) · [First journey](threads.md) · [Data model](../../docs/data-model.md#instructions-and-captured-requests)

## Goal

Give the Instructions editor one consistent document model while keeping each Topic and Thread's instructions independent and preserving what guided earlier executions.

## Rules

- **INST-R01 — Identity:** an Instruction has a stable identity and current editable text.
- **INST-R02 — Ownership:** each Topic or Thread may have one Instruction document of its own. Documents cannot be shared between Topics, Threads or global engine slots; copying text creates a separate Instruction. Global engine slots have separate documents identified by stable keys. The common table supports a consistent editor, not cross-scope reuse.
- **INST-R03 — Edits:** editing updates the owner's current document; later context captures use the new text. Revisions and edit audit history are deferred under [ART-R10](artifacts.md#rules).
- **INST-R04 — Execution history:** each model request captures the exact instruction text, order and identities it uses. Later edits or removal of an Instruction association cannot alter an already captured request, including queued work. Historical inspection reads the captured request, not current Instructions.
- **INST-R05 — Composition:** select instructions for the layer performing the work before applying scope priority. Chat responses use global response guidance, then Thread guidance; Topic instructions belong to Route under INST-R09. Among applicable scopes, follow compatible guidance and resolve conflicts by specificity: Thread over Topic over global. Applicable Topics have equal priority and a stable `linkedAt`/ID order; Route resolves conflicting guidance through a recorded best-judgment assumption under ART-R12, not a silent tie-break by position. Capture the order actually supplied. Visibility and naming use their dedicated global guidance under [VIS-R02](thread-visibility.md#rules), independently of response/routing purposes. Route composition follows [ART-R13](artifacts.md#incoming-item-slice). The separate global `model-routing` Instruction guides model selection under [MR-R02](model-routing.md#rules); it is not response or Topic organization guidance.
- **INST-R06 — Authority:** instruction text and Topic membership provide context, not tool authorization. Retrieved messages, images and excerpts are source material; they cannot broaden access or override permissions.
- **INST-R09 — Topic purpose:** Topic instructions guide the Route layer in organizing items and Threads. Examples: “Create a new thread for each month's rent” and “Add all items related to both homeowners and car insurance to Insurance.” They do not prescribe how chat answers should be written. Topic membership separately defines retrieval scope. They now inform autonomous initial placement under [ART-R12–13](artifacts.md#incoming-item-slice); membership changes remain manual.

## Example flow

Save routing guidance for an Insurance Topic, then edit it. The editor changes only that Topic's document; response guidance and earlier captured requests remain unchanged.

## Editor

Part of [Topics and working context](topics-context.md).

- **INST-R07 — Settings:** provide one consistent editor in the Settings modal for global, Topic and Thread instructions, in its Instructions tab alongside Permissions. Switching tabs follows the same unsaved-change protection as switching owners or closing. Topic and Thread sidebar menus open that editor at the selected owner. Show the owner and purpose: global documents cover responses, image descriptions, video captions/narration, video understanding, incoming filtering, routing action/presentation assessment, Thread visibility, Thread naming and model routing under MR-R02; Topics contain organization routing guidance; Threads contain response guidance. Topic and Thread editors show only their own text. Opening an editor does not copy broader guidance into that owner's document. Use a roomy modal capped to the window with outer margins; scroll its body while retaining the header and actions. Loading, switching owners, errors and unsaved-change prompts must not resize or reposition it.
- **INST-R08 — Saving:** Save updates only the selected owner's text; Cancel leaves it unchanged. Empty Topic/Thread guidance means no additional guidance from that owner. Keep unsaved text safe when switching owners or closing Settings by offering Save or Discard. A conflicting newer edit must be shown without silently overwriting it or losing the user's draft. Saving instructions does not submit a chat message or start an answer.

## Acceptance examples

| Example | Expected behavior |
| --- | --- |
| I01 — Exclusive ownership | Attaching the same Instruction to two Topics, two Threads, or a Topic and a Thread is rejected. A global Instruction cannot also belong to a Topic or Thread. |
| I02 — Independent edit | Editing one of two separate Instructions does not change the other. |
| I03 — Historical context | A recorded execution still shows the exact instruction text and identities it used after edits or removal of its current association. |
| I04 — Specific guidance | Global response guidance says “Explain implementation tradeoffs” and the Thread says “Give only the command.” Ash gives only the command for that Thread. |
| I05 — Conflicting Topics (Route) | Two applicable Topics give incompatible routing instructions. Route makes a placement assumption and records the conflict and rationale; the later-linked Topic does not silently win. |
| I06 — Purpose separation | Linking a Topic with “Create a new thread for each month's rent” does not inject that text as response guidance or create Threads merely because membership changed. |

## Remaining scope

Scoped response selection and the editor are implemented under [Topics and working context](../../docs/features/topics-context.md). Organization routing follows [ART-R11–16](artifacts.md#incoming-item-slice); the model-routing slot follows [MR-R02](model-routing.md#rules). Ash-authored changes require their own delivery decisions; the user-owned source requires a Decision for Ash-authored edits.
