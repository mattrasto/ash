# Visual recording context for Adapt

Scope accepted, 2026-10-23 · Implemented · Validation below

Deliver one complete path: initial frames and transcript context, followed by tools to inspect further when needed. Product behavior and acceptance cases are canonical in [VID-R20–24 and VID-A22–27](../../specs/features/recording-feedback.md#adapt-recording-feedback).

## Architecture baseline

Includes the Adapt baseline at `05296a0` and scene integration at `a508745`. The [Adapt implementation](../features/adapt.md) now includes Thread routing, automatic handoff, native renderer previews, local application and parallel Workspace refresh. This extension adds visual recording context to those paths.

Managed Codex runs in a hosted environment. Ash owns Threads, Runs, Decisions, checkpoints and evidence. `Adapt.input()` in `packages/server/src/modules/adapt/service.ts` already forwards image pixels through `CodingInput`; `platform/adapt/codex.ts` translates them into provider inputs. Recording context adds locally extracted pixels to the existing bounded caption/transcript text.

The harness exposes `ash_ask_user`, `read_video_evidence` and `ask_video`. Human questions use Decisions; recording reads use the existing tool-call/result records. Provider session/turn/call identifiers remain in the private execution controller.

## Implementation

### Initial context

Prepare four evenly spaced initial frames during upload, before narration analysis completes. Further inspection can use the stored transcript timestamps to select an interval. Reuse the current video-analysis result; no new action-item schema, moment IDs or semantic selection pass is required. Preserve actual frame presentation timestamps and the source/transform references under VID-R02 and VID-R05.

Use the same recording-context composition for manual submissions and automatic handoff. Preserve the original context selection, completed tool observations and required user answers that handoff already captures. Use ordered text/image parts in `CodingInput`, placing a recording/time label beside each image. Keep file references and hashes in the captured request; resolve bytes at the provider boundary. Include available transcript excerpts with explicit truncation and access to the stored remainder. Current user instructions take priority over history and supplementary visual context.

Reserve the existing image budget for attached images, then allocate recording frames newest first without repeating the same recording. The default is four initial samples and three on-demand samples (maximum four per call). Frames fit within 2560 pixels and 600 KiB each; initial input retains the existing eight-image/16 MiB budget. Tool metadata is bounded to 32 KiB and the encoded delivery to 3.5 MB. Representative recordings still need to validate the sampling defaults.

### Recording fields and persistence

Extend existing message/request and evidence records with recording identity, selected frames/times, transcript revision and known origin. Retain the generated draft alongside the submitted text where needed to distinguish user deletions. Resolve initial evidence before provider submission and capture its exact references through the existing request/artifact lifecycle; never mutate a historical capture to insert late results. Preserve readers for recordings without the new fields.

Reuse attachment reference retention, cancellation and retry handling. Migration `202610230002_recording_frames` permits updating only the frame cache/error inside attachment metadata; a database trigger preserves source descriptors and capture origin. Add a separate record only if an existing schema or lifecycle cannot preserve the required capture; this plan does not prescribe a new `coding_input` Artifact or manifest subsystem.

Pass already-known Workspace/preview identity through the trusted return-to-Thread path and existing recording journal. Keep that historical origin separate from the `coding_request` base and starting checkpoint under VID-R23.

### Evidence tools

| Operation | Implementation |
| --- | --- |
| `read_video_evidence` | Return stored transcript passages or locally extracted frame images for an original-timeline interval. No model call or crop mode. |
| `ask_video` | Adapt the existing question/search service for interval interpretation, motion or locating a relevant event. Retain its current processing bounds. |

The pinned SDK accepts image parts in tool results, but the synthetic hosted test found that those pixels were unavailable to the coding model. The verified delivery queues a labeled image message **before** the text tool result in one idempotent event batch. The label identifies it as supplementary evidence, not a new user request. `platform/adapt/codex.ts` owns this provider-specific translation. Repeat the three-minute synthetic check with `node --import tsx scripts/dev/live-recording-context.mjs --live`; it uses a hosted environment with networking disabled. See the [managed function protocol](https://developers.openai.com/api/docs/guides/agents-api/tools/functions).

Scope resolution must support both manual coding requests and automatic handoff via `state.adapt.requestArtifactId`. Reuse the video service with the captured attachment scope rather than parsing a `coding_request` as an ordinary `RequestPayload` or creating a second chat Run. Reuse common authorization and call/result persistence where compatible; do not introduce a nested model loop or a general framework for exposing all Ash tools.

Persist call identity, arguments, result and delivery state using existing evidence conventions. Reconcile pending calls after disconnect and deliver saved results. Apply cancellation and paid-request deduplication at the service boundary. The coding environment receives selected pixels/text through the adapter, without Ash credentials or personal storage mounts. Additional model usage belongs in existing usage inspection.

### Code boundaries

| Area | Responsibility |
| --- | --- |
| `packages/server/src/modules/video` | Frame extraction, transcript reads and reused video questions |
| `packages/server/src/modules/adapt` | Context composition, scoped external calls and restart reconciliation |
| `packages/server/src/platform/adapt/codex.ts` | Provider image inputs, external calls and tool results |
| `packages/shared/src/contracts` | Structured message/request fields and compatible captured schemas |
| Existing composer, viewer and inspector | Preparation/failure feedback and inspection of supplied evidence |

## Verification

Implement and ship initial context and further inspection together. Exercise the spec's acceptance cases with real media fixtures, known frame times, PostgreSQL/storage and controlled providers. Extend the deterministic coding adapter with evidence calls and lost-acknowledgement recovery. Verify manual and automatic Adapt entry, retained pre-handoff answers/results, historical origin after Workspace refresh, cross-Thread denial, cancellation, duplicate Send and restart with the same saved evidence.

Run a separate bounded live check for image tool results and a synthetic recording → coding → native preview correction. Compare against today's text-only handoff for missed requests, incorrect visual targets, corrective user effort, latency and usage. Paid checks stay outside routine verification.

Any changes to the existing UI follow the shared design system: relevant DS-R03–05/R08–13 and DS-V02/V07/V08/V10 for focus, long content, reduced motion and narrow windows. Use `pnpm verify --profile quick` while iterating, then the relevant `adapt`, `adapt-routing-refresh`, `video` and `video-understanding` groups with the new acceptance scenarios. Follow the [testing policy](../testing.md#commands) for the required full gate before integration; freeze source during checks, review the diff and explore the actual app before handoff.

## Validation status

- Passed the approved `scripts/dev/live-recording-journey.ts --live` check in 169 seconds: one hosted coding Run retrieved a brief card absent from initial samples, read its random text, edited only the requested paragraph and preserved the title despite the generated draft asking to delete it. Candidate quick verification passed; the native preview was opened and visually checked. Local evidence: `out/recording-journey/2026-10-23T21-08-32-785Z/`.
- Full automated verification of the rebased implementation at `fc12e54` passed 186/186 checks with unchanged source and all 121 cleanup checks passing. Separate app exploration preserved the reviewed draft, supplied initial/on-demand frames and playable timestamps, and found no renderer errors or horizontal overflow. Final integration follows the [required gate](../development.md#git-integration).
- Representative recordings still need sampling-quality calibration: missed details, corrective effort, latency and usage. The successful coding check used controlled narration; [live caption/action-item verification limits](../features/recording-feedback.md#understanding-checks) remain separate.

## Integration

Keep one feature commit and follow the [Git integration requirements](../development.md#git-integration). If another feature lands first, rebase and verify the combined revision. Preserve Adapt-only recording, persistent Stop/Discard, reviewed recording fields and screenshot recovery when reconciling composer changes; regenerate and inspect combined chat baselines.

Retain verification evidence and preview data/configuration when retiring the worktree. The recording metadata migration and runtime grant must stay paired: the grant allows frame-cache updates, while the trigger protects source identity and historical origin. Git rollback alone cannot reverse the migration.
