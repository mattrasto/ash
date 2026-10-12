# Image input and descriptions

Implemented and verified, 2026-10-12

Behavior and limits: [image spec](../../specs/features/images.md). This is slice 1 of the [self-modification path](../plans/self-modification.md); image generation and general tools remain separate.

## Try it

In a thread, paste, drop or choose images. Remove or retry failed uploads before sending; descriptions run independently and do not block Send. Images can be sent without text. Click a thumbnail for the full-size viewer, arrow navigation, copy/save, description details and **Use again**. Reuse adds the existing image to the current draft without another upload or description call.

**Inspect** shows the captured image bytes' dimensions/hash and whether each historical image contributed pixels or a description. **Inspect description** opens the upload → description request → description result chain. **Copy text-only context** exports the frozen text and image descriptions from that request.

Assistant replies render Markdown with copyable code. Scrolling up suspends following; **Latest messages** returns to the bottom.

## Asha adaptations

The reference implementation is the adjacent Asha checkout, particularly `docs/protocols/attachments.md`, server `captions/haiku.ts`, `attachments/blocks.ts`, `attachments/thumbnails.ts`, `conversation/turn.ts`, and client `AttachmentBubble.svelte`, `Lightbox.svelte`, `Chat.svelte`, `lib/uploads.ts` and `lib/attachment-actions.ts`.

| Asha pattern | Ash implementation |
| --- | --- |
| Describe once on upload; reuse text for non-vision consumers | Independent description Run, persisted result and labeled text fallback/export. |
| Recent image window and stable attachment markers | Context selection records pixels/description, reason and the description Run used. **Use again** supplies explicit recall until tools exist. |
| Immediate previews, upload recovery and restrained transcript UI | Local previews/progress, per-thread drafts, fixed-width accordion for three or more images and descriptions on demand. |
| Viewer, filmstrip and native actions | Keyboard navigation, feedback, original-byte saving and orientation-correct PNG clipboard copy. |

Ash additionally freezes cached model derivatives and description text in requests, so retries do not resize current files or pick up later captions. It implements unsubmitted-upload cleanup immediately rather than leaving orphan collection deferred.

## Storage and execution

`packages/server/src/modules/attachments/` owns validation, immutable files, description execution and cleanup. `sharp` fully decodes allowed formats, rejects animation, rotates for display and strips metadata from model/thumbnail derivatives. Originals retain their original bytes. The current transform produces a 320-pixel thumbnail and a model image no larger than 2 MiB, reducing dimensions from at most 2,560 pixels when necessary.

Files live at the owning instance's `files/attachments/<id>/<sha256>`. The server fsyncs staged files and atomically publishes their directory before committing metadata. Reads validate IDs, regular files, size and hash, and reject symlinks. Unowned directories older than an hour are reconciled; referenced storage failures surface before any provider dispatch.

The [data model](../data-model.md#image-storage-and-description-runs) defines attachment ownership, reference FKs and description checkpoints. Cleanup runs at startup and hourly, locks each candidate against submission, retains active descriptions, and removes an expired upload's private Artifact/Run graph only when no accepted reference exists. Submitted images remain retained. PostgreSQL recovery alone cannot restore image files; coordinated backup/restore remains pending.

The renderer stores IDs and metadata for drafts, never image bytes or credentials. In-flight uploads require reselection after desktop restart; accepted uploads remain available until expiry. File upload uses a stable ID for delivery retries. Removing an in-flight item aborts it locally; an already accepted server upload can remain until expiry.

## Model context and cost

Live uploads make one additional Responses call to `gpt-6-luna`, with reasoning `none`, at most 256 output tokens and a 20-second deadline. The existing `.env.local` key and session counter are shared with chat; bounded test sessions count descriptions too. Failure or missing model access leaves the image usable and exposes an explicit description retry. There is no automatic provider retry or restart redispatch.

The description Run captures its `image-description` Instruction and exact model image. It saves only a completed result; it does not add a chat message or occupy a thread's response slot. Deterministic mode produces an explicitly synthetic description with no external call.

`modules/context/select.ts` chooses image representations under [IMG-R05](../../specs/features/images.md#rules), including text-only selection for future consumers. Each structured request block freezes the derivative descriptor, `detail: high`, stable ID and the description available at acceptance. A late description affects later requests only. The adapter materializes those checked bytes as data URLs at dispatch with `store: false`; neither base64 nor credentials enter Artifacts or inspection. The binary image budget implies up to roughly 22 MiB of base64, in addition to bounded text.

## Test plan

Ordinary `pnpm verify` uses synthetic images and deterministic/mocked providers; it makes zero paid calls. Tests use isolated real Git worktrees, PostgreSQL and Electron. Existing text tests exercise the schema upgrade and backward-readable text requests alongside the new image contracts.

| Acceptance | Automated checks |
| --- | --- |
| IM01, IM02 | Pick/paste/drop, image-only and text-plus-image messages, upload failure/retry, remove during upload, switch threads during upload, saved drafts, follow-up and reopen. |
| IM03, IM05 | Independent description provenance, explicit/deduplicated retry, restart interruption, late description and byte-identical frozen conversation retry. |
| IM04 | Six-turn window, newest-first count limits, text-only fallback, frozen summary markers, explicit reuse, captured image order/detail and provider wire bytes. |
| IM06 | Decode/size/pixel/animation limits, spoofed formats, foreign instance IDs, traversal, symlinks, missing/corrupt bytes and no paid-call reservation on a storage error. |
| IM07 | Viewer arrows/Escape, filmstrip, clipboard orientation, saved original bytes, composer focus after reuse, code copying, streaming scroll preservation and return to latest. |
| IM08 | Cleanup/submission race, accepted-image retention, private graph deletion, restart and existing text compatibility. |
| Renderer boundary | Escaped raw HTML, disabled remote Markdown images and rejected unsafe links. |

Relevant tests: server `modules/attachments/storage.test.ts`, `modules/context/select.test.ts`, `platform/models/openai.test.ts`, `tests/unit/markdown.test.ts` and `tests/integration/images.test.ts`. Desktop checks stub only the operating-system clipboard/save dialog, verifying the remaining IPC, decode and file-writing path without changing the user's clipboard.

For live verification, create a separate disposable instance with a five-call, ten-minute session on the configured chat model. Upload the synthetic screenshot fixture, verify its short description, ask about visible shapes/text, and follow up. Inspect captured image identity and provider usage, then restart and confirm persistence without another call. Retain the report/screenshots and dispose the instance. Limits exhausting or provider failure do not stop offline verification; record incomplete live cases.

## Verification results

`pnpm verify` passed: clean typecheck/build, 28 unit tests and 38 integration/desktop checks, with zero paid calls. Evidence: `~/.ash-dev/evidence/2e2f568e6de5838050821995/` (`report.json`, `checks.log`, image screenshots). Disposable worktrees and instances were cleaned up. A separate review covered native IPC, immutable request/media references and cleanup locking; regressions cover composer focus and deletion racing a retry of an expired upload ID.

The bounded live smoke passed with three calls: one GPT-6 Luna description and two GPT-6.1 Sol chat replies. Both models correctly identified the synthetic heading, colors and shapes; follow-up inspection retained the exact image hash and completed description. Restart/reopen preserved state without redispatch. Reported usage totaled 2,557 input and 93 output tokens; this is provider-reported usage, not billing reconciliation. Evidence and the repeatable driver: `~/.ash-dev/evidence/live-images-846178d00c85aa3ed9ba6148/`. The disposable instance was removed. The final cleanup/focus hardening was verified offline afterward.

Personal-image quality, image generation and coordinated database/file disaster recovery are outside these verification results.
