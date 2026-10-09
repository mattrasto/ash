# Conversations

Proposed first milestone · Unimplemented

[Source](../HUMAN_SPEC.md) · [Product principles](../product.md) · [Architecture](../../docs/architecture.md)

## Goal

The user can have a useful text conversation with Ash, organize it explicitly, see what informed a response, and recover the same recorded conversation after reconnecting or restarting.

## Source requirements

Confirmed in [HUMAN_SPEC.md](../HUMAN_SPEC.md): threads can have zero or more topics; user input targeted to a thread stays there; input and visible presentation have distinct artifact roles; Ash acts within a Run; results trace back to input; organization changes append history; reconstruction does not rerun models, tools or external effects. Instructions must be visible and editable by the user.

## Scope

Includes: text conversation, explicit topic organization, editable base instructions, run status, context/lineage inspection and replay of this journey's defined state.

Deferred: voice and Live Threads, automatic naming/organization/archiving, artifact moves and references, split/merge, context from other threads, semantic memory, attachments, external tools and inputs, task execution, mobile and self-modification. A live model call depends on the provider/data/cost choice in G09.

## User flow

1. Open Ash and create a “Home” topic and “Repair checklist” thread. The user can also start without a topic.
2. Send a text request: “Help me organize a repair checklist for the apartment.” The message appears once, with a visible response status.
3. Read Ash's response and send a follow-up: “Put the kitchen items first.” The follow-up uses the preceding conversation.
4. Explicitly add the thread to a second topic or remove a topic association. The conversation remains the same continuing matter.
5. Inspect a response to see its originating input, run outcome and supplied context. Internal processing records do not clutter the ordinary conversation.
6. Close/reopen or reconnect the client. The saved conversation, organization and settled run outcomes remain available.

## Requirements

- **CONV-R01 — Interface:** text-only normal threads. The first interface is a minimal desktop client if G02 confirms it.
- **CONV-R02 — Manual organization:** the user can create/rename topics and threads and explicitly link/unlink topics; starting a thread without a topic is allowed.
- **CONV-R03 — Topic context boundary:** a topic link organizes the first-delivery UI. Context from other threads in that topic is deferred and documented as a temporary limitation (G05).
- **CONV-R04 — Instruction revisions:** the user can view/edit active base instructions. Each response identifies the revision used. Changes affect subsequent runs, not a run already underway; Ash does not edit instructions in this milestone.
- **CONV-R05 — Context:** include active base instructions and the current thread's visible conversation up to the submitted input. The inspector identifies size limits and omitted older content.
- **CONV-R06 — Accepted input:** durably record input before its response run starts. Retrying transport delivery of the same submission does not create a second message or run.
- **CONV-R07 — Concurrent input:** execute one response run at a time per thread. While it runs, block further submissions there and preserve typed draft text. Different threads may work independently.
- **CONV-R08 — Outcomes:** distinguish running, completed, failed, cancelled and interrupted outcomes. Mark partial output incomplete rather than presenting it as a successful final answer.
- **CONV-R09 — Recovery:** a client disconnect does not itself cancel a backend run. Reconnecting restores recorded output/status without creating a new run. Restarting preserves completed conversations and topic associations.
- **CONV-R10 — Retry:** provider failure or server interruption is visible. User-requested retry creates a distinguishable attempt linked to the original input.
- **CONV-R11 — Cancellation:** prevent later output from being presented as a successful completion for the cancelled attempt. Cancellation cannot guarantee reversal of provider work already started.
- **CONV-R12 — Inspection:** show the originating input, supplied context, instruction revision, model identifier, run outcome and recorded processing metadata. Do not promise private model reasoning or retain credentials in conversation history.
- **CONV-R13 — Replay:** reconstruct defined core views, including instruction revisions and run outcomes, from retained history. Make no model call and never restart recorded work during replay.

## Acceptance examples

### C01 — Untagged thread · CONV-R02, CONV-R06

When the user starts a thread without selecting a topic and submits one request, one visible user entry and one response run exist; no topic is inferred.

### C02 — Topic membership · CONV-R02, CONV-R13

Given a thread in Home, when the user links it to Planning and unlinks Home, the same thread and messages remain. Both changes appear in history; removing membership does not delete content.

### C03 — Follow-up context · CONV-R03, CONV-R05

Given a completed response, when the user asks a follow-up about it, supplied context includes the preceding conversation and follow-up. A separate thread's content is absent.

### C04 — Response inspection · CONV-R12

When inspecting a displayed reply, its originating input, run status, recorded output, model identifier and actual instruction/context selection are discoverable.

### C05 — Duplicate delivery · CONV-R06

When transport resends an accepted submission after connection loss, no duplicate user entry or extra response run is created. A separate deliberate submission remains a separate input.

### C06 — Client reconnect · CONV-R09

When the user closes the client during backend generation and reconnects, recorded work is recovered and its final status is accurate. Reconnect does not invoke the model again.

### C07 — Failed or stopped work · CONV-R08, CONV-R10, CONV-R11

When a model request fails, the user cancels or the server stops during generation, the corresponding failure/cancel/interruption is visible. Partial text is incomplete; retry is explicit and distinguishable from the earlier attempt.

### C08 — Input during a run · CONV-R07

Given a running response, when the user attempts a second submission in the same thread, that submission is blocked and its draft preserved. Another thread remains usable.

### C09 — Instruction edit · CONV-R04

When the user edits instructions between two completed requests, each response points to its own instruction revision. Historical context is unchanged.

### C10 — Replay · CONV-R13

When rebuilding core projections from retained history in an isolated development database, thread/topic identities, names, membership, displayed content/order, instruction revisions and run outcomes match. Model/tool call count during replay is zero. Operational locks are not restored as active work.

### C11 — Restart · CONV-R09

When restarting after a completed exchange, the same recorded conversation and topic associations remain available.

### C12 — Context limit · CONV-R05, CONV-R12

When conversation history exceeds the configured context limit, the response inspector identifies omitted content and the context actually used.

## Open questions

[G02–G07 and G09](../open-questions.md). Is this text-first journey useful enough before voice and external inputs?
