# Adapt implementation

Thread workflows and local UI application implemented · Verification coverage below · [Behavior](../../specs/features/adapt.md) · [Later delivery](../plans/adapt-workflow.md#delivery-sequence)

## Try it

Run `pnpm dev:setup`, then `pnpm dev`. The normal development preview reads its owner-only OpenAI key and uses managed Codex for Adapt. Agents API access is required. `pnpm dev --deterministic` explicitly selects the offline coding fixture; it never falls back silently from a live failure.

An already-running launcher from before local application was added needs one `pnpm dev:stop`, then `pnpm dev`. The UI reports this prerequisite instead of offering an unsupported update action.

Ask Ash to make an app change in an ordinary Thread. The assistant can enter **Adapt** and hand off that same request, context and attachments. Discussion stays in chat. You can also select **Adapt** manually, describe a change or attach a recording, then Send. Answer required questions in Decisions. **Changes**, **Checks** and **Inspect Run** share the existing inspector. After a completed renderer change, **Run preview** opens a separate marked native window with synthetic data. It follows subsequent completed checkpoints automatically; **Update preview** also transfers a newer checkpoint explicitly. **Refresh** reloads the window. **Stop agent** stops coding; **Stop** ends the preview. Closing its native window also ends the preview, retaining test data. The Workspace always shows preview status and hides Refresh/Stop when closed.

**Apply… → Prepare update** creates a frozen local UI build. Protected compilation and persisted-chat checks run before an application Decision appears. **Apply and restart** uses that exact build with the current backend, native shell and daily data. **Restore previous version…** prepares a separate restore approval. See [local application](#local-application) for scope and recovery.

The native **Adapt → Back to Thread** menu (`⌘⇧B`) returns to the controlling Thread. Record there using the existing screen recorder, review its generated action items, and send a correction. Capture retains its starting Thread even if navigation changes. Screenshot attachments also reach Codex as pixels. Recordings supply timestamped initial screenshots and captured narration, with reviewed message text taking precedence. The agent can retrieve further frames/transcript or ask about a video interval. [Visual recording implementation and validation](../plans/recording-visual-context.md). Dictation-only capture is deferred.

## Boundaries

| Owner | Implementation |
| --- | --- |
| Ash | `modules/adapt/service.ts`: submission routing, reconciliation, Decision dependencies, progress, immutable evidence and source history |
| Coding harness | `modules/adapt/contract.ts`: session creation/reconciliation, input, observations, ordinary questions, cancellation and checkpoint export |
| Environment provider | Same contract: prepare/readiness/release; lease generation is distinct from Workspace identity |
| Compatible binding | `platform/adapt/codex.ts`: managed Codex + OpenAI hosted environment; `deterministic.ts`: durable offline fixture |
| Native preview | `PreviewController`, `platform/adapt/local-preview.ts`, `scripts/dev/adapt-preview.ts`: separately owned local instances and candidate transfer |
| Local application | `ApplicationController`, `modules/adapt/applications.ts`, `platform/adapt/local-application.ts`; protected build worker `scripts/dev/adapt-release.ts`, supervisor `renderer-release-host.ts` and journal `release-store.ts` |
| Source import | `modules/adapt/source.ts`: exact Git archive, bounded patch, index/tree reconstruction; no candidate code executes during import |
| UI | `features/adapt/Workspace.svelte`, `Evidence.svelte`; Thread mode and existing inspection in `features/threads/Chat.svelte` |

Paths beginning `modules/` and `platform/` are under `packages/server/src/`; UI paths are under `packages/client/src/renderer/`. Provider SDK types and identifiers stay behind the adapters. Replacing a binding requires its old executions to be reconciled/closed first; a new lease restores the same durable checkpoint. Arbitrary harness/environment combinations are not promised.

### Managed protocol

Pinned SDK: OpenAI `7.43.0`. [Sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions), [hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) and [files](https://developers.openai.com/api/docs/guides/agents-api/environments/files).

One hosted environment is reused per Workspace generation; each Ash Run has a provider session containing the explicitly captured Ash context. Reconciliation uses durable dispatch intent, stable idempotency keys and Run metadata. Unknown session creation is looked up before any replacement. An environment acquisition older than 23 hours fails for explicit retry rather than exceeding the provider's idempotency retention. Expiry/cancellation invalidates the lease; the next Run reconstructs from the last exported checkpoint.

Source archives are capped at 96 MiB, including scene artwork, and uploads split them into 4 MiB files. Keep the complete Git tree so checkpoint reconstruction remains exact. Trusted bootstrap explicitly installs development dependencies, skips Electron/Playwright downloads and retains install diagnostics. Network access is restricted to npm, Prisma binaries and GitHub release download domains. Exported patch/tree/check evidence is bounded and reconstructed locally before becoming a checkpoint. Agent-reported checks do not authorize Apply.

Managed work routes ordinary `ash_ask_user` calls to Decisions and scoped `read_video_evidence`/`ask_video` calls to recording evidence; internal harness shell/file tools run in its preauthorized sandbox. Assistant output and usage are captured, private reasoning is not. Session closure is available; this hosted API has no force-destroy VM endpoint. Cancellation therefore does not claim physical VM teardown.

Interactive coding has no artificial call/time cap. Disposable live sessions reserve one allowance per coding Run and stop on their saved deadline; that allowance counts jobs, not the harness's internal model calls. The local broker reconciles cancellation while awake. Paid verification is separate from routine deterministic tests.

### Renderer preview containment

Accepted scope: UI changes first, with trusted backend, dependencies and Electron shell. The initial Run is explicit; automatic updates follow ADAPT-R09. Only ordinary files under `packages/client/src/renderer/` may differ from the source baseline; changed backend/native/configuration/dependency files and symlinks are rejected. A rejected update retains the previous preview and its Stop control.

The launcher never runs candidate installs, scripts, Vite/Svelte/TypeScript configuration, migrations, backend or Electron main/preload. `scripts/dev/protected-renderer.ts` bundles a trusted compiler worker and limits its Node filesystem reads to the credential-free source snapshot, shared contracts, installed dependencies and explicit trusted package metadata; writes stay in its output directory. This also covers CSS assets and `new URL` transforms, which bypass Vite module-loading hooks. Native previews serve the completed build instead of transforming candidate files in the unrestricted supervisor. Candidate native code cannot run in this preview. Nested package/TypeScript configuration, CSS imports/preprocessors and `import.meta.glob` remain unsupported. Public-directory copying, editor-launch endpoints, implicit PostCSS configuration and TypeScript configuration discovery are disabled.

The worker permits trusted Rollup native modules and esbuild subprocesses; candidate JavaScript is not executed by Node. This is a compiler input boundary, not an environment for arbitrary candidate build scripts. [Node permissions](https://nodejs.org/docs/latest-v24.x/api/permissions.html) document the distinction.

Electron retains `sandbox`, `contextIsolation` and disabled Node integration, omits the native preload, denies device/display permissions and external navigation, and filters requests to its own frontend origin. A denying proxy plus `disable_non_proxied_udp` blocks WebRTC's direct-network path. See Electron's [WebRTC policy](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwebrtciphandlingpolicypolicy) and [proxy API](https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig). An outer macOS seatbelt profile prevents Chromium's child sandboxes from initializing; it is not used and Chromium's sandbox is not disabled.

The trusted backend has separate synthetic PostgreSQL/files/browser storage, deterministic models, no provider credentials, no filesystem tools and no coding binding. This is a browser renderer boundary, not a VM for arbitrary native/backend changes. Native title and backend identity identify Workspace/checkpoint even if generated UI changes its own labels. The preview may only reflect renderer changes against the currently trusted backend/toolchain.

Preview intent, process identities and source are journaled under the parent instance's `adapt/previews/<Workspace>/`; separate development instance manifests own databases and process groups. Status checks the owned Electron process as well as its supervisor. Stop retains sample data. Parent reset/disposal also disposes its owned previews. Interrupted startup is recoverable; duplicate preview commands never dispatch twice. Preview capture tooling is restricted to authenticated background test instances.

Checkpoint completion records `previewPending` in the private Workspace controller in the same transaction. The coordinator reconciles it through `PreviewController.sync`, independently of provider-session closure. Sync only updates a running window, uses the checkpoint ID for idempotency, retains preparation across coordinator restarts and leaves rejected updates visible without retrying the same source indefinitely.

## Persistence

`threads.interaction_mode` selects future submissions. `adapt_workspaces` owns one Thread's pinned base, latest checkpoint and private provider lease/generation. `adapt_executions` journals a Run's external dispatch/session. FKs restrict deletion of referenced Threads/Runs; operational state is not ordinary context.

A `coding_request` Act freezes Workspace, base, starting checkpoint/tree, harness/model/configuration and bounded context before dispatch. A retry whose Workspace has advanced fails explicitly instead of silently using another source snapshot. Its Run owns progress, linked immutable Decisions and response Surface. Completion creates an immutable `coding_evidence` Act containing the full cumulative patch, tree and reported checks; the Workspace also points to its latest checkpoint. Historical evidence remains inspectable after later edits. Normal incoming processing remains on the ordinary execution path.

## Local application

Scope follows ADAPT-R11–13. Application installs a local renderer release; it does not merge Git source or update a signed package. The current trusted developer source must be checkpointed. Candidate patches are validated with the preview's renderer boundary and applied to the trusted app source; conflicting patches fail explicitly. This preserves the current app's infrastructure when a Workspace began from another `master` revision. Refreshing and combining independent changes follows the workflow below.

The protected worker uses trusted dependency/configuration paths, TypeScript/Svelte checks, a production renderer build, and fixed isolated Electron checks for chat persistence, draft retention and restart handoff. It never executes candidate scripts, installs, backend/native code, migrations or changed verification policy. The previous trusted UI is built and checked before the first approval. Agent-reported checks remain separate from these protected outcomes.

`adapt_preparation`, `adapt_candidate` and `adapt_application` Acts retain request identity, immutable build/verification evidence and application outcome. Their source links lead back to the coding checkpoint. The private Workspace controller journals preparation, Decision and outcome IDs. A permission Decision binds source/build/target/action; the external supervisor reads and validates its saved controls-only answer before switching. Candidate previews have no application controller or native bridge.

Versioned source/builds and atomic active/previous pointers live under the owning instance's `adapt/releases/`. The supervisor stays alive while Electron restarts; origin, database, files and browser storage remain the same. The native shell flushes browser storage and retains window bounds/fullscreen state before a graceful restart. Installation or recovery becomes confirmed only after startup checks. A failed or interrupted unconfirmed switch recovers the prior renderer. Backend/schema rollback is outside this renderer-only contract. Reset/disposal also reclaims owned verification instances and workers.

## Automatic entry and parallel changes

`modules/adapt/tools.ts` registers `adapt.start` for ordinary direct-user Runs. It routes the existing input, matching the manual Adapt submission boundary; it does not grant installation authority. Its database-only commit saves a new immutable `coding_request`, mode change, tool result and execution binding together. The Run's original `request_artifact_id` stays unchanged; `state.adapt.requestArtifactId` identifies the coding capture. Completed tool observations and required user answers accompany the handoff, with a 128,000-character budget and explicit omissions; original context selection stays intact. The handoff must occupy its own tool round after required answers arrive. Ordinary tool scheduling stops at that handoff. Restart reconciles the same coding execution. External intake cannot use this tool. The keyword-based trigger is only an offline fixture; the live assistant chooses the tool from conversation intent.

When another version is installed, **Apply… → Refresh Workspace** combines that source with pending Workspace edits. `ApplicationController.refresh` delegates Git reconciliation to `scripts/dev/adapt-refresh.ts`; coding harness and environment interfaces are unchanged. The protected release retains the exact Workspace checkpoint used to build it. Legacy local releases recover that checkpoint from their saved application job. Refresh allows 60 seconds for the local source reconciliation process; the UI waits 70 seconds so the controller can return its explicit timeout error.

The private Workspace controller records the last installed baseline and conflict paths. Git merges three trees: that baseline, current Workspace source and current installed source. A successful refresh saves a new immutable `coding_evidence` checkpoint, invalidates old approval and replaces the environment generation; future coding restores the combined source. Refresh never writes `master`. An older source base that cannot accommodate the installed checkpoint fails explicitly.

Conflicts remain visible in source and in the application inspector. **Resolve conflicts…** appends a request to the existing draft; Send uses the coding harness to resolve them. Conflict checks read Git blobs rather than candidate working files or symlink targets. A conflicted file must change or be deleted; unchanged non-text/delete-modify conflicts stay unresolved. Preview and application are blocked until known conflict markers disappear; restoring the previous installed UI remains available. UI actions stay pending until the saved outcome is reconciled. Clean refreshes follow the existing open-preview synchronization rule. Protected preparation and the external installer still verify the exact checkpoint and installed target before application.

## Verification

- `adapt-auto-entry`, `adapt-auto-recovery`: normal chat versus requested coding, exact original context/attachments, one Run/dispatch, restart and cancellation.
- `adapt-compiler-assets`: real Svelte/TypeScript production compilation with permitted local assets; CSS and JavaScript asset transforms cannot embed an outside canary.
- `adapt-refresh-parallel`, `adapt-refresh-conflicts`: real Git/DB, duplicate refresh, installed baselines, retained independent edits, conflict resolution and stale-target rejection.
- `adapt-parallel-apply`, `adapt-parallel-conflict-apply`: native automatic entry, Apply A, refresh/Apply B, both changes retained, minimum-size conflict review and draft-preserving resolution.
- `adapt-capture`, `adapt-decisions-restart`, `adapt-cancel-parallel`, `adapt-recovery`, `adapt-checkpoint-boundary`: real PostgreSQL/filesystem with controlled adapters, restart, unknown dispatch, expiry, provider replacement and immutable evidence.
- `adapt-native-preview`, `adapt-preview-protected-paths`: hidden real Electron, absent Node/native bridges, denied file/Vite/cross-instance access, no WebRTC UDP, isolated data retained over stop/restart, protected-path rejection and owned disposal.
- `adapt-preview-follow`: durable checkpoint delivery survives a controller failure/restart, waits for preparation and never opens a stopped preview.
- `adapt-desktop`, `adapt-decision-timeline`: keyboard mode switch, preserved editor/draft, Run/Refresh/Stop controls, explicit application status, chronological answered Decisions, inspection, reload and minimum-size layout. Shared design coverage: DS-R03–05, R08–13; DS-V02, V07–08, V10.
- `adapt-application-authority`, `adapt-application-stale`, `adapt-application-recovery`: real DB/Artifacts/Decisions with a controlled application boundary; deduplication, immutable evidence, controls-only approval, stale-source rejection and coordinator reconstruction.
- `adapt-local-apply`, `adapt-local-restore`, `adapt-local-startup-recovery`, `adapt-local-approval-drift`, `adapt-local-interrupted-apply`: protected production builds, hidden native restarts, post-update chat/draft retention, failed-startup recovery, installed/build drift and process exit after the durable version switch.
- `pnpm exec tsx scripts/dev/live-adapt.ts`: explicit paid production-adapter check; ordinary Decision across coordinator restart, hosted quick checks, validated native preview, screenshot feedback in the same Workspace, second cumulative checkpoint, owned cleanup. Evidence goes to ignored `out/adapt-live/`.

Signed distribution, arbitrary backend/native application, steering/queued coding, shared Workspaces and integration queues remain in the delivery plan.
