# Path to the first self-modification

Direction accepted, 2026-10-12 · Images, inspectable tools and Topics/context implemented · Later designs proposed

Build toward a small code change completed through Ash: screenshot → discussion → isolated Codex workspace → tests and preview → reviewed application → revert. Start with image understanding and usable chat; add tools and explicit context before delegating code changes.

[Product intent](../../specs/HUMAN_SPEC.md#modifying-ashs-code) · [Open decisions](../../specs/open-questions.md) · [Existing implementation](../features/threads.md)

## First complete demonstration

In an “Ash development” Topic, paste a screenshot and ask Ash to improve a small part of its own interface. Ash reads relevant specifications/source and prior threads in the Topic, then delegates an agreed change to the detached Codex harness. The user can follow progress, stop work, inspect the diff and verification evidence, try an isolated preview, and approve the exact revision to apply. After restarting Ash, the change works and existing threads/images remain. Reverting restores the previous application version without erasing subsequent chat.

Use a UI-only change for this demonstration. Database migrations, dependency upgrades and changes to permissions, credentials or the runner require additional rollout contracts. Custom apps, automatic organization, semantic memory, realtime voice and general computer control are outside this path. Add image generation when a change needs new assets; screenshot understanding is the immediate dependency.

## Delivery sequence

Each slice follows the [delivery agreement](../../specs/product.md#confirmed-engineering-agreement), including app interaction and a separate review pass. Exit demonstrations are acceptance targets; implementation and verification status are recorded per slice.

| Slice | Deliverable | Exit demonstration |
| --- | --- | --- |
| 1. Images and usable chat | Persisted image input, multimodal request capture, thumbnails/full-size view, readable Markdown and code, clear pending/error states. | Paste a screenshot, discuss it over two turns, restart, inspect the exact images sent, and retry from the original snapshot. |
| 2. Inspectable tools | Common execution/inspection for multi-call Runs; general read-only filesystem tools; progress and cancellation. | Ask where a behavior is implemented. Ash reads permitted source and answers with references; inspection explains each call. |
| 3. Topics and working context | Manual Topic membership, global/Topic/Thread instruction editors and retrieval within linked Topics. Topic instructions guide Route; automatic routing and explicit references are deferred. | Continue development in a new thread using retrieved prior findings; inspect the supplied context and factual limit/truncation metadata. |
| 4. Delegated changes | Contained Codex runner, durable workspace records, Decisions, diff/test/preview UI, and controlled apply/revert. | Complete the first demonstration above, including a denied action, restart during work, stale approval rejection and a successful revert. |

The user deferred the Codex integration feasibility check on 2026-10-12. It is not a prerequisite for slice 2 and does not enable delegation or self-modification in that slice.

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

### Proposed parallel work

Start by agreeing on the workspace/job, Decision and candidate-revision contracts. Keep one owner for shared schema/contracts; each track can then use a fake adapter until integration.

| Track | First deliverable | Integration dependency |
| --- | --- | --- |
| Codex runner and isolation | Disposable harness experiment proving progress, Stop, reconnect, authentication and denied access; then a durable workspace/job adapter. | Agreed job lifecycle and permission-request contract. |
| Permissions and Decisions | Backend permission evaluation connected to persisted requests, approve/deny/cancel, restart-safe resumption and exact-action checks. Demonstrate with an Ash-proposed instruction edit. | Shared action/authorization/Decision contract; runner can remain fake. |
| Recording feedback | Import a narrated recording, inspect synchronized commentary and visual evidence, and send it to a Thread. Add in-app capture after proving understanding. | Attachment/context contracts; independent of the Codex runner. |
| Review workspace | Progress, diff, test evidence, preview identity and Decision controls using representative fixtures. | Job/candidate/evidence contracts; wire to the runner afterward. |
| Verification and apply/revert controller | External controller checks the exact revision, retains the previous runnable version, restarts, checks health and reverts while preserving later chat. | Candidate/approval contract; prove initially with hand-prepared UI-only commits. |

The runner experiment is the first uncertainty to resolve. Defer broader tools, automatic organization and memory until the first complete demonstration works. Keep feature work in isolated previews and integrate in dependency order under the [Git requirements](../development.md#git-integration).

### Permissions and Decisions together

Implement these as one end-to-end slice with separate responsibilities: [Permissions](../../specs/features/permissions.md) evaluates authority; Decisions records and presents requests for user input, including requests unrelated to permissions. Reuse the [selected evaluator](../features/permissions.md#selected-evaluator); settle the relevant defaults, conflict and authorization-lifetime questions before wiring execution.

Start with an Ash-proposed instruction edit: prepare the exact diff, evaluate permission, persist a Decision when required, wait through a restart, then recheck authority and the instruction revision before applying once. Exercise denial, cancellation, duplicate answers and changed targets. Explicit authorization must satisfy an ask rule without another question; approving one edit must not create a standing rule. Add the minimal rule editor and independent Decision list needed to operate this flow before expanding to more tools.

### Recording feedback

Workflow priority raised on 2026-10-14; design proposed. Support “record with comments → send to agent” alongside screenshots, without blocking the delegated-change demonstration.

1. **Import and understand:** attach an existing clip with spoken or written commentary; retain playable source video, timestamped transcript/comments and selected frames. Let the agent inspect additional frames in a requested time range when a transition is unclear. Responses should point to timestamps, with missing or ambiguous evidence explicit. Keep user commentary distinct from text observed inside recorded applications.
2. **Capture in Ash:** select a window/screen and optional microphone, record, stop, review and send to the chosen Thread. Reuse the import path. [Electron screen capture](https://www.electronjs.org/docs/latest/api/desktop-capturer) provides the underlying screen/window sources; verify the installed Electron version's OS permission and audio behavior in a small capture experiment first.

Agree on the clip/derivative/context contract and duration, size and processing-cost limits before implementation. Test short UI transitions and “this, here” narration against the original clip; frame sampling alone can miss the event being described. Model/provider selection remains open. Keep autonomous capture, system-audio mixing and live conversation outside the first slice.

### Integration check

Use the detached Codex harness requested in the [source](../../specs/HUMAN_SPEC.md#modifying-ashs-code). Prefer an app-server adapter because this workflow needs streamed progress, interruption and approval requests; the SDK/`codex exec` remains a simpler option for a strictly noninteractive job. [Official app-server guidance](https://learn.chatgpt.com/docs/app-server) · [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).

Before committing to the transport, verify the installed version with a disposable fixture: start a workspace/session, pass a screenshot/context bundle, stream changes and test output, interrupt a child process, handle a denied permission request, and reconnect without starting duplicate work. Establish authentication, model/cost settings, session storage and cleanup explicitly; do not assume Ash's Responses key supplies Codex authentication. Keep a small adapter boundary around the verified protocol.

### Workspace and execution boundary

- Ash supplies intent/context and tracks the delegated job; Codex owns the edit/test loop. Add durable workspace/session records linked to the requesting Run, source revision and candidate revision. Retain diffs, logs, test results and preview references as inspectable outputs.
- Reuse worktree and development-instance provisioning, with separate database/files/client state. A Git worktree is not a security sandbox. Establish a tested OS/container boundary before executing generated code: constrained mounts/network, no live database credentials, developer `.env.local`, home directory or host Docker socket. Broker provisioning and provider authentication outside generated shell commands. The integration check must prove these boundaries, not infer them from working-directory settings.
- Let the worker read/edit/test only its granted workspace. Stop must terminate owned child processes; backend restart reconciles the existing job/session before any continuation. Unknown execution outcomes require inspection, not replay.

### Decisions and review UX

- Introduce a minimal durable Decision entity independent of threads, linked to the Run/workspace. Support pending, approved, denied and cancelled outcomes; show the action, scope and target. Reuse it for Ash-proposed instruction changes.
- Enforce scoped permissions in backend/tool dispatch, outside prompts. Routine edits/tests within a granted workspace proceed without per-file approval; broader access and applying a candidate require the appropriate Decision. Denial/revocation must prevent execution.
- Add waiting as a deliberate Run state with transactional Decision resolution, duplicate-response protection and restart behavior. Waiting still owns the thread's active-work slot. Never resume a stale harness permission request by treating an old approval as fresh authority.
- Provide progress/Stop, diff, test evidence, preview and Decision controls. Bind approval to the exact candidate revision, target revision and action; changes invalidate it. Completion and requests for input get an in-app indicator; a general notification system can follow.

### Apply and revert

Keep application control outside the process being replaced. The controller verifies the approved candidate and target, detects conflicting local changes, records the previous runnable revision, and promotes/restarts only that candidate. Run health checks and the persisted-chat smoke flow; if startup fails, restore the previous runnable version. Never reset user data as part of code rollback.

For the UI-only first change, keep schema/data formats compatible and test both directions against retained data. Broader self-modification requires coordinated database/file backup and restore verification under the [recovery design](../data-model.md#backup-and-recovery); Git rollback cannot undo a migration. Publishing/pushing and unattended promotion are separate capabilities.

Verify workspace containment with attempted denied reads/writes/network access; harness failure and cancellation; duplicate/denied/stale Decisions; restart while waiting; changed target/dirty checkout; candidate failure; and revert after a new chat has been saved. Use a fake harness for routine tests and separate targeted real-harness checks.

## Contract and schema changes

| When | Proposed changes |
| --- | --- |
| Images | Durable asset metadata/reference lifecycle; structured content/request contracts and backward readers. |
| Tools | Typed call/result Artifacts; versioned per-step Run checkpoints; restricted provider continuation storage if required. |
| Context | Scoped instruction selection and captured retrieval metadata; existing ownership tables remain. |
| Delegation | Workspace/session and Decision records; waiting/dispatch constraints; candidate and promotion records. |

These extend the initial six-table scope only as each slice needs them. Keep [Prisma, migrations, DBML and payload documentation synchronized](../architecture.md#schema-workflow). Add product rules to their feature specs when each slice is finalized; this plan owns sequencing and implementation dependencies.
