# Path to the first self-modification

Direction accepted, 2026-10-12 · Sequence and designs proposed · Implementation not started

Build toward a small code change completed through Ash: screenshot → discussion → isolated Codex workspace → tests and preview → reviewed application → revert. Start with image understanding and usable chat; add tools and explicit context before delegating code changes.

[Product intent](../../specs/HUMAN_SPEC.md#modifying-ashs-code) · [Open decisions](../../specs/open-questions.md) · [Existing implementation](../features/conversations.md)

## First complete demonstration

In an “Ash development” Topic, paste a screenshot and ask Ash to improve a small part of its own interface. Ash reads relevant specifications/source, uses the Topic's guidance, and delegates an agreed change to the detached Codex harness. The user can follow progress, stop work, inspect the diff and verification evidence, try an isolated preview, and approve the exact revision to apply. After restarting Ash, the change works and existing conversations/images remain. Reverting restores the previous application version without erasing subsequent chat.

Use a UI-only change for this demonstration. Database migrations, dependency upgrades and changes to permissions, credentials or the runner require additional rollout contracts. Custom apps, automatic organization, semantic memory, voice and general computer control are outside this path. Add image generation when a change needs new assets; screenshot understanding is the immediate dependency.

## Delivery sequence

Each slice follows the [delivery agreement](../../specs/product.md#confirmed-engineering-agreement), including app interaction and a separate review pass. These are proposed acceptance targets, not verification results.

| Slice | Deliverable | Exit demonstration |
| --- | --- | --- |
| 1. Images and usable chat | Persisted image input, multimodal request capture, thumbnails/full-size view, readable Markdown and code, clear pending/error states. | Paste a screenshot, discuss it over two turns, restart, inspect the exact images sent, and retry from the original snapshot. |
| 2. Inspectable tools | Multiple model calls within a Run; typed tool calls/results; narrow repository read/search tools; progress and cancellation. | Ask where a behavior is implemented. Ash reads the configured repository snapshot and answers with source references; inspection explains each call. |
| 3. Topics and working context | Manual Topic membership, global/Topic/Thread instruction editors, explicit references and retrieval within linked Topics. | Continue development in a new thread using selected prior findings and Topic guidance; inspect what entered context and what was omitted. |
| 4. Delegated changes | Contained Codex runner, durable workspace records, Decisions, diff/test/preview UI, and controlled apply/revert. | Complete the first demonstration above, including a denied action, restart during work, stale approval rejection and a successful revert. |

Do a small Codex integration feasibility check before expanding slice 2, so tool/Run contracts can represent its events and permission requests. This check does not enable self-modification or change the user's running instance.

## 1. Images and usable chat — implement next

### Product scope

- Paste, drop or choose PNG/JPEG/WebP images; text may accompany them. Preview/remove attachments before sending. Show upload failure without losing the draft; do not submit a message referencing an incomplete upload.
- Preserve image order, display sent images and provide a full-size viewer. Follow-up questions can reuse selected historical images. Explain when older images leave context.
- Render Markdown and code blocks with copy controls. Disable raw HTML and automatic remote image loading; message content must not execute code or gain desktop privileges.
- Keep streaming, Stop, retry and Artifact inspection usable with long replies and attachments. Preserve scroll position when reading earlier content. Broader visual redesign remains separate.

### Implementation

1. Extend the conversation spec with stable image acceptance IDs. Define message/image/request contracts in `packages/shared/src/contracts/conversations.ts`; preserve readers for saved text-only Artifacts and checkpoints.
2. Add an attachment module and durable asset metadata: ID, instance ownership, media type, byte/pixel dimensions, content hash, storage key and lifecycle state. Store immutable bytes under the owning instance's file storage. Link every retained Input, Surface and request reference to the asset lifecycle; a JSON reference alone is insufficient for safe cleanup.
3. Upload to staging, validate/decode with bounded resources, then atomically publish bytes before accepting references. Handle crashes between filesystem and database steps with reconciliation. Resolve storage keys only on the backend; reject cross-instance references, traversal and symlink escapes.
4. Freeze the exact provider image bytes, order and detail setting with each model request. If resizing or metadata removal is used, retain that immutable derivative and its transformation metadata. Retrying must not reprocess the current original or reread an arbitrary local path. Missing bytes produce an explicit error before dispatch.
5. Expand context selection and the OpenAI adapter to structured content. Keep the current text budget and add explicit image-count, byte and pixel bounds; image input has its own token cost. Send backend-owned bytes as data URLs with `store:false`, avoiding remote URL fetching and a separate provider file lifecycle. [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision).
6. Show images and attachment metadata in the inspector without dumping base64 into UI or logs. Extend the deterministic adapter and mocked transport to cover image requests without paid calls.

Proposed initial limits: four images per message, 10 MiB per file, 20 MiB per message and 20 megapixels per image; reject unsupported/animated formats and preserve the draft. Validate these against realistic screenshots and the configured model before finalizing the spec. Bound decoded memory and whole-request history separately from upload size.

Retention proposal for this slice: unsubmitted uploads expire after 24 hours; accepted assets remain while any retained Artifact/request references them. A draft whose upload expired must show that state before sending. Instance disposal removes its assets. User erasure and backup expiration remain [G06](../../specs/open-questions.md#g06--deletion-and-retention); use synthetic images until that policy is settled. Recovery must restore referenced files alongside the database.

### Verification

| Case | Required evidence |
| --- | --- |
| Main flow | Real Electron paste/drop/select, image-only and text-plus-image submission, follow-up, full-size view, restart and inspection. |
| Frozen input | Captured provider body uses the expected hashes/order/detail; retry remains identical after local source changes. |
| Context bounds | Old images are omitted visibly; the current submission never silently loses an image; text-only selection still works. |
| Delivery and interruption | Duplicate submit creates one Input/Run; upload failure preserves the draft; cancellation/restart preserves accepted assets and partial output. |
| Storage boundaries | Invalid media, oversized decoded images, traversal, symlinks, foreign-instance IDs and missing/corrupt bytes fail safely. Staged/orphan cleanup cannot delete referenced assets. |
| Renderer | HTML/script and remote-image fixtures cannot execute or fetch implicitly; code copying and scroll behavior work during streaming. |
| Upgrade | Existing text conversations, frozen retries and inspection survive the contract/schema migration. |

Finish with one targeted live image/follow-up check on the configured interactive model. Use the existing [offline/live test split](persisted-chat-tests.md#openai-adapter); record live cases left incomplete without stopping independent verification.

## 2. Inspectable tool execution

The current `ModelAdapter.stream()` yields text and terminal metadata, while Run state references one request/response pair. Extend these contracts before adding a tool button or exposing execution.

- Introduce typed model events for text, complete tool calls and outcomes. Capture each model request, returned call ID/validated arguments, tool result and subsequent model request. Preserve the [single-source Artifact rule](../../specs/features/artifacts.md#rules); context references do not become causal parents. Show a compact tool timeline and one final answer.
- Add an explicit per-step Run checkpoint with durable dispatch/result identity. Serialize tools initially. Validate tool names and arguments outside the model; never execute a partial streamed call. Bound result size, execution time and per-Run steps, and detect repeated failures. Stopping a loop reports the reason and preserves progress; it does not expire ordinary interactive chat.
- Keep `store:false`. A Responses tool continuation needs the returned call items and any required reasoning items, not just flattened text. Verify the pinned SDK's stateless continuation shape; keep required encrypted continuation material opaque, restricted and separate from public inspection. Do not claim access to private reasoning. [Function calling](https://developers.openai.com/api/docs/guides/function-calling) · [Encrypted continuation](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items).
- Start with `repository.list`, `repository.read` and `repository.search` over an explicitly configured source snapshot. Record its revision/content hashes and cite file/line ranges. Restrict readable paths; exclude credentials, local data, Git internals and symlinks outside the root. Tool results are source material, never permission to broaden access.
- Preserve one active workflow per thread. A crash or ambiguous dispatch marks work interrupted; reconnect reads saved state. Read-only retries may use the frozen source snapshot. Do not extend text retry into automatic replay of future writes.

Verify a two-tool answer, invalid/unknown calls, oversized/error results, path escape attempts, cancellation between steps, duplicate delivery, step-limit exhaustion and restart before/after result persistence. Mock Responses continuation at the HTTP boundary, including non-text output items. The source tools should not require a shell or a general MCP/plugin framework.

## 3. Topics, instructions and working context

Reuse the existing Topic, ThreadTopic and Instruction ownership model; no new semantic-memory store is needed.

- Add manual Topic creation/renaming and thread linking/unlinking, plus editors for global, Topic and Thread instructions. User edits update current documents; historical requests retain their snapshots under [INST-R04](../../specs/features/instructions.md#rules).
- Proposed composition: global instructions, linked Topic instructions in stable `linkedAt`/ID order, then Thread instructions. Show this order. Thread guidance can refine broader guidance; conflicting Topic guidance needs clarification rather than a hidden priority. Editable instructions cannot grant tool permissions. Finalize this proposal under [G05](../../specs/open-questions.md#g05--context-selection) before implementation.
- Let the user explicitly reference prior messages/images. Add bounded keyword search/read tools across linked Topics; unrelated threads stay out unless deliberately selected. Capture the returned excerpts and identities actually sent to the model, including truncation. Defer embeddings, automatic summaries and inferred membership.
- Expose a context view with instructions, selected history, references, tool results and omissions. Replace the selector's assumption that every Instruction has a global `key` with explicit scope and identity.

Verify zero/multiple Topics, instruction edits between submission and dispatch, removed/deleted Topics, independent ownership, conflicting guidance, context-budget omissions and isolation from unrelated threads. A request already captured must not change when memberships or instructions change. Ash-authored instruction edits remain unavailable until the Decision gate below exists.

## 4. Codex workspaces, Decisions and application

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
