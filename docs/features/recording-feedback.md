# Video attachments and screen recording

Recording and Flash understanding implemented, 2026-10-14 · Native macOS capture verified

Behavior and limits: [screen recording and video understanding](../../specs/features/recording-feedback.md).

## Use it

In a Thread, choose/drop a video or click **Record screen**. Stop adds the clip to that Thread's draft. Preview, add optional text, then Send. Settings → **Include microphone audio** changes the remembered microphone preference. Drag the floating panel by its grip or any non-button surface to move it; Stop, Discard and deadline extension remain available over other applications. A recorded clip prepares actual narrated action items in the composer before Send, preserving existing text and edits. Analysis failure retains the clip with Retry; empty narration is explicit. Imported video-only messages stay stored without an unsolicited answer. Captions/transcripts enter later context in the background; the transcript is available in inspection and a collapsed viewer section, outside the conversation view.

## Implementation

| Boundary | Code and behavior |
| --- | --- |
| Shared media contracts | `packages/shared/src/contracts/attachments.ts` adds video metadata without changing legacy image metadata; `recording.ts` defines the native bridge. No database migration is required. |
| Video ingestion | Server `modules/attachments/video.ts` validates container signatures, probes decoded media using pinned FFmpeg/ffprobe, retains the original, prepares a seekable playback derivative and generates a thumbnail. `service.ts` streams uploads to instance-owned staging files, preserving delivery identity and attachment lifetime. Video uploads start an independent caption/transcript Run. |
| Playback and export | `routes.ts` serves bounded byte ranges from validated instance file handles. Client `features/images/Viewer.svelte` supports mixed media, native video controls and original-byte saving; `Gallery.svelte` and the composer supply video thumbnails, badges and muted previews. |
| Capture and recovery | Client main `recording.ts` selects the display, scopes media permissions to the recording owner, writes chunks to disk, journals the destination and outcome, and owns deadlines and the floating panel. Pointer dragging uses an overlay-only IPC handler with work-area bounds; buttons remain outside the drag gesture. Renderer `features/recording/recorder.ts` owns MediaRecorder, track cleanup and ordered chunk delivery. Startup acquisition races cancellation and releases late permission grants. Quit finalizes an active recording or cancels startup; renderer interruption leaves an incomplete journal for recovery, never automatic recapture. |
| Submission/context | `Threads.submitMessage()` stores video-only inputs without a Run. Their submission UUID is the Input identity; a stored hash rejects changed duplicate content. Submission-key advisory locks serialize both stored-only and response submissions. `context/select.ts` freezes metadata and the caption/transcript then available, with explicit pending/truncation markers; video pixels/audio stay in the video-tool path. |

Recordings stage under the owning instance's `files/recordings/<id>/`; finalized assets use the existing hash-addressed attachment store. Failed uploads retain a Retry and Save locally path. Temporary media is not buffered for the whole recording: chunk writes and native uploads stream through files, with renderer background throttling disabled during capture. The renderer stops and preserves partial media if disk delivery falls behind; journal-write failures release active capture and leave recoverable files for reopening. Incomplete outcomes persist on the attachment after submission. Media preparation subprocesses accept local files only and have execution/output bounds. Existing [image storage](images.md#storage-and-execution) owns publication and cleanup mechanics; video policy follows the feature spec.

Native upload retains its capture journal until the renderer persists the ready attachment in local draft storage, then removes staging through `ashRecording.discard()`. On reopening, an unacknowledged journal replays the original upload ID, reusing the accepted attachment and Summary Run. If the ready draft was already persisted, recovery only clears the leftover journal. Neither path repeats paid analysis.

## Asha reference

Paths below are relative to the adjacent `asha/` checkout. The reviewed source has an existing recorder and video attachment path.

| Source | Observed behavior / adaptation |
| --- | --- |
| `packages/client/src/renderer/src/components/Chat.svelte`: `stopRecording`, `addFiles` | Stopping produces a File and uses the normal uploader; the clip lands in the composer. Adopt the shared path, preserving Ash's per-Thread draft and failure rules. |
| Same file: composer attachment chips | Ready videos have clickable thumbnails and muted, looping hover previews; filename, size, upload/error status and removal remain visible. Use as the basis for VID-R10/R13. |
| `components/AttachmentBubble.svelte` | Video thumbnail has play and duration badges; clicking opens the viewer. Missing thumbnails fall back to a file chip. |
| `components/Lightbox.svelte` | Full-size video with native controls, filename, previous/next navigation, mixed-media filmstrip and Escape. Playback starts on open. Its global arrow handler needs adaptation so it does not consume video-control keys. |
| `lib/attachment-actions.ts` | Videos offer Download; image-byte clipboard copying is image-only. Avoid offering a session-local video URL as useful export. |
| `lib/recorder.ts`, `components/RecorderOverlay.svelte` | Recorder combines display and optional mic tracks; overlay shows elapsed time, actual mic state, Stop and Cancel. Mic defaults on via settings. The current overlay stays inside the Asha window, so it does not satisfy controls reachable while another app is foreground. |
| `packages/client/src/main/index.ts`: `configureMediaPermissions` | Enables Electron's native system picker; fallback selects the first screen source. This is not evidence that a picker is mandatory or that the first source is the desired monitor. |
| `packages/server/src/api/attachments.ts`, `captions/haiku.ts`, `attachments/analyze.ts`: `captionVideo` | Upload launches background captioning without awaiting it. The video branch uses Gemini 2.5 Flash, requesting a 2–3 sentence visual summary and full verbatim narration in one JSON response. Summary and transcript are stored separately; the prompt explicitly omits timestamps and speaker labels. This supports background transcription as a product default, not evidence of transcription completeness or accuracy. |
| `packages/server/src/attachments/blocks.ts`: video branch | Text chat receives the stored summary and narration when ready; voice context omits the full transcript. A missing caption has an explicit unavailable marker. More specific questions direct the model to the video tool. |
| `packages/server/src/conversation/tools.ts`: `video_analyze`; `attachments/analyze.ts`: `analyzeVideo` | One general tool accepts an attachment ID and question, sends the stored video to Gemini and returns text. Description and question/search are not separate tools. Its code enforces a 20 MiB inline cap; Asha's upload may replace the attachment with a compressed copy. Ash keeps its original-media rule and must validate provider limits independently. |
| `docs/surfaces/video-dictation.md`, `docs/protocols/attachments.md` | Useful lifecycle context. Provider-specific compression/captioning and historical OS claims need independent validation. Keep Ash's original-media retention and later analysis-tool boundary. |

Renderer paths abbreviated above share `packages/client/src/renderer/src/`. Asha is a reference; it is not modified by this work.

## Video understanding

`modules/video/service.ts` owns captured plans, segmented analysis, completed-result reuse and cancellation. Background captions use the attachment's Summary Run. Explicit `describe_video` and `ask_video` tools are registered in `modules/video/tools.ts`; they enforce one captured/current Thread video and execute within the calling chat Run. Provider failure preserves playable media and earlier evidence; restart never redispatches a paid request. Retry from video description/inspection is deliberate.

Each supplied clip is retained by hash with its original timeline offset, prompt, full response schema and requested sampling settings. Inspection verifies the hash before playing those exact supplied bytes. Generated observations receive source-relative estimated timestamps; citations open the original player at that moment. Free-form answer times remain relative to the supplied clip, with its offset labeled. Provider-selected frames are not individually exposed, so a linked timestamp is not proof of exact frame/audio alignment. Output, history/context truncation and uninspected intervals are labeled. Bounds are canonical in the [delivery design](../plans/video-understanding.md).

Recorded captions also return a bounded `actionItems` field in the same provider request. Multi-segment recordings consolidate ordered transcript/segment evidence so later corrections can supersede earlier requests. Incomplete/failed analyses expose no finished action-item draft. Client draft state records insertion once per clip; a successful retry request from any analysis control resets a failed draft to pending before polling its result. Legacy drafts are deliberate, and removals cannot receive late text.

Global Settings provides separate `video-caption` and `video-understanding` instruction documents. Plans capture their current text and identities; retries and historical inspection retain those snapshots. Ordinary chat context has a bounded caption/transcript representation and identifies the result revision. Captured system guidance enforces video source-authority rules even without custom Thread guidance. Late analysis does not rewrite earlier requests. The viewer offers caption/retry controls; the viewer also offers a collapsed transcript with copy and estimated-timestamp seeking; transcript editing remains deferred.

## Understanding provider

Accepted initial model: `gemini-3.8-flash` for all three capabilities, independently of ordinary chat routing. `platform/models/gemini-video.ts` uses native video/audio and structured output on the [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), with `store:false` and no provider retries. Deterministic mode uses labeled synthetic results without reading keys or making external calls.

The backend reads only `GEMINI_API_KEY` from this Ash checkout's owner-only `.env.local`; Asha credentials and inherited keys are not fallbacks. Existing OpenAI configuration remains independent. Bounded app sessions charge video requests to the same call/time allowance; unbounded interactive sessions retain per-request deadlines.

Small clips are sent inline after hash/size verification. Larger segments stream through Google's [Files API](https://ai.google.dev/gemini-api/docs/files), with trusted upload-host checks, processing polling and deletion after bounded use, including cancellation. Interrupted/failed deletion falls back to provider expiry; this is not a zero-retention guarantee. Originals remain local and are never replaced to meet provider limits. `modules/video/media.ts` prepares bounded derivatives; source-relative offsets and transformations remain inspectable.

Flash's timestamps are model estimates. The initial experiment found correct feedback wording/correction but up to 2.487s boundary drift; it did not establish a provider winner. Reviewed experiment: `ash_experiments`, branch `codex/video-understanding-experiment`, commit `914d3a7`, `video-understanding/results/2026-10-14-initial.md`. Dedicated transcription remains a later option if verified timing becomes necessary.

## Verification

Native checks passed on macOS 26.6.2 with Electron 41.10.6 and existing Screen Recording/microphone grants: one-click capture without a picker, microphone inclusion, decoded frames matching a synthetic cover, playable/seekable output, floating warning/extension/Stop and video-only submission without a model call. Disposable instances and captured clips were removed. The floating controls use a non-fullscreen panel; a regular secondary window inherited the main window's fullscreen state during exploration.

`tests/integration/video.test.ts` supplies generated video/audio streams and uses isolated data with hidden windows; ordinary verification does not access real capture devices or live providers. Its registered journeys cover streamed upload/deduplication, invalid media, ranged seeking, stored-only submission, frozen metadata/context references, player/save actions, microphone settings, fixed Thread destination, repeated deadline extensions, automatic stop, discard, denial, source stop and quit/reopen recovery. `recording-startup-cancel` covers unresolved microphone permission, late grants and Quit; `recording-upload-recovery` covers an accepted upload without a durable composer acknowledgement; `recording-viewer-retry` covers successful analysis retry, preserved edits and insertion once across reopening. Existing image and thread suites remain regression coverage. Run `pnpm verify` for the full gate.

Native checks did not establish first-time OS consent, signed packaging, every fullscreen/Space transition, long-recording resource behavior or recovery from every corrupt partial file. Those require targeted checks before broader distribution. These native capture limits remain separate from video understanding.

### Understanding checks

`tests/integration/video-understanding.test.ts` covers background/late context, same-Run shared work, single-video scope, denser interval inspection, source offsets, partial processing, frozen retry, cancellation, cleanup and hidden Electron citation playback. The existing recording suite also verifies actual action-item insertion, draft preservation, reopening without duplicates and capped composer growth/scrolling. `platform/models/gemini-video.test.ts` covers provider request/schema shape, streamed upload/poll/delete, cancellation, failed-call non-retry, foreign upload-host rejection, visible partial output and private-thought exclusion.

Live checks use only synthetic media and this worktree's new key. Six completed results covered caption/transcript, description, corrected action items, a brief toast at 5 FPS, a narration/screen contradiction and on-screen instruction text. Semantic review found the expected content and distinguished feedback from visible evidence; clip-relative prose prompted the explicit offset label above. The larger-file path and a silent-clip caption returned HTTP 503; successful live large-file analysis remains unverified. Repeat with `node --import tsx scripts/dev/live-video.ts --live --corpus PATH` to the generated synthetic experiment corpus. `--large` checks provider-file transport; `--inspection-only` isolates detailed temporal/authority cases. `--carry-budget EVIDENCE_DIR` preserves the earlier ten-call/fifteen-minute allowance across a manual change of scope. No automatic retries or personal recordings are used. Full verification: `pnpm verify`.

Live completion of the combined caption/transcript/`actionItems` request remains unverified: its one-call, five-minute smoke check reached the test deadline without a completed result. Run `--recording-draft-only` to isolate that bounded check. Controlled-provider and desktop coverage establish draft handling independently of live availability.
