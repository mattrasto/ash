# Conversation UX alignment

Implemented and verified, 2026-10-12

Behavior: [UX01–05](../../specs/features/conversations.md#conversation-ux) and [image rules](../../specs/features/images.md#rules). Product features absent from Ash—voice, tasks, tools, Topics and canvas—are outside this pass.

## Asha review

Reviewed Asha commit `0b0593c` in an isolated checkout and database, with local synthetic model responses. Exercised its composer, incremental response, metadata pills and archive navigation in the running desktop. Read `Chat.svelte`, `Sidebar.svelte`, `ConversationList.svelte`, `Message.svelte`, `MessageMetadata.svelte`, `AttachmentBubble.svelte`, `Lightbox.svelte`, `lib/markdown-stream.ts` and `lib/attachment-actions.ts` under its client renderer.

| Interaction observed | Ash adaptation |
| --- | --- |
| New conversation opens a ready composer | One-click creation and initial empty conversation; first-message title plus manual rename. Model-based naming is deferred to the visibility layer by user decision. |
| Quiet sidebar with activity, archive access and adjustable width | Persistent archive metadata; local width/collapse/read preferences. Running conversations continue when switched or archived. |
| Compact input with attachment chips and icon actions | Autosizing input, existing durable draft/upload recovery, labeled Send/Stop and attachment controls. Ash retains one active response per thread. |
| User-message anchoring, shrinking bottom spacer and explicit follow control | Separate read position and following state; resize-aware content geometry and per-thread restoration. |
| Incremental Markdown and word/line reveal | Reconcile sanitized DOM, preserve existing nodes, prime restored text immediately and bound queued reveal latency to about 400 ms. Tables appear together; reduced motion skips reveals. |
| Expandable model/time/token pills | Compact recorded response metadata; full Artifact inspector remains available, with the causal chain collapsed initially. No private reasoning is displayed. |
| Image accordion, captions and native context actions | Existing viewer/filmstrip plus hover/focus descriptions, thumbnail/viewer context menus, copyable descriptions and reduced-motion-aware transitions. |

Ash retains its existing appearance, safe Markdown policy, immutable request capture and failure/retry semantics. Naming and metadata edits make no model calls. [Backend contracts and runtime grant](conversations.md#conversation-controls).

## Test plan

Run `pnpm verify`; all automated checks use deterministic or mocked responses.

| Scenario | Verify |
| --- | --- |
| Start/name | First launch exposes a focused composer. Create without entering a title; first accepted text supplies the title. Manual rename survives a follow-up and reload. Image-only input remains sendable. |
| Archive | Archive during generation; the same Run finishes. Open the archive, read the saved exchange and unarchive it. Invalid metadata updates are rejected; runtime cannot mutate unrelated columns. |
| Switch/background | Type a multiline draft, scroll into history, switch away and return. Draft and position remain. Another conversation shows running/unread state until opened. |
| Input | Enter sends once, Shift+Enter inserts a line, composition input does not send. Input grows and resets after acceptance. Stop preserves typed follow-up text. |
| Streaming | Deliver Markdown one character at a time. Preserve an existing paragraph node; final text/code/link values match static rendering, raw HTML stays inert and remote images remain unfetched. No queued hidden content remains after the bounded reveal window. Restored content and reduced-motion content appear immediately. |
| Reading | Stream a long response while reading earlier messages. Position stays fixed. Latest messages exposes the end with a gap below it. Switch/reload preserves a reading position; resize keeps the chosen follow mode. |
| Actions/inspection | Use hover, keyboard focus and context menus. Copy text/code through native IPC. Expand metadata; open the recorded context/Artifact chain and close with Escape. Menu Escape/outside click restore focus. |
| Images | Pick/paste/drop, upload error/retry/removal, draft recovery, gallery hover/focus description, right-click copy/save/description, viewer arrows/filmstrip/Escape and reuse. Existing image retention and snapshot tests remain required. |
| Sidebar | Keyboard resize and reset; collapse/reopen; reload preserves width and visibility. Archive expansion persists. Reordering/stream/viewer animations respect reduced motion. |

Manual comparison uses a disposable deterministic Ash instance. Check the conversation at desktop and narrow widths, scroll during a long reply, open contextual actions, rename/archive/unarchive and inspect saved context. Existing native Electron tests verify clipboard/save integration without replacing the user's clipboard contents.

## Verification

`pnpm verify` passed: typechecking with zero warnings, isolated build, 28 unit tests and 39 integration/desktop checks, with zero live provider calls. Evidence: `~/.ash-dev/evidence/0170acb787fa0ad52ea6ac0c/` (`report.json`, `checks.log`, `chat-reconnected.png`, `images-chat.png`, `images-viewer.png`).

Manual comparison covered Asha's new-chat/streaming/metadata/archive behavior and Ash's multiline composer, first-message naming, rename/archive/reopen, long reply and Artifact inspection. A separate code review checked metadata validation/grants, atomic naming, stale polling responses, safe DOM reconciliation, timer disposal and archive-animation accessibility. No blocking findings remain.

Temporary Asha and Ash comparison databases/workspaces were disposed; the Asha source checkout is unchanged. The persistent Ash preview was restarted with its existing OpenAI session, three conversations retained, and its archive grant verified. Broader live-model quality, Topics, tool timelines and the future visibility layer remain outside this UX pass.
