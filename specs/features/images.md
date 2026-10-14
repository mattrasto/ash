# Images in chat

Accepted and implemented, 2026-10-12 · Offline and bounded live verification passed

Extend [persisted threads](threads.md) with screenshot/image input and the asynchronous descriptions requested from Asha's design. [Implementation and verification](../../docs/features/images.md).

## Rules

- **IMG-R01 — Compose:** paste, drop or choose PNG/JPEG/WebP images without a count cap, with optional text. Keep order, immediate previews, upload status, remove/retry controls and per-thread drafts. Send waits for uploads, not descriptions. An upload error must be resolved or removed; never silently discard it.
- **IMG-R02 — Limits:** validate actual decoded format, reject animated/invalid images, and bound each upload to 10 MiB and 20 megapixels; the combined original bytes in a message are at most 20 MiB. Reject before provider dispatch and preserve the draft.
- **IMG-R03 — Persistence:** accepted messages reference immutable, instance-owned images. Preserve the original and cached model/thumbnail derivatives. Existing text threads remain readable. Delivery retry reuses upload/submission identities; execution retry preserves the captured image bytes and description text.
- **IMG-R04 — Description:** upload starts an independent, inspectable description Run. Live mode uses GPT-6 Luna for one or two concrete sentences about the subject, layout and notable visible text; deterministic mode labels its synthetic description. Description failure/interruption does not fail the upload or chat. Explicit retry creates a new Run; restart never repeats a paid call automatically.
- **IMG-R05 — Context:** provide stable attachment IDs beside image content. Include every image in the current input, subject to a whole-request limit of 16 MiB of model image bytes. Include images from the last six user turns until the request has eight images; the current input may exceed that count. Prioritize newer images; represent older/excess images with labeled generated descriptions. A missing description is explicitly unavailable, never inferred from a filename. Record the representation and reason in each request. Text-only context export uses these same frozen descriptions. Reattaching an older image includes its pixels again.
- **IMG-R06 — Inspection:** show original/model dimensions, hashes, description status, description Run and captured image representations. Description completion can affect later context but cannot rewrite earlier requests. Never expose credentials or base64 image bodies in inspection.
- **IMG-R07 — Viewing:** thumbnails open a full-size viewer with Escape, arrow navigation, a filmstrip, copy/save icon actions with tooltips and visible action feedback. The viewer has no reuse or inspection actions; inspection remains available on messages. Right-click a thumbnail or viewer image for these actions and Copy description. Preserve image aspect ratios and reading position as images load. Descriptions serve as alt text, appear on thumbnail hover/focus without changing gallery or message width, and remain available in the viewer. Large galleries scroll horizontally within the message.
- **IMG-R08 — Chat rendering:** display Markdown and copyable code blocks. Raw HTML and remote Markdown images cannot execute or fetch. Following external links requires an explicit user action. Scrolling away from the bottom suspends automatic following; expose a return-to-latest control.
- **IMG-R09 — Lifetime:** unsubmitted uploads and their description records expire after 24 hours. Submission retains all referenced assets, including retry snapshots. Cleanup serializes with submission and never removes accepted images. Disposal removes only the owning instance's files. Broader personal-data erasure/backup policy remains [G06](../open-questions.md#g06--deletion-and-retention).

## Acceptance examples

| Example | Expected result |
| --- | --- |
| IM01 — Screenshot discussion | Paste an image, send while its description is pending, ask a follow-up, reopen Ash; image, reply and inspection survive. |
| IM02 — Compose and recover | Pick/drop several images, remove one, retry a failed upload, switch threads and return; order and draft remain correct. A late upload cannot reappear after removal or land in another thread. |
| IM03 — Description provenance | Inspect upload → description request → description result. Failed/interrupted descriptions can be retried without another chat message or replacing earlier snapshots. |
| IM04 — Context degradation | After six newer user turns or an image-budget overflow, inspection shows descriptions instead of pixels. Reattaching an image restores pixels. Text-only export retains IDs and labeled descriptions. |
| IM05 — Frozen retry | Description finishes after message acceptance; retry still uses the original request, including its then-pending description marker and exact image hash. |
| IM06 — Media boundaries | Spoofed/animated/oversized images, foreign-instance IDs, unsafe paths and corrupt/missing bytes are rejected without a provider call. |
| IM07 — Viewer and reading | Keyboard navigation, copy/save feedback, correct portrait orientation and filmstrip selection work. Uploads, image decode and streamed replies do not pull the reader away from older content. |
| IM08 — Cleanup and upgrade | Expired unsubmitted images are removed; accepted/captured references survive cleanup, restart and contract migration. Old text-only retries remain valid. |

Image generation, additional file formats and automatic model recall of old image pixels follow separately.
