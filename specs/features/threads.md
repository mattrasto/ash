# Threads

First-phase scope accepted · Chat, images and thread UX implemented and verified

[Source](../HUMAN_SPEC.md) · [Product principles](../product.md) · [Architecture](../../docs/architecture.md)

## Goal

The user can work with Ash in a Thread, organize it explicitly, see what informed a response, and recover the same recorded Thread after reconnecting or restarting.

## Source requirements

Confirmed in [HUMAN_SPEC.md](../HUMAN_SPEC.md): threads can have zero or more topics; user input targeted to a thread stays there; input and visible presentation have distinct artifact roles; Ash acts within a Run; results trace back to input. Instructions must be visible and editable by the user.

The accepted [artifact rules](artifacts.md#rules) refine membership and chains, replace application replay with PITR recovery and defer application audit history. [Instruction rules](instructions.md#rules) define independently owned documents and captured execution context.

## Scope

Current delivery: Threads with [image input and descriptions](images.md), OpenAI previews and an offline test adapter, one-click creation, first-message titles, manual rename/archive, persisted messages and Run outcomes, cancellation/retry, reconnect/restart handling, and context/lineage inspection. Applicable instructions are captured with each request. [Topics and working context](topics-context.md) add sidebar organization, owned instruction editing and bounded retrieval across linked Threads.

Deferred from the broader design below: pin controls and PITR operation/restore verification. Requirement and acceptance IDs remain stable for those later deliveries. [Implementation](../../docs/features/threads.md) · [Test plan](../../docs/plans/persisted-chat-tests.md).

Deferred: voice and Live Threads, model-generated naming, automatic organization/archiving, artifact moves and references, split/merge, semantic memory, other file attachments, external integrations (synthetic incoming text follows [ART-R11–16](artifacts.md#incoming-item-slice)), task execution, mobile and self-modification. OpenAI is the first live provider; [live verification](../../docs/features/threads.md#verification) records the tested model and allowance. [Image rules and acceptance](images.md) and [tool execution and inspection](tools.md) extend this scope.

## User flow

1. Open Ash and create a “Home” topic and “Repair checklist” thread. The user can also start without a topic.
2. Send a text request: “Help me organize a repair checklist for the apartment.” The message appears once, with a visible response status.
3. Read Ash's response and send a follow-up: “Put the kitchen items first.” The follow-up uses the preceding thread.
4. Explicitly add the thread to a second topic or remove a topic association. The thread remains the same continuing matter.
5. Inspect a response to see its originating input, run outcome and supplied context. Internal processing records do not clutter the ordinary thread.
6. Close/reopen or reconnect the client. The saved thread, organization and settled run outcomes remain available.

## Requirements

- **CONV-R01 — Interface:** normal threads in the existing desktop client, with text and image input under [IMG-R01–09](images.md#rules). Hosting and further native requirements remain G02.
- **CONV-R02 — Manual organization:** the user can create/rename topics and threads and explicitly link/unlink topics; starting a thread without a topic is allowed.
- **CONV-R03 — Topic context boundary:** cross-thread retrieval follows [CTX-R03–07](topics-context.md#what-enters-an-answer).
- **CONV-R04 — Instruction edits:** the user can view/edit independently owned instructions under [INST-R03–04](instructions.md#rules) through the [shared editor](instructions.md#editor). Ash does not edit instructions in this milestone.
- **CONV-R05 — Context:** include applicable response instructions under [INST-R05](instructions.md#rules) and the current Thread's Surface messages up to the submitted user message, subject to CONV-R15 and context limits. Include the user message once; its Input and internal Act records are not additional thread messages. The inspector identifies limits and omissions.
- **CONV-R06 — Accepted input:** durably record input before its response run starts. Retrying transport delivery of the same submission does not create a second message or run.
- **CONV-R07 — Concurrent input:** execute one response run at a time per thread. While it runs, block further submissions there and preserve typed draft text. Different threads may work independently. The accepted Decision extension in [DEC-R05](decisions.md#rules) excludes work waiting on user input from this Thread-wide block; current-tool integration is implemented.
- **CONV-R08 — Outcomes:** distinguish running, completed, failed, cancelled and interrupted outcomes. The displayed response derives its generation state from its Run under [ART-R09](artifacts.md#rules); stopped output must not appear to be a successful final answer.
- **CONV-R09 — Recovery:** a client disconnect does not itself cancel a backend run. Reconnecting restores recorded output/status without creating a new run. Restarting preserves completed threads and topic associations.
- **CONV-R10 — Retry:** provider failure or server interruption is visible. User-requested retry creates a new Run linked to the previous Run and original input, preserving prior outcomes and partial responses.
- **CONV-R11 — Cancellation:** prevent later output from being presented as a successful completion for the cancelled Run. Cancellation cannot guarantee reversal of provider work already started.
- **CONV-R12 — Inspection:** show the originating input, supplied context, exact instruction text and identities, model identifier, run outcome and recorded processing metadata. Do not promise private model reasoning or retain credentials in thread history.
- **CONV-R13 — Backup recovery:** restore thread data under [ART-R08](artifacts.md#rules). Restore verification must cover organization, Surface content/order, current instructions, captured requests and run outcomes at the chosen time. Do not automatically resume restored work.
- **CONV-R14 — Manual visibility:** archive hides a Thread from the ordinary view while retaining archive access, content and context eligibility. Unarchive restores ordinary visibility. Pin/unpin is independent of archive state; pinning does not unarchive a Thread. Both states persist across client restarts. Automatic archive deadlines, revival and pin ordering remain deferred.
- **CONV-R15 — Retry context:** later follow-ups include only the latest completed response for each Input. Failed, cancelled, interrupted, partial and superseded attempts remain visible but are omitted from model context. A failed retry does not displace an earlier completed response. If no response completed, include the user message without an answer. Existing captured requests remain unchanged.

- **CONV-R16 — Live provider:** Human previews use OpenAI by default and retain their selected model/session on restart. Missing credentials fail with setup guidance; they never silently select fake responses. The deterministic adapter is reserved for automated tests or an explicit offline demo. Interactive chat has no session call cap or expiry; disposable live tests use explicit call/time limits. Default verification makes no external calls. Record provider identifiers and reported usage when available; missing usage is unknown. Incomplete provider output is a failed Run, not a completed reply. OpenAI retries preserve the captured provider/model/options and do not execute automatically.

## Thread UX

Accepted 2026-10-12 · Align interactions with Asha; retain Ash's appearance and Artifact model.

- **UX01 — Start and name:** open an empty thread immediately on first use. **New thread** creates and focuses another composer without requiring a title. The first accepted message names an untitled thread from its text; image-only input uses “Image thread.” Manual rename persists. Model-based naming belongs with the future visibility layer.
- **UX02 — Sidebar:** show recent activity, running responses and unseen settled responses. Archive/unarchive uses the row icon; the actions menu contains Rename. Archive access is a collapsible list; archiving the current thread selects another active thread or creates an empty one. Archived threads remain readable and writable; writing does not unarchive them. Collapse, width, archive expansion and read markers are local desktop preferences. Archive persistence follows CONV-R14; pin controls remain deferred.
- **UX03 — Compose and read:** Enter sends, Shift+Enter inserts a line, and IME composition never submits. Input grows for typed, restored and generated text up to the smaller of 240px or 30% of the window height, then scrolls internally. It shrinks when text is removed, adapts to width changes and returns focus after sending. Preserve over-limit generated text for editing and explain the 4000-character submission limit before Send. Preserve drafts and reading position across thread switches. Sending anchors the latest user message with room for its response; new output must not pull a reader through the reply. **Latest messages** resumes following with breathing room below the last message. Concurrent input follows CONV-R07.
- **UX04 — Stream and act:** progressively reveal new prose and code lines while preserving settled Markdown nodes. Returning to a running thread shows its recorded content immediately. Completion does not replace the message or replay its reveal. Copy, Inspect and Retry are available on hover, keyboard focus and a context menu; stopped/failed outcomes stay visible. Message copy exports text; image-containing messages label it “Copy text.” Copy images individually in the viewer or thumbnail menu; copying text and multiple images together is deferred. Compact response details expand to recorded timing, model and usage when available. Full inspection follows CONV-R12.
- **UX05 — Accessibility:** icon actions have labels and tooltips; menus support arrows, Escape and focus restoration. Escape closes inspection and the image viewer. Sidebar resizing supports arrows and Home. Respect reduced-motion preferences for message, stream, sidebar and viewer animations. Desktop shortcuts: Cmd/Ctrl+N creates a thread; Cmd/Ctrl+\ toggles the sidebar.

[Reference review, implementation and verification plan](../../docs/features/thread-ux.md).

## Acceptance examples

### C01 — Untagged thread · CONV-R02, CONV-R06

When the user starts a thread without selecting a topic and submits one request, one visible user entry and one response run exist; no topic is inferred.

### C02 — Topic membership · CONV-R02

Given a thread in Home, when the user links it to Planning and unlinks Home, the current memberships change while the same thread and messages remain. Removing membership does not delete content or require a persistent change log.

### C03 — Follow-up context · CONV-R03, CONV-R05

Given a Thread with no Topics and a completed response, when the user asks a follow-up about it, supplied context includes the preceding Thread and follow-up. A separate Thread's content is absent.

### C04 — Response inspection · CONV-R12

When inspecting a displayed reply, its originating input, run status, recorded output, model identifier and actual instruction/context selection are discoverable.

### C05 — Duplicate delivery · CONV-R06

When transport resends an accepted submission after connection loss, no duplicate user entry or extra response run is created. A separate deliberate submission remains a separate input.

### C06 — Client reconnect · CONV-R09

When the user closes the client during backend generation and reconnects, recorded work is recovered and its final status is accurate. Reconnect does not invoke the model again.

### C07 — Failed or stopped work · CONV-R08, CONV-R10, CONV-R11

When a model request fails, the user cancels or the server stops during generation, show the Run's outcome and retain saved content. If no response exists yet, show the outcome beside the originating user message. Cancellation while queued leaves `started_at` null. Explicit retry creates a linked Run and separate response without duplicating the user entry.

### C08 — Input during a run · CONV-R07

Given a running response, when the user attempts a second submission in the same thread, that submission is blocked and its draft preserved. Another thread remains usable.

### C09 — Instruction edit · CONV-R04

When the user edits instructions between two completed requests, each response shows the exact instruction text captured for it. The earlier request remains unchanged. An edit after submission also cannot change queued work's captured instructions.

### C10 — Point-in-time restore · CONV-R13

Given a base backup and continuous archived WAL, restore to a chosen time in an isolated PostgreSQL instance. Names, memberships, archive/pin states, Surface content/order, owned instructions, captured requests and run checkpoints/outcomes match that time; later changes are absent. Model/tool call count is zero. Before enabling the application, startup recovery marks restored unfinished work interrupted without dispatching it.

### C11 — Restart · CONV-R09

When restarting after a completed exchange, the same recorded thread and topic associations remain available.

### C12 — Context limit · CONV-R05, CONV-R12

When thread history exceeds the configured context limit, the response inspector identifies omitted content and the context actually used.

### C13 — Archive and pin · CONV-R14

Pin and archive a Thread, then restart the client. It remains pinned and accessible in the archive, with its content retained and absent from the ordinary view. Unarchiving restores it without clearing its pin; unpinning does not change archive state.

### C14 — Context after retries · CONV-R05, CONV-R15

Given an Input with a failed partial response and two completed responses, a follow-up includes the user message once and only the most recently completed response. The inspector identifies the excluded attempts. A later failed retry leaves that selected answer unchanged; an Input with no completed response contributes no answer. All attempts remain visible in the Thread.

## Open questions

[G02–G07 and G09](../open-questions.md). Is this text-first journey useful enough before voice and external inputs?
