# Path to the first self-modification

Direction accepted, 2026-10-12 · Images, inspectable tools and Topics/context implemented · Later designs proposed

The [Adapt workflow proposal](adapt-workflow.md) owns the delegated-change workflow: Adapt as a Thread mode, recording handoff, replaceable harness/environment adapters, parallel Workspaces and local/signed application paths. The renderer workflow is implemented; source integration and signed delivery remain proposed.

Build toward a small code change completed through Ash: screenshot → discussion → isolated Codex workspace → tests and preview → reviewed application → revert. Start with image understanding and usable chat; add tools and explicit context before delegating code changes.

[Product intent](../../specs/HUMAN_SPEC.md#modifying-ashs-code) · [Open decisions](../../specs/open-questions.md) · [Existing implementation](../features/threads.md)

## First complete demonstration

In an Adapt Thread, paste a screenshot or narrated recording and ask Ash to improve a small part of its own interface. Ash supplies relevant specifications/source and captured context to the managed Codex harness. The user can follow progress, stop work, inspect the diff and verification evidence, try an isolated preview, and approve the exact revision to apply. After restarting Ash, the change works and existing threads/images remain. Reverting restores the previous application version without erasing subsequent chat.

Use a UI-only change for this demonstration. Database migrations, dependency upgrades and changes to permissions, credentials or the runner require additional rollout contracts. Custom apps, automatic organization, semantic memory, realtime voice and general computer control are outside this path. Add image generation when a change needs new assets; screenshot understanding is the immediate dependency.

## Delivery sequence

Each slice follows the [delivery agreement](../../specs/product.md#confirmed-engineering-agreement), including app interaction and a separate review pass. Exit demonstrations are acceptance targets; implementation and verification status are recorded per slice.

| Slice | Deliverable | Exit demonstration |
| --- | --- | --- |
| 1. Images and usable chat | Persisted image input, multimodal request capture, thumbnails/full-size view, readable Markdown and code, clear pending/error states. | Paste a screenshot, discuss it over two turns, restart, inspect the exact images sent, and retry from the original snapshot. |
| 2. Inspectable tools | Common execution/inspection for multi-call Runs; general read-only filesystem tools; progress and cancellation. | Ask where a behavior is implemented. Ash reads permitted source and answers with references; inspection explains each call. |
| 3. Topics and working context | Manual Topic membership, global/Topic/Thread instruction editors and retrieval within linked Topics. Topic instructions guide Route; automatic routing and explicit references are deferred. | Continue development in a new thread using retrieved prior findings; inspect the supplied context and factual limit/truncation metadata. |
| 4. Delegated changes | Contained Codex runner, durable workspace records, Decisions, diff/test/preview UI, and controlled apply/revert. | Complete the first demonstration above, including a denied action, restart during work, stale approval rejection and a successful revert. |

The Codex feasibility check, initially deferred on 2026-10-12, was completed in the separate `ash_experiments` repository on 2026-10-22. It does not itself implement delegation in Ash; [findings and remaining gates](adapt-workflow.md#execution-boundary-and-lifecycle) guide slice 4.

## 1. Images and usable chat

Accepted and implemented under the [image spec](../../specs/features/images.md). [Implementation and test plan](../features/images.md) covers the Asha adaptations, description model/cost, persistence, context limits, viewer and Markdown. Offline and bounded live verification passed. The subsequent [thread UX alignment](../features/thread-ux.md) extends this slice before tool execution.

## 2. Inspectable tool execution

Behavior is accepted in the [product spec](../../specs/features/tools.md); the approved [engineering/test plan](inspectable-tools-tests.md) tracks verification. [Implementation and configuration](../features/tools.md) · [Asha source review](../features/tool-use-reference.md).

The shared handler contract supports both filesystem tools and retrieval. `ModelAdapter.stream()` yields complete tool proposals and private continuation alongside public text and metadata. The executor persists model rounds, bounded parallel calls and their results; the desktop exposes progress, Stop and inspection. Historical requests retain their readers.

Model adapters, Run/tool schemas, filesystem handlers and inspection belong to this slice. Verification follows the [boundary and real-app scenarios](inspectable-tools-tests.md#automated-scenarios).

The plan owns implementation details, limits and test cases; the product spec owns capability, authorization, freshness and retry behavior.

## 3. Topics, instructions and working context

Reuse the existing Topic, ThreadTopic and Instruction ownership model; no new semantic-memory store is needed.

- Add manual Topic creation/renaming and thread linking/unlinking, plus editors for global, Topic and Thread instructions. User edits update current documents; historical requests retain their snapshots under [INST-R04](../../specs/features/instructions.md#rules).
- Instruction applicability, priority and authority follow [INST-R05–06 and R09](../../specs/features/instructions.md#rules). Show the captured order in inspection.
- Add bounded keyword search/read tools across linked Topics; unrelated threads stay out. Capture the returned excerpts and identities actually sent to the model, including truncation. Defer explicit references, embeddings, automatic summaries and inferred membership.
- Expose a context view with applicable instructions, selected history, tool results and compact limit/truncation metadata. Do not record selection reasoning. Replace the selector's assumption that every Instruction has a global `key` with explicit scope and identity.

Verify zero/multiple Topics, instruction edits between submission and dispatch, removed/deleted Topics, independent ownership, exclusion of routing guidance from responses, context limits and isolation from unrelated threads. A request already captured must not change when memberships or instructions change. Ash-authored instruction edits remain unavailable until the Decision gate below exists.

## 4. Codex workspaces, Decisions and application

Follow the [Adapt delivery sequence](adapt-workflow.md#delivery-sequence). The real Thread → Run → coding harness → native preview → feedback path and protected local UI application are [implemented](../features/adapt.md). Reuse existing Permissions and Decisions. Keep feature work in isolated previews and integrate only under the [Git requirements](../development.md#git-integration).

The [implementation](../features/adapt.md) owns current adapter and execution details; [source integration](adapt-workflow.md#parallel-work-and-integration) remains proposed. Do not duplicate provider-specific session, approval or lifecycle models in the Thread UI.

### Permissions and Decisions together

[Permissions](../../specs/features/permissions.md) and [Decisions](../../specs/features/decisions.md) are separate general features with a shared handoff. Their current-tool integration is implemented; delegated execution consumes the [existing continuation contract](../features/decisions.md#execution-integration) and [selected evaluator](../features/permissions.md#selected-evaluator).

An Ash-proposed instruction edit remains a later demonstration for this self-modification plan. It will consume the general contracts; its authority, review and application workflow are outside the current specification work.

### Recording feedback

Workflow priority raised on 2026-10-14. The [recording feedback spec](../../specs/features/recording-feedback.md) owns behavior, acceptance targets and open decisions; resolve those with the user before implementation. This track does not block the delegated-change demonstration.

Screen recording, video attachments and general video understanding are implemented. [Implementation, Asha adaptations and verification limits](../features/recording-feedback.md). Live Mode integration remains a later design.

### Verification and delivery

The [Adapt verification coverage](../features/adapt.md#verification) records the Run bridge, adapter replacement, native preview containment and trusted apply/recovery checks. Signed builds follow the [distribution plan](adapt-workflow.md#published-and-signed-applications). Broader schema-changing self-modification also requires coordinated database/file backup and restore verification under the [recovery design](../data-model.md#backup-and-recovery); Git rollback cannot undo a migration. Publishing/pushing and unattended promotion are separate capabilities.

## Contract and schema changes

| When | Proposed changes |
| --- | --- |
| Images | Durable asset metadata/reference lifecycle; structured content/request contracts and backward readers. |
| Tools | Typed call/result Artifacts; versioned per-step Run checkpoints; restricted provider continuation storage if required. |
| Context | Scoped instruction selection and captured retrieval metadata; existing ownership tables remain. |
| Delegation | Workspace, harness/environment linkage and captured Thread mode; existing Decision linkage; waiting/dispatch constraints; candidate and promotion records. |

These extend the initial six-table scope only as each slice needs them. Keep [Prisma, migrations, DBML and payload documentation synchronized](../architecture.md#schema-workflow). Add product rules to their feature specs when each slice is finalized; this plan owns sequencing and implementation dependencies.
