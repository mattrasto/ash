# Screen recording and video understanding

Recording and Flash understanding implemented, 2026-10-14 · Native macOS capture verified · Adapt visual feedback implemented, 2026-10-23; [validation status](../../docs/plans/recording-visual-context.md#validation-status)

## Goal and scope

“Record with comments → send to agent”: capture a demonstration in a Thread, then let Ash inspect it with a video understanding tool.

**Accepted sequence, revised 2026-10-23:**

1. **Video attachments and screen recording:** support video files in chat as the foundation; a button in an Adapt Thread records the screen and adds the resulting video to the composer for review and Send. Picking or dropping an existing video uses the same attachment path.
2. **General video understanding:** automatic captions, a description tool and a question/search tool, with timestamped understanding and inspectable evidence. Recorded clips use these capabilities to summarize narrated action items.
3. **Adapt visual feedback:** supply initial recording frames and transcript context to the coding agent, with access to further evidence in the same delivery under VID-R20–24.
4. **Live Mode:** eventually incorporate screen recording into Live Mode.

Capture and general video understanding remain independent of the [Adapt coding workflow](adapt.md); the Adapt handoff connects them to coding. [Asha reference review and engineering constraints](../../docs/features/recording-feedback.md).

## Step 1 — Screen recording

### Accepted flow

1. Click **Record screen** in the current Adapt Thread to start with the configured defaults. No per-recording source/microphone setup step. Microphone audio defaults on, with a remembered setting to disable it. Capture fallback and platform feasibility follow VID-Q07.
2. Record with a visible recording indicator, elapsed time and Stop/Discard controls that remain reachable while using the recorded application. Near the automatic stop deadline, warn and offer uninterrupted extension under VID-R14.
3. Stop finalizes the clip and adds a playable attachment to the originating Thread's composer. Background analysis prepares editable action items under VID-R18; review them and the clip before Send.
4. A submitted clip remains playable in the chat after reopening Ash.

### Attachment and capture rules

Video UX under VID-R13 and the extendable deadline under VID-R14 are accepted. Remaining rules describe implementation defaults; format and byte limits remain VID-Q09.

- **VID-R01 — Source:** retain a playable, immutable original with a stable attachment identity for imported and recorded videos. Derivatives identify their source; do not substitute selected frames or a summary for the original recording. Source ownership and cleanup depend on VID-Q06.
- **VID-R08 — Capture control:** show the composer recording button only in Adapt Threads. Switching modes or Threads during capture leaves the recording status and floating Stop/Discard controls available; the destination stays fixed. Begin capture only from the user's recording action, using saved defaults without an application setup dialog. The floating indicator is draggable from its non-button surface, with a visible grip; moving it does not change the capture source or interrupt recording. Show starting versus recording state, the actual captured display/source and microphone state; elapsed time begins when capture starts. Stop or Discard releases capture immediately; finalizing/uploading a clip does not keep recording. Cancellation or Quit during startup must not wait for unresolved OS consent; release any stream granted after cancellation without restarting capture. Handle required OS consent explicitly. Source fallback and the feasibility of avoiding a recurring OS picker follow VID-Q07.
- **VID-R09 — Destination:** bind the recording to the Thread where it began. Switching Threads cannot silently redirect the finished video. Recording concurrency, navigation and app-close behavior follow VID-Q08.
- **VID-R10 — Attachment:** picking/dropping supported video files and finishing a recording use the same attachment lifecycle, validation and upload path. Show a thumbnail, duration and preparation/upload state; preserve existing draft text, attachment order and per-Thread drafts. Prevent submission of an unfinished or failed clip; let the user retry attachment preparation/upload or remove it. A lost upload acknowledgement must recover the same clip after reopening without duplicating the attachment or its analysis. Do not silently omit video from a sent message. Source identity follows VID-R01; format and size limits remain VID-Q09.
- **VID-R11 — Capture failure:** permission denial or source loss is visible. A failed attempt must not appear as a successful recording. Where a partial clip is recoverable, label it incomplete and allow review before submission; otherwise explain that no usable clip was saved. Crash recovery and retention follow VID-Q06 and VID-Q08.
- **VID-R12 — Before understanding:** recording, finalization and upload do not invoke video analysis or transcription. If a chat response is requested before the understanding tool exists, supply the accompanying text and labeled attachment metadata with an explicit video-content-unavailable marker. Ash must not imply it watched or heard the clip. Video-only submission behavior follows VID-Q01.
- **VID-R13 — Video viewing:** use Asha's compact video thumbnail with play and duration badges in the composer and chat. Click to open a full-size player with playback, seeking, volume, Escape-to-close, attachment navigation and a filmstrip shared with images. Save/download is available with visible feedback. Stop playback on close or navigation; playback controls retain their own keyboard behavior. Show a muted looping composer preview on hover/focus, with a static thumbnail under reduced-motion preferences. Playback in the transcript requires an explicit open action; loading media preserves reading position.
- **VID-R14 — Extendable deadline:** initially stop automatically after 10 minutes unless the user extends while recording. Implementation defaults: show a persistent warning with the remaining time one minute before the deadline, and an **Extend by 10 minutes** action that adds to the current deadline. Keep warning and extension reachable while another app is foreground without stealing focus. Extension does not pause, restart or split the recording, reset total elapsed time or request capture setup again. Repeat the warning before each extended deadline; repeated extensions are allowed. Without extension, stop capture at the deadline and finalize the clip into the originating Thread's draft for review, with visible automatic-stop feedback. This prevents forgotten recording without forcing an interruption during an intentional walkthrough.

### Capture acceptance examples

Automated coverage and native checks are recorded in the [implementation](../../docs/features/recording-feedback.md#verification).

| ID | Example | Expected result |
| --- | --- | --- |
| VID-A08 | In an Adapt Thread, click Record screen with permissions available, record a short demonstration, then stop. | No application source/microphone setup interrupts starting. Stop adds a playable draft attachment; it is posted only on Send and remains playable after submission and restart. Any platform-required picker is a documented constraint. |
| VID-A09 | Switch to another Thread during recording. | The clip remains associated with the originating Thread and never appears in the other Thread's draft or messages. Ordinary Threads hide the composer recording button; active Stop/Discard controls remain reachable. |
| VID-A10 | Deny capture permission, lose the source or discard a recording. | Recording state accurately reflects the outcome; capture is released and no successful clip is fabricated. Recoverable partial media is labeled. |
| VID-A11 | Finish a recording while draft text and images already exist. | The video is added without losing existing content; a preparation/upload failure remains visible and blocks sending that clip. |
| VID-A12 | Record and attach a clip before the understanding tool is delivered. | No transcription or video-analysis call occurs. Any response identifies video content as unavailable rather than inventing an interpretation. |
| VID-A13 | Pick or drop a video beside an image, then add a recorded clip. | All attachments preserve order, use the same upload/retry/remove behavior and remain associated with the correct Thread. Unsupported or corrupt media is rejected visibly without losing the draft. |
| VID-A14 | Preview a video from the composer, then reopen it in a submitted message. | Play/duration badges, full-size playback, seeking, audio, Save and mixed-media navigation work; closing or changing attachments stops playback. Reduced motion and keyboard playback controls remain usable. |
| VID-A15 | Leave a recording running without extending. | A warning appears at nine minutes, including while another app is foreground. At ten minutes capture stops, microphone capture is released and the clip is finalized into the draft without being sent. |
| VID-A16 | Extend at the warning, then extend again near the next deadline. | The deadlines advance to 20 and then 30 minutes. Each deadline has a one-minute warning; elapsed time remains cumulative and the same clip continues without interruption or renewed setup. Ignoring a later warning stops and preserves the entire clip. |

## Step 2 — Video understanding

Start with general video support; the recording workflow composes these capabilities rather than requiring a separate understanding engine.

| Rule | Accepted capability |
| --- | --- |
| **VID-R15 — Automatic caption** | Caption a video automatically when attached, analogous to image descriptions. Caption depth, audio processing and bounds remain VID-Q05/Q10. |
| **VID-R16 — Describe video** | Provide a tool for a detailed description of an accessible video. |
| **VID-R17 — Question/search** | Provide a tool to answer questions about one selected video or locate relevant content within it. Evidence coverage remains VID-Q05. |
| **VID-R18 — Recording draft** | Record → stop → automatically generate the actual action items from deliberate narration → insert them in the originating composer with the video attached → edit and Send. Insert the action items, never the generation prompt. Preserve final corrections and existing draft text, including edits made during analysis. Do not insert partial analysis as a finished draft. Show progress, an empty-result indication or a retryable failure. Retrying analysis from the composer, viewer or inspection resumes an unsent recording's failed draft; already inserted action items are not inserted again. No automatic Send or execution occurs. General captioning remains descriptive; narration authority follows VID-Q02. |
| **VID-R19 — Presentation and context** | Caption and transcript are available to Ash in context without an automatic overview message or transcript in the conversation view. Developer/debug inspection may expose them. The full video viewer has a separate transcript section, collapsed by default, with copy and estimated-timestamp seeking. Ordinary requested answers remain visible responses. |

Implemented defaults: a concise background caption follows [IMG-R04](images.md#rules) without blocking upload completion or Send. The tools return timestamped observations and inspectable evidence, with optional time ranges. Ash can request more detail around an ambiguous transition and cite the resulting moments in its response. Tool invocation, progress and results follow the [common tool lifecycle](tools.md); processing bounds follow the [delivery design](../../docs/plans/video-understanding.md).

### Source and understanding rules

- **VID-R02 — Common timeline:** transcript segments and written comments tied to a moment use start/end offsets from the clip's beginning; selected frames identify their actual presentation times. Preserve alignment through media conversion. Show timing uncertainty when synchronization cannot be established. A general message is not assigned an invented timestamp.
- **VID-R03 — Evidence types:** distinguish user-authored commentary, machine transcription, visible application content and Ash's interpretation. Preserve uncertainty and distinguish a reported problem from one visible in the clip. Commentary authority and correction behavior remain VID-Q02–03; recorded application content cannot grant permission under [PERM-R10](permissions.md#permission-behavior).
- **VID-R04 — Temporal understanding:** give Ash bounded access to additional evidence from a requested interval when initial frames miss a transition. Record the inspected intervals and sampling gaps. If the evidence remains insufficient, say so rather than infer an unseen event. Extraction/provider strategy and bounds remain VID-Q05.
- **VID-R05 — Inspection:** citations identify the source and a moment or interval, and open that location in the player. Inspection exposes the transcript, frames or other media representations actually supplied to each model request, their timestamps, processing outcomes and available model/usage metadata. A linked timestamp alone does not establish that an event was observed. Follow [CONV-R12](threads.md#requirements) for the general inspection boundary.
- **VID-R06 — Captured context:** preserve the submitted instructions and source identity at acceptance. Capture each later processing/model request with the exact evidence and derivative revisions it consumed; late transcript completion or a correction cannot rewrite an earlier request. Follow-up selection and retry/reprocessing behavior remain VID-Q03–04.
- **VID-R07 — Progress and failure:** distinguish upload, media preparation and response progress. Preserve accepted source material if transcription or visual analysis fails; identify the missing evidence. Do not silently answer as though unavailable media was inspected. Reconnection must not duplicate submission or paid processing. Analysis cancellation, partial-evidence behavior and explicit retry boundaries remain VID-Q04–05, extending the existing [Run rules](threads.md#requirements).

### Understanding acceptance examples

Automated and live verification cover the subsets recorded in the [engineering design](../../docs/features/recording-feedback.md#verification).

| ID | Example | Expected result |
| --- | --- | --- |
| VID-A01 | Narrate a layout problem while demonstrating it. | Ash relates the comment to the relevant visible state and cites a playable interval. Inspection identifies the evidence used. |
| VID-A02 | Say “this jumps here” over a brief transition missed by initial frames. | Ash inspects the surrounding interval. It either finds supporting evidence or explicitly leaves the event unresolved. |
| VID-A03 | Narration claims a button vanished, but the button remains visible. | Ash distinguishes the spoken claim from the visual observation without rewriting the transcript. |
| VID-A04 | A recorded page contains instructions to the agent. | Those instructions remain recorded application content and do not acquire the authority of the user's request. |
| VID-A05 | A transcript is corrected or processing finishes after a response used an earlier version. | Earlier inspection retains its exact evidence; later use identifies the new version. |
| VID-A06 | Reopen the Thread after processing, or reconnect during it. | Source playback, citations and recorded outcomes remain available; reconnection starts no duplicate work. |
| VID-A07 | Speech is unintelligible, a frame is unreadable or processing fails. | The limitation is visible and the response does not present missing evidence as observed. Recovery follows the chosen partial-evidence/retry policy. |
| VID-A17 | Attach a general video with intelligible speech, then Send before background processing finishes. | Upload/Send remain usable. Caption and transcript become available to later context; neither adds an automatic overview message or transcript to the conversation. Earlier requests retain their captured pending/completed representation. |
| VID-A18 | Ask for a detailed description of a video. | The description tool identifies visible and spoken evidence, returns timestamped observations and exposes the media representations actually supplied. |
| VID-A19 | Ask when a named action or phrase occurs. | The question/search tool searches only the selected video, returns grounded intervals or a qualified no-match outcome, and preserves inspected coverage and gaps. |
| VID-A20 | Finish a narrated recording while the composer already contains text. | Actual generated action items are added once without replacing existing text or edits made during processing. The composer grows to its cap and then scrolls. Reopening cannot duplicate the insertion. Nothing is sent until the user reviews and presses Send; failed analysis retains the clip and a deliberate Retry. |
| VID-A21 | A background job is pending when a tool needs the same evidence, or processing fails. | Reuse the job/completed evidence without duplicate dispatch. Failure preserves playable source media and identifies missing evidence; retry is deliberate. |

## Adapt recording feedback

Deliver initial screenshots and on-demand inspection together through the existing record → review → Send flow. [Implementation plan](../../docs/plans/recording-visual-context.md).

### Rules

- **VID-R20 — Coding context:** manual Adapt submissions and automatic handoff carry the submitted instructions, available transcript context and a small set of readable timestamped frames to the coding agent. Preserve access to omitted transcript passages and frames; the action-item summary must not be the only route to the recording. Initial selection uses basic sampling and available transcript timestamps, without a mandatory additional model call. Frame count and allocation are engineering defaults to validate, not a requirement to include every moment initially.
- **VID-R21 — Reviewed intent:** submitted instructions take precedence over generated action items and original narration. Narration may clarify the request but cannot restore an action the user deleted or contradicted in the reviewed draft. Preserve final spoken corrections across segments. A consequential ambiguity uses the existing Decision flow; source authority otherwise follows VID-R03 and VID-Q02.
- **VID-R22 — Further inspection:** the coding agent can retrieve more frames or stored transcript passages and ask about an interval through Ash's video service. Restrict access to the Run's captured recording references and current Thread access. Evidence reads run automatically within that scope; actual questions for the user use Decisions. Temporal coverage, captured evidence and recovery follow VID-R04–07, including no duplicate paid processing after reconnect. Store the structured recording references and results in existing message/request and evidence records; a separate recording-evidence system is not required.
- **VID-R23 — Known origin:** retain the originating Thread and, when already established, Workspace and preview version with the recording. These are context fields, not a guarantee that every frame shows that preview. Keep this historical origin separate from the source used for coding; later preview updates or [Workspace refresh](adapt.md#rules) do not rewrite it. Leave unavailable origin information unknown. Capture remains in the controlling Ash instance; candidate previews gain no capture permissions or native bridge.
- **VID-R24 — Existing presentation:** retain the editable draft, playable attachment, viewer and inspector. Show supplied frames and processing limitations through existing inspection; no dedicated Visual context panel, required frame selection or crop controls in the first delivery. Recording-button visibility follows VID-R08; existing videos can still be attached and viewed in ordinary Threads. Supplementary frame-preparation failure preserves the draft and usable video, identifies missing visual context and offers retry or explicit sending without those frames; failed upload/preparation of the video itself still follows VID-R10.

### Deferred refinements

Scene-change detection, elaborate frame deduplication, precise action-to-frame linking, manual frame selection, crop controls, application detection, tracking preview-version changes during recording, and click/accessibility telemetry. Audio-only dictation remains deferred; Live Mode follows its separate scope below.

### Acceptance examples

| ID | Example | Expected result |
| --- | --- | --- |
| VID-A22 | Send “make this gap match that one” through manual Adapt or automatic handoff, including after answering a required question. | The coding agent receives readable timestamped pixels with the request and transcript context; automatic handoff retains the original context and completed answers/results without another Send. The existing viewer/inspector remains the review surface. |
| VID-A23 | A brief jump or a late visual reference is absent from the initial context or action summary. | The coding agent can retrieve the relevant interval, frames or transcript and use video questioning if needed; unresolved evidence stays explicit. |
| VID-A24 | Narrate a correction across recording segments, then delete or change a generated action before Send. | Coding follows final reviewed intent and does not restore a superseded or deleted request from the narration. |
| VID-A25 | Reconnect after an evidence result was saved but delivery was not acknowledged. | Resume the same coding Run/call with the saved result; do not repeat the paid analysis or replace earlier evidence. |
| VID-A26 | Record feedback while several Workspaces exist, with or without known preview origin, then update the preview or refresh the Workspace. | Preserve the fixed Thread and original established origin separately from the current coding source, leave unknown fields unset, and reject requests for another Thread's recording. |
| VID-A27 | Supplementary frame extraction fails, or requested evidence is unavailable. | Retain the draft and usable source, expose the limitation and recovery path, and never imply missing images were inspected. |

## Decisions and remaining scope

### Before screen recording

- **VID-Q01 — Sending · step 1 implementation default:** before understanding exists, a video-only message is retained without starting an answer; show that video understanding is not yet available. Accompanying text or images use ordinary response behavior under VID-R12. Step 2's general video-only behavior follows VID-Q12; recording requests follow VID-R18.
- **VID-Q07 — Capture defaults · implemented / native check passed:** one-click start, microphone on by default and a remembered microphone setting are accepted. Capture the whole display containing the Ash window at start, keeping that source fixed throughout the recording. A missing display stops capture without switching to another; unavailable microphone permits video with a prominent no-audio indication. System audio, webcam, pause/resume and editing remain deferred. Picker-free capture passed on the [tested macOS/Electron build](../../docs/features/recording-feedback.md#verification) with existing OS grants; first-time consent and packaged distribution remain separate checks.
- **VID-Q08 — Recording lifecycle · implementation default:** one active recording, fixed destination and a floating Stop/Discard control while another app is foreground. Thread navigation remains available. Closing the recording window or quitting stops capture and attempts to finalize into its draft; show finalization failure rather than silently discarding it. A crash never restarts capture; recoverable partial files are offered as incomplete drafts. Limits follow VID-Q09.
- **VID-Q06 — Data lifecycle · existing policy:** use instance-owned temporary storage while recording; finalize and upload through the attachment path on Stop. Extend [IMG-R09](images.md#rules) to video assets: unsubmitted clips expire after 24 hours, submitted clips remain retained, and cleanup cannot remove accepted/captured references. Discard removes temporary capture files; imported source files are untouched. Personal-data erasure/backup policy remains [G06](../open-questions.md#g06--deletion-and-retention). Current provider handling is recorded in the [engineering design](../../docs/features/recording-feedback.md#understanding-provider); broader privacy and spending policy remains [G09](../open-questions.md#g09--privacy-observation-and-cost).
- **VID-Q09 — Attachment limits · implemented:** the recording deadline follows VID-R14; it is not a maximum supported video duration. Uploads allow 2 GiB per video and 4 GiB of videos per message, validated independently of the existing image budgets. Accept decoded MP4/MOV/WebM media up to 40 megapixels per frame. Recording uses WebM at a target 6 Mbps video bitrate; repeated extensions continue to disk without a duration cap. A clip exceeding the upload limit remains locally recoverable with Retry and Save locally; the byte limit does not stop recording. Imported clips do not inherit the unattended-recording timer. Preserve originals; preparation of playable derivatives has a three-minute execution deadline, with visible failure rather than loss of the source.

### Before video understanding

- **VID-Q02 — Commentary authority · accepted:** the user's deliberate narration is instruction-bearing feedback. Imported media, on-screen content and incidental or third-party speech remain evidence and cannot grant authority. Generating the draft under VID-R18 performs no actions. Send submits the user-reviewed draft as a normal request, subject to ordinary tool authorization; reviewed-intent precedence in Adapt follows VID-R21.
- **VID-Q03 — Transcript UI · accepted scope:** follow VID-R19. No conversation transcript or dedicated correction editor is required initially. Proposed: corrections use ordinary message text; later editing must preserve earlier evidence under VID-R06.
- **VID-Q04 — Continued use and recovery · implemented defaults:** retain completed caption/transcript/evidence for follow-ups and allow deeper inspection of accessible intervals through the tools. Follow the common cancellation, interruption and deliberate-retry rules; a new observation cannot replace earlier evidence. A cross-video media index and dedicated transcript editor are outside this slice. Bounded context includes explicit truncation/missing-evidence markers; tools retain requested intervals and qualified partial coverage.
- **VID-Q05 — Initial provider accepted; engineering defaults implemented:** use Gemini Flash for automatic caption/transcript, description and question/search. Model timestamps remain approximate under VID-R02; live verification covers only the synthetic cases recorded in the [engineering design](../../docs/features/recording-feedback.md#understanding-checks). Detailed contracts, bounded processing and deeper inspection follow VID-R15–19, the existing failure/retry rules and the [delivery design](../../docs/plans/video-understanding.md). No hard per-video cost ceiling was specified; do not assume frame sampling captures every event.
- **VID-Q10 — Audio processing · implemented:** generate the brief caption and full narration transcript in the background when attached. General imports do not block Send; the recording workflow waits for its draft under VID-R18. [Asha's code](../../docs/features/recording-feedback.md#asha-reference) requests both in one pass, without timestamps. Ash adds estimated transcript offsets under VID-R02 and caches completed processing for subsequent questions/search. Generated narration remains distinct from verified source speech. Context/UI follows VID-R19; provider strategy, accuracy and bounds remain VID-Q05.
- **VID-Q11 — Recording draft · revised 2026-10-14:** VID-R18 supersedes the initial prompt-insertion interpretation. New recordings prepare the actual action items before Send. Existing unsent recordings can use **Generate action items**; an unchanged legacy prompt is replaced while surrounding text is preserved.
- **VID-Q12 — General video-only messages · accepted UI / implementation default:** do not generate an unsolicited description message under VID-R19. Implemented: retain a general video-only message without a response Run, with its caption/transcript available to subsequent context. Accompanying text and the reviewed recording draft use ordinary response behavior. This extends the stored-only behavior of VID-Q01 beyond step 1.

The [provider and processing design](../../docs/features/recording-feedback.md#understanding-provider) records the initial Flash choice and partial experiment. Video understanding is implemented; provider availability and measured accuracy remain explicit verification limits.

## Live Mode integration

Accepted future direction: incorporate screen recording into Live Mode. Keep capture and media handling reusable independently of the Adapt Thread button. Continuous understanding, Live Thread routing and capture lifecycle need a later design following the [Live Mode intent](../HUMAN_SPEC.md#live-mode); this step creates ordinary chat attachments and does not introduce Live Threads.
