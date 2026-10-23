# Adapt workflow proposal

Direction confirmed, 2026-10-22 · [Threads, adapters, renderer preview and local application implemented](../features/adapt.md); parallel renderer updates implemented; source integration and distribution proposed

Build **Adapt as a mode on a Thread**. Reuse Threads, Artifacts, Runs, Permissions and Decisions; add Workspaces for isolated code changes. Make the everyday flow **record → review the change request → send in Adapt → try the preview → apply and restart**. Start with the managed Codex harness and hosted environments, with a local native macOS preview. Keep harness and environment integrations replaceable.

This develops the delegated-change slice in the [self-modification plan](self-modification.md). Accepted behavior lives in the [Adapt feature spec](../../specs/features/adapt.md); the sections below also describe proposed extensions. The [original intent](../../specs/HUMAN_SPEC.md#modifying-ashs-code), [delivery agreement](../../specs/product.md#confirmed-engineering-agreement), [Git integration rules](../development.md#git-integration) and [testing policy](../testing.md) remain authoritative.

## Implemented workflow

[Adapt implementation](../features/adapt.md) owns the code map, operating procedure and verification coverage for Thread handoff, managed coding, isolated renderer previews, protected local installation and parallel Workspace refresh. Recording uses the existing [feedback workflow](../../specs/features/recording-feedback.md); video reaches the coding harness as its captured caption/transcript.

## Product shape

An ordinary Thread can enter **Adapt** without moving its conversation or creating a second chat. Give it a visible mode badge and a development toolbar: **Run preview**, **Stop preview**, **Refresh**, **Open code**, **Open VCS**, **Changes** and **Checks**. Show these controls when relevant, with preparation/running/error states. The preview identifies its Workspace and source revision. Keep the ordinary composer, Topics, sidebar, Decisions and conversation inspection.

A Thread is the continuing conversation; a Workspace is one independently reviewable change. Start with one active Workspace per Adapt Thread and a separate Thread/Workspace for each independent change. After completion, the same Thread can return to ordinary conversation or start another Workspace. Retain the historical Workspace on its Runs and Artifacts instead of replacing their association. Shared investigation/review Threads can follow later. Adapt does not change the separate Live Thread lifecycle.

Capture the selected mode, Workspace, context, provider binding and authorization scope when each Run is submitted. Changing the Thread's mode affects subsequent input; it neither reroutes nor cancels an existing Run. Entering Adapt is not a permission grant. **Stop agent** cancels coding; **Stop preview** stops owned app processes; releasing an environment is a separate operation. A refresh reloads the current preview; a restart explicitly restarts its services.

| Concept | Responsibility |
| --- | --- |
| Thread | Conversation, feedback, references and selected interaction mode. |
| Workspace | One independently reviewable change, its Git state, previews, checkpoints and candidate history; independent of any provider session or VM. |
| Instance | A running environment and its data: persistent preview or disposable verification. Preserve the [existing definition](../development.md#workspace-and-instance-identity). |
| Run | One execution attempt, with progress, cancellation and recoverable state. A Workspace can have many Runs. |
| Task | Optional user-visible work item linked to a Workspace or Thread. The Tasks feature need not precede Adapt. |
| Decision | Required user input or authorization, including applying a particular candidate. |

Add an Adapt filter and attention indicators to the existing Thread list. Put file browsing, raw logs and terminal access behind secondary controls. A workspace overview can follow if concurrent work warrants it; it is not the primary destination.

Make routing and evidence selection explicit in the backend, not merely a sidebar filter or Topic. Preserve the Thread's conversation context across mode changes. Keep raw build logs, provider continuation and tool traces out of ordinary conversation/retrieval unless deliberately selected; retain inspectable links to them. Do not exclude a whole mixed-mode Thread from Topic retrieval just because it contains development Runs. Capture the supplied context under the existing instruction/context rules.

Adapt history belongs to the controlling Ash instance. Preview databases contain test data; resetting a preview must not erase the development conversation, Decisions or evidence. A preview’s **Give feedback** action hands a recording back to its owning Workspace through a narrowly scoped bridge. It cannot approve changes or control other Workspaces.

## Experience from capture to application

1. **Capture where the problem happens.** From ordinary Ash, choose **Improve Ash** and record the screen with narration; allow an existing recording/draft to be sent to Adapt too. In a preview, **Give feedback** targets that Workspace. Bind the destination when capture starts, retaining the existing fixed-destination behavior. Attach the running version, workspace/instance identity when applicable, and source fingerprint. A dirty preview cannot be identified by a commit alone.

2. **Review an editable change request.** Extend the current action-item draft with the requested outcome, relevant observations and constraints. Preserve corrections and negations; keep transcript and clip accessible. Ash may suggest acceptance examples, but label inferred requirements and uncertain observations. Sending authorizes work on this request; generating the draft does not. Typed input always works. Add audio-only dictation using the same draft path as a small follow-on, without requiring Live Mode.

3. **Start work in the Thread.** Enable Adapt on the current Thread, retaining its draft and history, or explicitly choose a new Thread for an independent change. The first Send creates its Workspace; retries reuse the same request identity. A follow-up uses the active Workspace. Prewarm while the request is drafted; record the base revision and refresh it explicitly if it becomes stale. Show actual preparation phases rather than a setup wizard. Preparation does not dispatch coding before Send. Ash asks only when a consequential ambiguity prevents useful work.

4. **Work while other Threads stay usable.** Stream a compact account of progress, with Stop agent and follow-up input. Show whether input was accepted as steering or queued. Surface Decisions when needed. The harness owns the edit/test loop within its granted environment. Closing the Thread does not cancel work. Hosted coding can continue while the Mac sleeps, but the local Decision broker and native preview are unavailable; reconcile on reconnect and show each component's status accurately.

5. **Try the result and iterate.** Transfer an identified source checkpoint to a separate local preview checkout. **Open preview** opens a distinct Electron window carrying **Preview · change name**, source identity and **Back to Thread**. Persist its sample data between iterations. Prefer the native app for desktop acceptance; browser previews can supplement it. Further recorded feedback returns to the same Thread. Show when the preview lags hosted edits; do not describe a transferred checkpoint as live remote synchronization.

6. **Prepare a reviewable candidate.** Ash presents the behavior change, a runnable candidate preview, check outcomes and any remaining manual check. Keep the code diff available without making it the default explanation. Freeze the source and build used for review; distinguish this candidate from a changing development preview. Further edits create a new candidate and retain the old evidence as history. The integration process below determines when a candidate is ready to apply.

7. **Apply through one concrete Decision.** The primary action is **Apply and restart**; **Keep working** returns feedback, and **Later** leaves the candidate unapplied. The Decision identifies the complete change from the installed version, target revision, candidate and runnable build. It is answered in the controlling Ash Thread or Decisions page; the candidate preview has no promotion authority. Preserve drafts and checkpoint or stop affected work before restarting. If installation fails after source integration, report **Merged, not applied** rather than treating those outcomes as identical.

8. **Confirm and retain recovery.** Reopen the daily app, restore navigation/drafts and show the installed version only after health and persisted-chat checks pass. Keep the previous compatible runnable version and an explicit **Restore previous version** action. Existing conversations and newly created data survive code rollback. Archive completed Workspaces recoverably; stopping, archiving and disposing their runtime/data are separate operations under the [development lifecycle](../development.md#reset-and-cleanup).

## Parallel work and integration

Use one branch and Git worktree per independently deliverable change. A worktree provides a complete checkout while sharing repository storage, so a full independent clone is unnecessary locally. Use independent clones in remote environments when shared Git storage is inappropriate. [Git worktree documentation](https://git-scm.com/docs/git-worktree).

Default the starting revision to current `master`, resolved to an exact commit when provisioning. Record the version from which feedback was captured separately. If installed Ash lags `master`, make that difference visible and reproduce against the reported version when needed. Never silently include another Workspace’s unfinished edits. For dependent changes, record the dependency explicitly and offer either waiting or an intentional branch from its candidate.

Allow several Workspaces to run concurrently, subject to configurable compute and spend limits. Start with one writing execution per Workspace; queue additional writers. Read-only review may run concurrently, but freeze source during verification. Multiple independent writers in one checkout are not needed for the first release.

Proposed source integration queue (separate from the implemented [local renderer installation](../features/adapt.md#local-application)):

1. Prepare one squashed feature commit on the latest target, following the existing Git rules. Preserve development checkpoints separately.
2. Run required checks and a separate review pass against that exact candidate and target. Use a verifier outside candidate-controlled source; changes to tests, baselines or verification policy need explicit review under the [self-modification testing requirements](../testing.md#product-and-self-modification-extensions).
3. Prepare the runnable build and review evidence, then request the application Decision. Approval binds to candidate revision, target revision, installed version, build digest and action.
4. Claim a durable application operation and take a short target lock. Recheck the target, installed version and build digest before consuming authorization. If another change landed, rebuild the integration candidate, rerun relevant verification and obtain a new Decision. Do not hold a repository lock while waiting for the user.
5. Fast-forward `master` to the approved commit and install the associated build through the external controller. Reconcile partial outcomes after a crash rather than replaying either operation blindly.

For example, A and B can both start from revision M and pass independently. After A lands, B must be checked against M+A before application, even if Git reports no textual conflict. This follows the same integration principle as [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue); hosted GitHub queues are not a dependency.

When installed Ash is behind the integration target, review must include all changes the installation would introduce. Reverting the running version does not rewrite `master`; removing an integrated change uses a new reviewed revert commit. Database migrations require a separate compatibility/recovery contract and stay outside the first demonstration.

## Harness and environment adapters

Keep Ash's product records and orchestration independent of the provider SDK. The [existing ModelAdapter](../../packages/server/src/platform/models/adapter.ts) streams model responses into an Ash-owned tool loop; a coding harness owns that loop itself and needs a separate boundary.

| Boundary | Responsibility | First implementation |
| --- | --- | --- |
| Workspace coordinator | Durable Workspace/Git identity, captured Runs/context, writer queue, checkpoint and candidate history; connects existing Artifacts, Permissions and Decisions. | Ash feature service. |
| Coding harness | Start/continue a coding session, stream and reconcile events, steer/cancel a turn, deliver external tool results, and expose source/check evidence through its bound environment. Provider session IDs and continuation stay adapter-private. | Managed Codex adapter. |
| Environment provider | Prepare/acquire an execution environment, report readiness, attach/reconnect, transfer source/checkpoints, stop owned services and release resources according to supported capabilities. No conversation or approval ownership. | OpenAI hosted adapter; local preview provisioning reuses Ash's launcher. |
| Preview controller | Run/stop/reload a particular preview, expose its source identity and links, and route captured feedback to its owning Thread/Workspace. | Native Mac preview. |
| Application controller | Protected verification, exact-candidate authorization, serialized integration, version switching and recovery outside the candidate/app process. | Local developer builds first. |

Separate contracts do not imply arbitrary harness/environment combinations. A provider may supply both through one binding. Resolve a compatible binding before provisioning and expose capabilities such as steering, prewarming, reconnect and forced teardown. Unsupported operations must be explicit; for example, the tested hosted provider can stop owned processes but has no standalone physical-VM deletion operation. Keep provider types out of Thread/UI contracts and normalize progress, waiting, evidence and terminal outcomes with durable event identities/cursors. Raw provider logs remain inspectable diagnostics.

Persist Ash IDs separately from environment lease/generation, provider session and turn IDs. Write dispatch intent before external effects; reconcile unknown outcomes using provider identity/idempotency rather than replaying blindly. The Workspace survives replacing either session or environment. Provider replacement preserves Ash history and exported source; it need not preserve the old model's private continuation or a VM's memory/database.

Verify these contracts against Codex and a deterministic second implementation that records calls and injects expiry/reconnect failures. This tests replacement without building an Amp integration now. Keep interfaces limited to exercised needs rather than abstracting every shell or filesystem operation.

## Execution boundary and lifecycle

Keep a small trusted supervisor outside the candidate checkout and outside the app process being replaced. It owns provisioning, process identity, reconciliation, protected verification and application. Product records remain in Ash’s existing core database; protected operational state must survive an app restart. The coding agent owns the edit/test loop but cannot write the supervisor, production data, signing credentials or promotion authority.

A worktree and separate database roles are not an execution sandbox. Prove filesystem, process, credential and network restrictions for both the coding worker and generated preview. Broker setup and selected provider credentials; do not expose the host Docker socket, developer home or daily-Ash credentials to generated commands. A Linux container can support some editing/testing, but it does not establish native macOS/Electron behavior. Selecting a workable macOS boundary is a feasibility gate, with a disposable macOS VM as an option if tighter local containment cannot support the required preview.

The completed experiment selected **managed Codex with OpenAI hosted environments**, not a local app-server process. Evidence lives in repository `ash_experiments`, branch `codex/managed-codex-experiment`: `managed-codex/results/2026-10-22.md` and `managed-codex/results/2026-10-22-latency.md`. Editing, native screenshot feedback, real Ash Decision resumption, parallel environment isolation and exported-source recovery passed. Production Run/Artifact integration, renderer-only native preview and protected local application are [implemented](../features/adapt.md). Signed delivery remains deferred.

Prewarm and reuse prepared environments; do not reinstall dependencies for every turn. Treat hosted runtimes as disposable: export source checkpoints after completed coding turns and before release, retain partial-work checkpoints when available, and reconstruct a replacement from the last durable export after expiry. Report unexported work as potentially lost. Reuse local preview dependencies and transfer identified candidates instead of cold-starting the full cloud app for every feedback cycle.

Reuse the [Decision continuation contract](../features/decisions.md#execution-integration) for brokered external actions, with fresh action checks on resume. Native harness shell/file tools run within the environment's preauthorized scope; the experiment did not establish per-command Ash approval callbacks. Do not claim that Ash Permissions mediate those internal tools. Long user waits can consume harness work even when no public notice appears; durable Decisions must not depend on a live stream, and waiting must be distinguishable from productive coding.

The minimum durable additions are Workspace, harness/environment linkage, immutable Candidate/evidence and application outcome records. A candidate records its exact base, source, build and verification identities. An application record links the existing Decision to previous/new runnable versions and health outcome; it must not become a second approval system.

## Published and signed applications

Treat code application as an update, not an in-place edit of the installed `.app`. Changing sealed bundle contents can invalidate its signature and undermine OS identity-dependent behavior. [Apple Developer Technical Support](https://developer.apple.com/forums/thread/115425). Electron’s macOS automatic updater requires a signed app; direct distribution also needs a signing/notarization pipeline. [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [macOS signing guide](https://www.electronforge.io/guides/code-signing/code-signing-macos).

| Change or environment | Proposed application path |
| --- | --- |
| Local developer build, first milestone | Build a versioned runnable candidate outside the working checkout. After approval, an external launcher switches versions and restarts against the retained daily data. Schema remains compatible. |
| Instruction/configuration adaptation | Use the relevant reviewed data change; rebuild only if executable code changed. Ash-authored instruction edits still require their specified Decision. |
| Future custom apps/extensions | Versioned packages with separate data and constrained APIs, following the [custom-app boundary](../../specs/HUMAN_SPEC.md#custom-apps). An extension runtime is future work, not permission to load arbitrary privileged code into the signed shell. |
| Packaged Ash core change | Build an immutable release, sign and notarize for direct macOS distribution, verify the package, then install through an updater and restart. Keep application data outside the bundle. |

**Recommendation:** prove the local developer flow first. For a distributed product, a stable signed core plus constrained custom apps/instructions can support frequent personalization. Full core modification remains a distinct advanced capability requiring a personal signing identity or a trusted build/signing service. A user's modified binary cannot simply inherit the publisher's existing signature. Central signing of arbitrary user-generated code carries review, cost and trust implications that need a separate decision.

For signed delivery, build/sign/notarize and smoke-test the actual package before the final install approval; keep keys out of the coding environment and candidate-controlled build scripts. Validate application identity, capture permissions, update failure and rollback on packaged builds. The development preview alone proves none of those. App Store delivery would require its own feasibility review.

Track upstream release, personal integrated revision and installed build separately. Initially retain intent, acceptance examples and commit relationships so an upstream upgrade can be prepared in another Workspace and tested with personal changes. Defer the original “concept tree” sharing system until real upgrade conflicts establish what Git plus this metadata cannot express.

## Patterns worth adopting

| Source | Observed pattern | Application to Ash |
| --- | --- | --- |
| [Amp Orbs](https://ampcode.com/docs/orbs) | A conversation is paired with an isolated environment, running services and review evidence; remote work survives closing the laptop. | Make setup disappear behind the request and keep the result runnable; distinguish hosted coding from the Mac-dependent preview and broker. |
| [Amp Portals](https://ampcode.com/docs/orbs/portals) | A preview can send contextual feedback back into its agent Thread. | Make recording from an Ash preview return directly to its owning Workspace, with version identity. |
| [Conductor workflow](https://www.conductor.build/docs/concepts/workflow) | One independently shippable unit per Workspace, followed by verification, review and integration. | Scope Workspaces by change, allowing conversation continuity without one giant development Thread. |
| [Cursor worktrees](https://cursor.com/docs/configuration/worktrees) | Separate checkouts and setup hooks support concurrent agent work. | Reuse Ash's launcher and per-instance resources; branch isolation alone does not isolate runtime state. |
| [Amp shipping](https://ampcode.com/docs/orbs/shipping) | Its Ship button sends a configurable shipping prompt to the agent. | Use the approachable action, but implement Ash's Apply as an enforced Decision/controller operation. Replacing the running app needs stronger guarantees than a prompt. |

These suggest small complete changes, reproducible environments, short feedback loops and verification against the integration target. They do not require reproducing a general-purpose IDE or moving Ash to the cloud.

## Delivery sequence

Slices 2–3: [code, operation and verification](../features/adapt.md). Preview and local application are renderer-only with a trusted backend/Electron shell; full backend/native execution needs another environment.

### Current slice

1. **Automatic entry:** [ADAPT-R14](../../specs/features/adapt.md#rules), implemented through the ordinary assistant’s tool surface. [Execution and verification](../features/adapt.md#automatic-entry-and-parallel-changes).
2. **Parallel changes:** local Workspace refresh and conflict resolution are implemented under [ADAPT-R15](../../specs/features/adapt.md#rules). Source integration into `master`, resource quotas and an integration queue remain separate.
Dictation is deferred by user direction, 2026-10-23. Signed updates are deferred to another chat.

Native/backend environment support remains separate from this local renderer workflow.

| Slice | Deliverable | Exit demonstration |
| --- | --- | --- |
| 1. Feasibility experiment | Managed Codex editing, progress, native feedback, real Decisions, latency, lifecycle and source recovery. | Completed in `ash_experiments`; containment and local application subsequently verified in Ash. |
| 2. Adapt Thread and adapters | Thread mode, captured execution routing, durable Run/Artifact and Workspace linkage, replaceable adapters, recording handoff and marked native preview. | Enter Adapt in an existing Thread; send once, edit/check/preview, record a correction and continue. Restart during coding or a Decision without duplicate effects; replace an expired environment from a checkpoint. Verify the native containment boundary before automatic preview execution. |
| 3. Review, apply and restore | Frozen local UI builds, protected checks, exact Decision and external version controller. Local installation accepted; source integration remains separate. | Complete one UI-only change end to end; reject stale approval; recover from failed startup; restore the previous version without losing a chat created after the update. |
| 4. Parallel workflow | Independent Workspaces and local source refresh implemented; resource limits, source integration queue and dependency handling remain proposed. | Work on A and B concurrently; apply A; refresh and reverify B; reject outdated evidence; preserve both histories through restart/cleanup. |
| 5. Distribution | Packaged identity, signing/notarization, updater, package checks and version compatibility. | Apply and recover an actual signed update with retained user data and verified native permissions. |

Implementation and automated coverage for slices 2–3 and local parallel refresh are linked above. General Tasks/scheduling, authenticated hosted previews, custom apps, semantic memory and concept sharing remain subsequent work. Steering/queuing, source integration and signed-package verification belong to their future slices; they are not prerequisites for the delivered renderer workflow.
