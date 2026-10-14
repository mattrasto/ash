# Thread UX alignment

Implemented and verified, 2026-10-12

Behavior: [UX01–05](../../specs/features/threads.md#thread-ux) and [image rules](../../specs/features/images.md#rules). Product features absent from Ash—voice, tasks, tools, Topics and canvas—are outside this pass.

## Asha review

Reviewed Asha commit `0b0593c` in an isolated checkout and database, with local synthetic model responses. Exercised its composer, incremental response, metadata pills and archive navigation in the running desktop. Read `Chat.svelte`, `Sidebar.svelte`, `ConversationList.svelte`, `Message.svelte`, `MessageMetadata.svelte`, `AttachmentBubble.svelte`, `Lightbox.svelte`, `lib/markdown-stream.ts` and `lib/attachment-actions.ts` under its client renderer.

| Interaction observed | Ash adaptation |
| --- | --- |
| New thread opens a ready composer | One-click creation and initial empty thread; first-message title plus manual rename. Model-based naming is deferred to the visibility layer by user decision. |
| Quiet sidebar with activity, archive access and adjustable width | Persistent archive metadata; local width/collapse/read preferences. Running threads continue when switched or archived. |
| Compact input with attachment chips and icon actions | Autosizing input, existing durable draft/upload recovery, labeled Send/Stop and attachment controls. Ash retains one active response per thread. |
| User-message anchoring, shrinking bottom spacer and explicit follow control | Separate read position and following state; resize-aware content geometry and per-thread restoration. |
| Incremental Markdown and word/line reveal | Reconcile sanitized DOM, preserve existing nodes, prime restored text immediately and bound queued reveal latency to about 400 ms. Tables appear together; reduced motion skips reveals. |
| Expandable model/time/token pills | Compact recorded response metadata; full Artifact inspector remains available, with the causal chain collapsed initially. No private reasoning is displayed. |
| Image accordion, captions and native context actions | Existing viewer/filmstrip plus hover/focus descriptions, thumbnail/viewer context menus, copyable descriptions and reduced-motion-aware transitions. |

Ash retains its existing appearance, safe Markdown policy, immutable request capture and failure/retry semantics. Naming and metadata edits make no model calls. [Backend contracts and runtime grant](threads.md#thread-controls).

## Test plan

Run `pnpm verify`; all automated checks use deterministic or mocked responses.

| Scenario | Verify |
| --- | --- |
| Start/name | First launch exposes a focused composer. Create without entering a title; first accepted text supplies the title. Manual rename survives a follow-up and reload. Image-only input remains sendable. |
| Archive | Archive during generation; the same Run finishes. Open the archive, read the saved exchange and unarchive it. Invalid metadata updates are rejected; runtime cannot mutate unrelated columns. |
| Switch/background | Type a multiline draft, scroll into history, switch away and return. Draft and position remain. Another thread shows running/unread state until opened. |
| Input | Enter sends once, Shift+Enter inserts a line, composition input does not send. Input grows and resets after acceptance. Stop preserves typed follow-up text. |
| Streaming | Deliver Markdown one character at a time. Preserve an existing paragraph node; final text/code/link values match static rendering, raw HTML stays inert and remote images remain unfetched. No queued hidden content remains after the bounded reveal window. Restored content and reduced-motion content appear immediately. |
| Reading | Stream a long response while reading earlier messages. Position stays fixed. Latest messages exposes the end with a gap below it. Switch/reload preserves a reading position; resize keeps the chosen follow mode. |
| Actions/inspection | Use hover, keyboard focus and context menus. Message icons show tooltips on hover and keyboard focus. Copy text/code through native IPC under UX04. Expand metadata; open the recorded context/Artifact chain and close with Escape. Menu Escape/outside click restore focus. |
| Images | Pick/paste/drop, upload error/retry/removal, draft recovery, gallery hover/focus description, right-click copy/save/description, viewer arrows/filmstrip/Escape and icon actions. Description reveal preserves message/gallery width; larger galleries scroll. Send nine images and inspect/reload all nine. Existing image retention and snapshot tests remain required. |
| Sidebar | Keyboard resize and reset; collapse/reopen; reload preserves width and visibility. Archive expansion persists; archive/unarchive lives in the row icon, while the menu contains Rename. The sidebar has no developer-info panel; chat has no storage-screen switch. Reordering/stream/viewer animations respect reduced motion. |

Manual comparison uses a disposable deterministic Ash instance. Check the thread at desktop and narrow widths, scroll during a long reply, open contextual actions, rename/archive/unarchive and inspect saved context. Existing native Electron tests verify clipboard/save integration without replacing the user's clipboard contents.

## Verification

Current validation: typechecking with zero warnings, isolated build, 30 unit tests and all 40 integration/desktop checks passed across the full run and an image-only rerun, with zero live provider calls.

The full run at `~/.ash-dev/evidence/796048e17da1c64aee3fd57b/` passed every non-image suite. An existing image-description test observed the attachment and its Run on opposite sides of completion; its wait now requires the completed description as well as the completed Run. All six image checks then passed with `node --import tsx --test tests/integration/images.test.ts`; screenshots are in `~/.ash-dev/evidence/storage-ui-image-recheck-570fec/`. The original full-run failure remains recorded in its report.

Workflow checks now use chat messages, unsent drafts and sidebar preferences through hot reload, desktop/backend restart and reset. They verify instance isolation, stable preview addresses and refusal to silently change an occupied address. Unit coverage includes source-file deletion before and after staging. A separate review checked deleted-source snapshots, removal of unused native handlers and preview-address upgrade behavior.

Image and thread regression coverage remains under the test plan above. Manual inspection confirmed the storage-screen switch and developer-info panel are absent from the running OpenAI preview. The preview retained its existing session and address. Broader live-model quality, Topics, tool timelines and the future visibility layer remain outside this UX pass.
