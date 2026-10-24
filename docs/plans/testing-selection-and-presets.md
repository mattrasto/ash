# Test selection, execution graphs and presets

Direction accepted, 2026-10-23 · Pipeline implemented · Worker scaling verified

Reduce repeated work before increasing concurrency. Follow the [check cadence](../testing.md#when-to-run-checks) and [verification and evidence rules](../testing.md); use the [existing measurement procedure](testing-improvements.md#measurement-procedure) for comparisons.

## Separate selection, state and execution

| Concept | Owns | Example |
| --- | --- | --- |
| Scenario | Behavior and failure being checked; independent result | Reply rendering, persistence after a new send |
| Preset | Known starting state, independently restored for each consumer | One completed conversation |
| Group | Related scenario IDs selected for one observable purpose | Message rendering and inspection |
| Execution graph | Actual prerequisites, environment instances and resource constraints | Prepare an instance, send, restart and inspect recovery |

Groups select scenarios; the graph owns execution dependencies. Sharing a feature or preset creates no ordering edge. Prefer dependencies on prepared state; keep test-to-test edges for transitions under examination, with separately reported checkpoints.

A new desktop chain needs explicit checkpoint reporting; Playwright steps alone do not create independent scenario results in Ash's reporter. Cleanup failure invalidates evidence for the affected environment's consumers.

```mermaid
flowchart LR
    Select[Select roots] --> Optimize[Resolve and schedule graph]
    Optimize --> Run[Run and report]
```

## Initial audit

Source: `0a7b293`. Located all 148 registered scenarios across 28 test files and 43 execution groups. Compared requirement references, call patterns and repeated literals, then manually reviewed candidate clusters in chat/lifecycle, permissions, design, tools and visibility/engine checks. This is inventory-wide triage with targeted semantic review, not proof that every assertion is unique.

The two consolidations below were implemented at `36756e7`, retaining all 148 scenario IDs. Full verification passed 148/148 in 451s with source and cleanup checks passing. This is the workload baseline before preset infrastructure; it does not establish a consolidation speedup.

### Consolidation candidates

| Scenarios | Finding | Applied change |
| --- | --- | --- |
| `TOOL-02`, `TOOL-03` | Both check unknown tools and malformed argument JSON at the common executor boundary. | Keep those generic cases in [tools.test.ts](../../tests/integration/tools.test.ts). Retain filesystem-specific invalid arguments, containment, exclusions and symlink-race checks in [filesystem-tools.test.ts](../../tests/integration/filesystem-tools.test.ts). |
| `permissions-form-desktop`, `permissions-overrides-desktop` | Both exercise direct filesystem permission creation. The overrides scenario contains a small independent folder-creation segment. | Make the form scenario own direct creation, including the explicit trailing-slash folder variant, then remove only the redundant segment from [permissions-decisions.spec.ts](../../tests/e2e/permissions-decisions.spec.ts). Preserve stale-review rejection, override relationships, editing and full-condition rendering. |

Neither finding justified deleting a whole scenario. Coverage ownership moved as described, retaining filesystem-specific validation and the explicit trailing-slash permission variant.

### Shared starting-state candidates

| Scenario | Reusable prerequisite | Behavior that must remain live |
| --- | --- | --- |
| [`chat-layout`](../../tests/e2e/chat.spec.ts) | Completed conversation with the same title, messages and event content | Draft entry, viewport/layout assertions and reviewed screenshots |
| [`design-reading`](../../tests/e2e/design-polish.spec.ts) | Completed Markdown reply containing a link | Link focus/style and editor scrolling |
| [`context-inspection-desktop`](../../tests/e2e/topics.spec.ts) | First completed exchange | Change instructions, send the next message and verify its frozen request capture |
| [`decisions-navigation-desktop`](../../tests/e2e/permissions-decisions.spec.ts) | Long transcript | Scroll/draft restoration and navigation; preserve the later decision flow's distinct assertions |
| [`topics-settings-desktop`](../../tests/e2e/topics.spec.ts) | Topics, threads and memberships for downstream settings checks | Keep topic creation and its focus behavior in a dedicated live creation check before extracting downstream checks |

Preset conversion must preserve existing screenshot content; baseline changes require their own review. Similar navigation helpers and shared fixture constants are not evidence of duplicate coverage.

Reviewed examples to retain:

- `chat-persistence` proves a real send and draft survive client reload/reopen; `chat-restart` handles an undispatched run across backend restart; `workflow-desktop` proves separate worktrees, hot reload and restart isolation. Their recovery boundaries differ.
- `desktop-background` sends while the native window is hidden. `chat-desktop` includes streaming, cancellation and reconnect behavior. Pre-completing those operations would erase the checks.
- Permission suggestion, rule-change and override scenarios exercise different validation and conflict cases. Tool depth, output limits, parallel ordering and byte-budget reservations likewise cover different constraints.
- Design-system controls, presence and replacement checks have distinct interaction/motion contracts despite sharing app startup.

The current groups also constrain selection: permissions-decisions contains 15 scenarios, threads 12 and filesystem-tools 10. A precise source map cannot overcome broad execution groups. Review their real state dependencies before splitting; do not simply run individual callbacks that depend on earlier actions.

## Keep selection narrow and current

Extend [the existing registry](../../tests/scenarios.ts), rather than introducing a second inventory. The proposed selection path is:

`changed paths → owned components and affected consumers → root scenarios → prerequisite graph`

Each scenario names the observable contract it checks and its relevant component boundaries, reusing current requirement references. A requirement reference alone does not establish which clauses are tested. Ordinary application bootstrap imports are also insufficient: importing every feature must not automatically select every feature's scenarios.

| Risk | Mechanism | Verification |
| --- | --- | --- |
| Groups grow “just in case” | Give each group one purpose. Require a concrete state prerequisite for each dependency edge; shared setup is insufficient. Report selected roots separately from prerequisites. | Record count, estimated cost and expansion ratio for representative edits. Flag growth against reviewed budgets; investigate rather than silently dropping checks. |
| Refactors leave stale mappings | Check both sides of a diff, including old and new paths/dependencies for moves and deletions. Detect orphan rules, missing scenario IDs, unowned production files and new cross-component dependencies. | Exercise rename, deletion, new-file and dependency-change examples in the selector's boundary checks. Review only the affected ownership declarations. |
| A change affects another feature | Declare contract consumers explicitly; use dependency analysis to flag missing relationships for review. Unreviewed shared changes defer iteration selection under the [cadence policy](../testing.md#when-to-run-checks). | Replay representative cross-feature changes and previously fixed regressions. Inspect every inclusion path in the selection preview. |
| Selection silently omits coverage | Report uncertain selection as deferred with its reason, never as a pass. Compare predictions with the independently scheduled final full gate. | Include controlled faults in disposable copies and known regression examples; confirm that tests which detect them are selected. A passing full run alone cannot prove the selector is sound. |

Before executing, show changed paths, selected scenario IDs, expansion reasons and estimated duration. Treat frequent deferrals and excessive group expansion as maintenance signals, with responsible components identified. Never “fix” an uncertain mapping by silently attaching unrelated tests to a feature group.

Keep quick verification stable and full verification mandatory before integration. Selection is an iteration aid; it does not establish complete coverage of every possible effect. Runtime coverage may help investigate mappings later, but should not become the sole selection authority.

### Iteration command proposal

The [cadence policy](../testing.md#when-to-run-checks) owns when to test. Iteration uses `pnpm verify --affected <base> --iterate`; `pnpm verify` and the explicit shadow full-gate command retain full scope. [Commands](../testing.md#commands) own flags and exit behavior.

| Iteration decision | Execution | Evidence |
| --- | --- | --- |
| `ready` | Run the known selection at a useful checkpoint, with required type/build stages. | Partial results for exactly that selection. |
| `not-needed` | No runtime commands or provisioning for documentation-only changes. | Reason; no test pass claimed. |
| `deferred` | No runtime commands or provisioning when any changed path has uncertain ownership, mapping drift or unreviewed expansion. | Changed paths and reasons; final full verification remains due. |

A known subset does not automatically execute alongside unresolved changes. Explicit scenario/group diagnostics remain available when a concrete question justifies them. Invalid arguments or broken registry structure remain errors, not deferrals. Deferral must not produce a passing verification report or provision a fallback environment.

## Select, optimize and run

Implemented pipeline; incremental migration below. Profiles change the selected roots rather than choosing separate runners.

| Phase | Responsibility | Output |
| --- | --- | --- |
| Select | Resolve profile, explicit scenario/group IDs or reviewed affected components. Apply the iteration decision above before provisioning. | Root checks and inclusion reasons, or a non-passing deferred/not-needed decision. |
| Optimize | Expand actual prerequisites and environment instances; validate the DAG; merge identical immutable preparation; prioritize work under resource limits. Never drop selected checks. | Frozen execution plan, dependency reasons and approximate timing. |
| Run | Execute ready nodes, update scheduling as work finishes, account for results and always finalize owned environments. | Per-scenario outcomes, progress events and retained evidence. |

| Scope | Selected roots |
| --- | --- |
| Quick | Existing type and boundary checks. |
| Medium / focused | Explicit scenarios/groups, or a known affected selection at a useful iteration checkpoint. |
| Full | Complete implemented inventory and required preparation; authoritative final gate. |

Keep existing focused commands; “medium” describes that scope, not a new CLI profile requirement.

### Minimal graph contract

- Nodes represent preparation (build/service/preset/instance), checks (types/scenarios) or cleanup. Each has a stable ID, executor, prerequisites, resource claims and an optional duration estimate. Reuse current registry definitions; generated plans are evidence, not a second inventory.
- A prerequisite edge names the state or result required. Checks need successful prerequisites; cleanup runs after consumers settle, including failure/cancellation. Reject cycles, missing nodes and incompatible environment claims before side effects. Failed prerequisites block descendants; unrelated branches can continue.
- Environments declare whether their output is immutable/shared or mutable/isolated. A live instance has its own identity and a lease through cleanup. Independent tests receive independent mutable instances; genuine state-transition chains share one instance and explicit ordering. Cross-group edges are permitted and reported, not implicit in group membership.
- Estimates come from comparable phase timings, separating setup from check bodies without double-counting nested spans. Record sample count and variability. Missing timing means unknown ETA, not uncertain selection or a zero-cost node.

### Scheduler and progress

Start with a deterministic ready queue: prioritize the longest estimated downstream path, fit available resource claims and break ties by stable ID. Reconsider ready work after each completion. Use the bounded worker limit in the [testing commands](../testing.md#commands) and preserve exclusive lifecycle/native constraints; count nested runner workers against the same capacity. Minimize total elapsed time under those constraints, using critical-path length as a lower bound.

Use the same frozen graph for preview and progress: show selected checks versus prerequisites, ready/running/blocked/completed nodes, active environments, elapsed time and approximate remaining time. Recalculate ETA as observations arrive; keep check counts separate from preparation counts. Begin with a readable timeline and events in the existing report, not a new dashboard.

### Tradeoffs and limits

- The runner gains dependency, ownership and failure-handling complexity. Wrap existing runners first, then expose finer nodes as cases become independently executable. Opaque legacy bundles must disclose all scenarios they actually run; registry labels alone cannot split them.
- More isolated environments can shorten focused runs while increasing total setup or full-run cost. Bound live environments and measure both scopes. First version uses declared instances and guarded reuse; no exact solver, automatic environment cloning, persistent snapshot cache or extra workers.
- Timings vary with host load, so ETA is approximate. Measure planner overhead and prediction error alongside elapsed time; optimization must not make test outcomes depend on a particular scheduling order.

## Group schema

Target shape: groups become `{id, purpose, scenarios}` selection labels; scenario/node definitions own executors, environments and dependencies. Keep component paths/consumers in the existing component map. Each scenario retains one canonical group, while selection unions groups and dependency expansion deduplicates nodes. Unconverted groups still retain file/exclusivity adapter metadata and execute as explicit legacy bundles. New independent cases do not acquire ordering edges from group membership.

Retain review thresholds of **five scenarios** or **30s observed selected cost** per group as maintenance cues, not coverage limits. Report dependency expansion and reviewed component budgets; unexplained growth defers automatic iteration. Review changed groups/edges and threshold exceptions incrementally. Membership, dependency or contract changes reopen relevant exceptions. Cheap structural validation complements real isolation/failure checks; it cannot prove behavioral independence.

### Original migration plan

Before case dispatch, the message-rendering selection expanded eight direct scenarios to 34 because the integration runner executed whole files:

| Requested scenario | Group at that checkpoint | Total scenarios | Extra scenarios |
| --- | --- | ---: | ---: |
| `chat-desktop` | `threads` | 12 | 11 |
| `images-desktop` | `images` | 6 | 5 |
| `videos-desktop` | `video` | 7 | 6 |
| `video-understanding-desktop` | `video-understanding` | 5 | 4 |
| Four other rendering scenarios | Four independent desktop groups | 4 | 0 |
| **Total** | | **34** | **26** |

1. **Plan without execution.** Implement selection decisions and graph previews for quick, focused and full scopes, wrapping current execution units honestly. Check dependency closure, cycle rejection, stable priorities and zero runtime commands for deferred/not-needed iteration decisions.
2. **Run with existing limits.** Add adapters to current test frameworks and source/cleanup accounting. Exercise failed setup, blocked dependents, independent branches and interrupted cleanup. Preserve exclusive resources and avoid nested concurrency growth. Emit the same plan's progress and approximate ETA.
3. **Narrow the pilot.** Extract the four desktop cases above, preserving IDs, live behavior and assertions. Replace incidental prerequisites with recipes. Add case-level Node dispatch where needed; the current Node runner selects files, while Playwright already filters cases. Target eight rendering cases instead of 34, plus the existing three-case routing selection.
4. **Measure and expand.** Compare bounded focused/full runs, preparation cost, planner overhead and ETA error. Confirm selected cases still catch the controlled faults and the final frozen suite accounts for every retained scenario. Expand by touched family; review permissions/tools later, without a full audit per chat.

Acceptance: deferred selection starts no tests; graph scheduling respects state/resource constraints; failure and cancellation retain accurate results and cleanup; the rendering pilot adds no unrelated backend/recording checks; full verification retains its existing authority. Reuse prior evidence when relevant inputs stay unchanged. Runtime improvements remain measured outcomes, not prerequisites assumed by the design.

### DAG implementation checkpoint

At `4aee4fb`, the verifier uses graph nodes for types, shared build validation, selected framework execution and recovery cleanup. Four Node desktop cases dispatch independently and construct their prerequisites through real APIs/services without sibling assertions. Their existing assertions and all 149 scenario IDs remain; the registry now has 48 groups. Independent branches continue after a sibling failure; failed prerequisites block dependents. Boundary checks exercise cycles, resource admission, missing/unexpected results, source changes, read-only/deferred decisions, progress-write failure and real process cancellation/recovery.

Database, service, preset and Electron preparation remain inside framework adapters, tagged with the owning graph node and measured as phases. Legacy journeys and Playwright file batches are explicitly identified. Worker slots bound executor concurrency; existing multi-instance isolation checks retain their internal topology. The graph does not yet schedule each instance-preparation phase independently. That checkpoint introduced no snapshot cache or higher worker limit; later scaling is recorded below.

The first quick run caught a preview initializing the development root; the fix passed a focused contract check. The eight-case rendering pilot then passed on its first attempt in 77s with valid source and cleanup. Failed development attempts remain in evidence; they are not timing samples or retried passes.

### DAG measurements

Two interleaved before/after pairs per selection on the same Mac, Node 24.19.0, two workers, accelerated test timing and cached installed dependencies. Before `e9ce0bc`; after `4aee4fb`. Each invocation includes types, build, application preparation, assertions, diagnostics and cleanup. All eight invocations passed on first attempts with source validation and cleanup passing.

| Requested behavior | Executed scenarios before → after | Before median (range) | After median (range) |
| --- | --- | --- | --- |
| Message rendering | 34 → 8 | 154.5s (143.7–165.2s) | 93.6s (90.3–96.9s) |
| Model routing | 3 → 3 | 34.2s (29.4–39.0s) | 25.2s (23.9–26.5s) |

Rendering was 39% faster in these samples; that combines narrower selection with scheduling. Routing's selection was unchanged: its integration and desktop execution overlapped by 4.0–4.2s. Its observed 26% median improvement also includes host-load/type-check variation, so do not attribute the entire difference to the scheduler or generalize from two pairs.

Rendering estimates were 77s and 90s against observed 90s and 97s; the second routing estimate was 26s against observed 24s. Unknown weights produced an explicit unknown total for the first routing run. Timings are one-report estimates, not calibrated confidence intervals. Later review adds progress finalization and timing metadata; the series identifies its measured checkpoint.

At `fc6296c`, controlled empty-Markdown and inverted-routing faults compiled and were caught by selected cases, with frozen source and cleanup passing. Markdown preview selected eight cases including `design-reading`; that detector alone ran for diagnosis. Routing used actual `--affected HEAD --iterate` execution and ran exactly three scenarios. These examples validate useful mappings, not general selector soundness. Evidence: `dag-pilot/faults/results.json`, relative to the directory below.

At `5502499`, all four extracted desktop scenarios passed on their first attempts with normal scheduling in 74s, with valid source and cleanup. Report: `~/.ash-dev/evidence/6293c7147bb6b0fb264b70f6/report.json`. This checks the independent fixtures against actual background delays rather than accelerated timing alone.

Separate normal-timing app exploration passed a new send after preset construction, reload, draft preservation, captured-request inspection, hidden/non-focusable native windows and cleanup. The seven-node normal-run timeline was rendered and visually reviewed, including partial-scope labeling and expandable cleanup dependencies. Evidence: `dag-pilot/exploration/{result.json,timeline.html,timeline.png}`, relative to the directory below.

Evidence: `~/.ash-dev/evidence/testing-feedback-01a16a31/dag-pilot/{series,summary}.json`, with individual passing report paths and complete invocation logs.

### DAG full gate

Frozen code checkpoint `211dcb7`: **149/149 scenarios passed**, each on its first attempt, in **582.2s (9m 42s)**. Source validation and all 107 resource-recovery records passed; final progress recorded zero owned environments. Planning took 409ms. Report: `~/.ash-dev/evidence/c45b77a357a6655fa92b52fa/report.json`; the adjacent `timeline.html` shows the execution graph.

This exceeds the earlier 149-scenario reference of 437s at `762607d`; a full-suite speedup is not established. These are unmatched single runs: starting free memory was 0.66GB versus 3.24GB, and host load differed. The new run also made 56 database provisions versus 52; independent case dispatch can repeat preparation when the full family is selected. Next investigate coalescing selected cases within existing file adapters and separating preparation cost from host contention. Preserve narrow selection and per-scenario results; do not increase workers to mask the difference.

An earlier gate at `4dd8ef9` was deliberately interrupted after 186s to fix stale environment counts after main-process recovery. Source validation and all 33 cleanup records passed; report `~/.ash-dev/evidence/c0e6a95eadccf40c42ede74e/report.json` remains diagnostic evidence. The fix passed the focused verifier contract in 9.1s and the final gate above. These attempts are excluded from the focused timing medians. Documentation-only completion retains the tested code checkpoint.

### Full-run preparation follow-up

Accepted goal: full verification in **five minutes or less**, preserving the full inventory and evidence rules. Ten minutes was an illustration of reasonable dependency-batch feedback, not a hard task deadline.

The 582.2s gate consumed 1,157.7 worker-slot seconds: a 578.9s resource lower bound under its existing two-slot claims, leaving about 3.3s for scheduling improvement with those same job durations. This measures reserved test capacity, not CPU utilization. Reaching five minutes requires reducing work or revisiting resource claims, rather than merely reordering these opaque jobs.

`executionPlan` now combines already-selected groups that execute the same existing workflow file. Full verification prepares the four extracted families once each, reducing the plan from 34 to 30 nodes. Groups remain selection labels; coalescing adds no scenarios. Each file retains its existing journey and per-scenario results. The focused planner contract passed in 5.0s, including the unchanged eight-case rendering selection.

The first follow-up gate at `f7d0096` finished in 386.6s with **148/149 passing**. It made 52 provisions instead of 56; source validation, all 102 cleanup records and final zero-environment accounting passed. `design-reading` failed after its behavior assertions while attaching a missing trace. Report: `~/.ash-dev/evidence/1a7e8b0c8cd13f5a2ac8a864/report.json`. This failed run is diagnostic evidence, not a passing timing sample.

A focused probe using two real Playwright runners reproduced deletion of the first runner's trace when the second started. The per-file DAG adapters shared an output root, which Playwright clears on startup. Each node now owns a distinct output root under the [evidence rules](../testing.md#evidence-and-handoff). The same probe passed after the fix, and the actual `design-reading` scenario passed with trace capture, valid source and cleanup in 22s: `~/.ash-dev/evidence/0c28ca6a1f18a55525afc6ef/report.json`. The probe is retained in the existing verifier boundary check without launching an app.

Final frozen code checkpoint `08a7ce1`: **149/149 passed on first attempts in 430.2s (7m 10s)**, with valid source, all 103 recovery records passing and zero remaining environments. All 103 reported attachments remained present after execution, including 26 valid trace archives. The plan had 30 nodes, made 52 provisions and took 102ms to prepare. Report: `~/.ash-dev/evidence/3c09b874ffd0908f9e37bed9/report.json`.

The four-provision reduction is structural; the elapsed-time comparison with 582.2s is an unmatched single pair and includes host variation. The five-minute goal remains unmet. Reserved capacity was again nearly full: the observed jobs imply a 428.7s two-slot resource lower bound versus 430.2s elapsed. The next cost investigation should target provisioning and service startup, preserving lifecycle behavior and isolated mutable state. No additional workers or new fixture-sharing mechanism were introduced. Documentation-only completion retains `08a7ce1` as the tested code checkpoint.

### Overlap startup preparation

Verified at `6072c24`; five-minute full-suite goal unmet. Existing lifecycle, instance isolation, source checks and two-worker claims remain.

A bounded backend probe warmed one isolated database, then compared source/compiled/compiled/source startup with the same Node/tsx hook and health identity checks. Source took 485ms and 436ms; compiled took 540ms and 492ms. No useful gain was demonstrated, so no compiled-backend reuse path was added. Evidence: `~/.ash-dev/evidence/startup-probe-k6FcoR/result.json`.

Finer timings identified serialized launcher loading and source fingerprinting around backend startup. Backend readiness, frontend-tool loading and fingerprinting now overlap; the frontend listener still waits for them. One real-app observation per version measured service readiness **1,818ms → 1,190ms** and launcher bootstrap **648ms → 166ms**. Backend readiness remained 795ms/813ms. Afterward, module loading (369ms) and fingerprinting (407ms) completed during backend startup. This establishes actual overlap; the sparse timing samples do not establish a full-suite reduction. Evidence: `~/.ash-dev/evidence/startup-phases-{q4VpSs,NNl4CY}/result.json`.

The real recovery probe held frontend-module preparation until a backend was recorded, then forced preparation to fail. It verified backend termination and successful restart, restored its disposable source and removed its private checkout/cluster. This regression is retained in `workflow-crash`. Normal-timing exploration separately passed a new send, reload, persisted draft/messages, backend restart, stable origin, request inspection and hidden/non-focusable windows. Source checks and cleanup passed in both probes: `~/.ash-dev/evidence/startup-recovery-aJCqQa/result.json` and `startup-explore-vnMsrR/result.json` under the same evidence root.

The frozen full gate passed **149/149 on first attempts in 400.3s (6m 40s)** versus the prior 430.2s. Both runs used two workers and accelerated disposable-test timing, with normal preview/lifecycle behavior retained. Across the same 70 successful readiness spans, median `services.ready` fell from **1,671.5ms to 1,060.5ms**. This is one unmatched full-run pair with different host conditions, so the 29.9s elapsed difference is not an isolated causal estimate. The lifecycle regression adds a real failed-start attempt within its passing scenario.

Source validation and all 103 recovery records passed, with zero remaining environments. All 103 reported attachments survived, including 26 valid trace archives; planning took 72ms. Report: `~/.ash-dev/evidence/6ac7ee032dca53f918d833a3/report.json`. Drivers and probe references are retained in `~/.ash-dev/evidence/testing-feedback-01a16a31/dag-pilot/startup-overlap/`. Documentation-only completion retains `6072c24` as the tested code checkpoint.

### Fresh provisioning, concurrency and quick checks

Implemented · Final code `57c0ea1` verified · Integration not authorized

Fresh provisioning now lets the real migration CLI create bootstrap tables directly, removing a separate baseline-resolution launch. Two interleaved pairs in one disposable database measured **1,004/992ms** for baseline plus deployment versus **548/534ms** for direct deployment. Schema columns/owners, constraints, functions, triggers and completed migration names/checksums matched. No template, snapshot cache or shared mutable state was introduced. Evidence: `~/.ash-dev/evidence/fresh-database-probe-8Cl6Rc/result.json`.

All 14 lifecycle scenarios passed in 96s, including real bootstrap execution, refusal to initialize existing/foreign-owned state, failed fresh provisioning cleanup and the existing migration failure/recovery checks. Normal-timing app exploration passed send, reload, draft/message persistence and restart. Reports: `~/.ash-dev/evidence/0c5fc96a4bf4323b136fe11e/report.json` and `startup-explore-Fqh0u3/result.json` under the same evidence root. An initial type error stopped before resource creation and was corrected before these checks.

On frozen `e9a54a2`, the same 18 desktop/filesystem checks passed first attempts in **74.4s with two workers** and **66.8s with three**. Individual execution-unit durations remained similar; source validation, all 18 recovery records per run and zero remaining environments passed. This single sequential pair supports a bounded concurrency increase on the measured 12-core, 64GiB Mac, not a general speedup guarantee. Three becomes the default; one/two remain available, lifecycle stays exclusive and child runners stay at one worker. Comparison records: `~/.ash-dev/evidence/testing-feedback-01a16a31/dag-pilot/concurrency/pilot.json`.

Three-worker full gates passed **149/149 first attempts in 277.0s (4m 37s)** on `bee7e3d` and **276.0s (4m 36s)** on final code `57c0ea1`. Both passed source validation, all 104 recovery records and 103 attachments (26 valid trace archives), with zero remaining environments. Scenario IDs, requirement mappings, fixtures and assertions were retained. Latest median fresh provisioning was 708ms across 52 successful spans, versus 1,228.5ms in the prior two-worker gate. Total time improved from 400.3s, but changed provisioning, worker count and host load make this an unmatched comparison. Reports: `~/.ash-dev/evidence/{f31ecff9f071304c1bcfd583,ab7b0d0da33e4d58835da0e9}/report.json`.

Quick selection now includes only explicitly marked fast groups; verifier self-checks have their own `verification` group and remain in full verification. One observation per condition measured **24.0s → 12.0s**, with the boundary node falling from 14.9s to 2.6s. This reduces quick scope from seven to five named scenarios without removing full coverage or the existing fast module checks. Explicit verifier checks passed separately in 25s. Boundary estimates require the same dispatched scenario set; a broader or legacy command duration remains unknown. Evidence: `~/.ash-dev/evidence/{189e07335bbe8b27de98e95a,cfb053feb8f9e325b62ba9ee,c609d8be38693647934fd0c9}/report.json`.

At `57c0ea1`, the largest execution units were lifecycle setup/recovery (84.6s), permissions/Decisions desktop (55.0s) and visibility desktop (40.9s). Both observed full gates meet the five-minute aim; the quick observation meets twenty seconds. These small samples do not establish performance under future workload growth or other hosts. Documentation-only completion retains `57c0ea1` as the tested code checkpoint.

### Worker scaling

Verified, 2026-10-24 · Six-worker full gate `9e94e57`

Compared all 128 non-exclusive scenarios on frozen `1559cfd`. The 14 lifecycle and seven boundary scenarios were reserved for the final full gate. Their prior combined cost (100.1s) estimates full-run benefit; it is not a measured full run. Stop at reliability loss or less than roughly 10% marginal projected improvement. The 3→4 projection was borderline (9.4%), so six was measured before declaring diminishing returns. No 10/12-worker run was needed after eight failed.

The first three-worker control on `be68041` failed 6/128 scenarios in 2,304.6s. macOS recorded maintenance sleep from 08:12:19–08:28:48, 08:30:05–08:34:15 and 08:35:11–08:50:34 PDT, matching the test-event gaps and service interruptions. Source remained valid and all 84 cleanup records passed. The run is excluded from timing comparisons; that attempt stopped before any higher-worker run. Do not subtract sleep time to turn this failed run into a performance sample. Evidence: `~/.ash-dev/evidence/510db6712fedf2cdd6e10944/report.json`; driver and series: `~/.ash-dev/evidence/testing-feedback-01a16a31/concurrency-scaling/`.

| Workers | Observed 128-scenario time | First-attempt passes | Projected full time |
| --- | ---: | ---: | ---: |
| 3 | 184.7s | 128/128 | 284.8s |
| 4 | 157.8s | 128/128 | 257.9s |
| 6 | 119.7s | 128/128 | 219.8s |
| 8 | 119.6s | 127/128 | Excluded: failed |

Six gave the best passing result: eight saved no meaningful time and `TOOL-05` reached the fixture's 30-second filesystem-search deadline before the 512-check evidence cap. The same scenario took 13.2s, 15.5s and 25.8s at 3/4/6 workers, then failed at 33.6s at eight. Keep the assertion, evidence bound and deadline unchanged. The full gate below confirms the selected setting; do not raise concurrency to mask a failing sample.

The three passing comparisons retained all scenario IDs, source validation, first attempts, artifacts, valid trace archives and cleanup, with zero remaining environments. One sequential sample per setting on a loaded host supports this local choice, not a universal optimum. The failed eight-worker run is retained. Awake-series records: `~/.ash-dev/evidence/testing-feedback-01a16a31/concurrency-scaling/awake-1559cfd/series.json`.

Final frozen `9e94e57` passed **149/149 on first attempts in 221.8s (3m 42s)** using the six-worker default. Source validation, all 104 cleanup records, 103 artifacts and 26 valid trace archives passed; no owned environments remained. The observed peak was six slots and every exclusive node ran alone. `TOOL-05` passed in 19.4s. Scenario IDs, requirement mappings, fixtures and presets match the earlier full gate. Report: `~/.ash-dev/evidence/8f65bddd9db39790e14244a6/report.json`; audited results: `awake-1559cfd/full-gate-audit.json` under the series directory above. Documentation-only completion retains this tested code checkpoint.

### Integration plan

Integration authorized, 2026-10-24 · Pinned baseline `5b49326` · Combined inventory 188

1. Complete: [worker scaling and the final feature gate](#worker-scaling).
2. Squash this worktree's changes into one feature commit and rebase onto pinned `master`, following the [Git requirements](../development.md#git-integration).
3. Review the six resolved conflicts: `docs/testing.md`, `scripts/dev/build.ts`, `scripts/dev/lifecycle.ts`, `scripts/dev/supervisor.ts`, `tests/e2e/chat.spec.ts` and `tests/scenarios.ts`. Preserve master's Adapt/scene behavior alongside the DAG, startup overlap and preset changes.
4. Review all 14 overlapping paths, including auto-merged product-database grants, feature tests and package scripts. Preserve master's security dependency updates and refresh-deadline correction. Install from the resulting lockfile and regenerate the Prisma client.
5. Retain the verified inventory union: master's 186 scenarios plus `workflow-migrations` and `verification-presets` yield **188**, with existing IDs, requirements, native/exclusive constraints and reviewed baselines retained. New Adapt/scene jobs must remain represented in selection and execution accounting.
6. Check resolved launcher, migration, chat/preset and Adapt/scene paths narrowly; repeat the code review on the combined candidate and explore the actual app. Then freeze source, dependencies and fixtures and run one full gate. The 149-scenario timing observations do not predict the combined suite's elapsed time.
7. After a passing gate, confirm that `master` still equals the pinned baseline and fast-forward the exact verified one-commit candidate. If the baseline changes, reconcile and verify a new candidate rather than following trunk during the active gate. Retire the branch/worktree only after preserving needed preview data and evidence.

## Preset design

Start with two recipes; add larger states when actual consumers justify them.

| Preset | Contract | Use |
| --- | --- | --- |
| `blank_slate` | Default configuration, no user conversations or topics | Creation and first-use behavior |
| `conversation_ready` | One completed user/assistant exchange, valid captured request and named handles for its thread/messages | Reply layout, inspection and navigation prerequisites; small declared content variants where necessary |
| `multiple_topics_and_threads` | Explicit small counts, memberships and histories | Cross-thread/topic navigation and settings |
| `full_heavy_usage` | Explicit bounded counts, transcript sizes and attachment sizes | Dedicated scale/overflow checks; opt in rather than becoming the default fixture |

A preset is a recipe plus its declared state contract. Construct valid data through application services or APIs with the deterministic model; keep a canonical real-app creation journey to verify UI wiring. Do not seed the behavior under test: a persistence check must still perform the write it claims to preserve, and streaming/reply-progress checks must still generate a live response.

### Materialization and isolation

1. Implement recipes and measure construction cost first. Reusing a helper that repeats all the same UI actions does not save that work; service/API construction may already be cheap enough.
2. If construction remains material, build each used preset once per frozen verification session. Wait for a settled state, validate it and produce an immutable snapshot of explicitly allowed product data and synthetic files.
3. Restore into a fresh owned database/filesystem for each test. Allocate fresh instance identity, credentials, ports and processes. Return named handles instead of exposing hard-coded instance paths. Tests may mutate their own copies without resetting or contaminating another test.
4. Keep app selection, drafts and preferences explicit in the test fixture. Do not copy opaque Electron profiles or live process state. Exclude ownership metadata, credentials, runtime configuration, logs and in-flight work from snapshots. Initial presets contain no queued/running operations; recreate product deadlines under an explicit clock/age policy so background expiry does not silently alter the starting state.
5. Key reuse to the frozen source, migrations/schema, recipe, dependencies, model and timing configuration. Missing, stale or corrupt materialization fails clearly or rebuilds before tests begin. Start with session-local reuse; persistent cross-run caches and database-template optimizations need separate evidence.

Verify restored and freshly constructed state through the same application reads, including relationships and synthetic files. Check cross-copy mutation isolation, source/schema invalidation, corrupt input, interrupted construction and cancellation cleanup before migration of consumers. Required restart/native/normal-timing behavior stays live under the existing testing policy.

Benchmark the complete cost: one-time construction plus each restore, app startup, scenario, evidence and cleanup. Presets do not inherently remove Electron or backend startup. Compare a single focused test as well as several consumers; a preset can help the latter while slowing the former.

## Repeatable review without a full audit per change

- **On a new or changed scenario:** declare its contract/failure boundary and preset in the existing inventory. Compare it with related scenarios; record the distinct failure when similar coverage is intentional. Avoid per-assertion metadata.
- **Automatic integrity checks:** enforce valid IDs, ownership/preset references, group membership and graph dependencies. These are cheap structural checks, not semantic coverage proofs.
- **Advisory duplicate candidates:** compare changed scenarios with the inventory using shared contracts, normalized setup/call patterns and cost. Present only the strongest candidates. Similar text is a review cue, never authority to delete a test; the generic-tool duplicate above even crosses requirement IDs.
- **Remember review decisions:** retain the chosen coverage owner or reason to keep a pair, tied to the relevant test-body/contract fingerprint. Revisit when that evidence changes, so accepted near-duplicates do not generate repeated noise.
- **Broader review triggers:** revisit a family when its setup share, selected cost or group expansion grows materially, or its contract is refactored. Use milestone audits for wider coverage; do not require every change chat to audit the suite.

## Earlier pilot scope

Initial acceptance targets below; measured outcomes follow. Planned DAG work uses the [original migration plan](#original-migration-plan).

| Step | Deliverable | Acceptance |
| --- | --- | --- |
| 1. Consolidate and baseline | Resolve the two narrow candidates; finish behavior-owner review for the first preset consumers. | Retained checks cover the same failures. Verify the changed groups and final source, then freeze an inventory and timing baseline. No speed comparison mixes coverage removal with infrastructure gains. |
| 2. Preset pilot | `blank_slate` and `conversation_ready`; migrate `chat-layout` and suitable reading/inspection prerequisites. | Equivalent assertions and content, independent failure/cleanup, measured focused and multi-consumer benefit at the current worker limit. Keep the simpler recipe if snapshot reuse does not pay for itself. |
| 3. Selection pilot | Small ownership/consumer map, explained expansion, drift checks and shadow-mode report. Split only groups whose prerequisite review permits it. | Representative edits select expected contracts; rename/shared-change/unknown-path cases are safe; controlled regressions are selected; group growth is visible. |
| 4. Scale the patterns | Add justified presets and incremental review signals from real usage. | New tests require little metadata, known duplicates stop resurfacing, and fallback/expansion costs remain understandable. |
| 5. Concurrency | Measure scheduling balance, then test additional workers for independent environments. | Reduced elapsed feedback with unchanged failure and cleanup behavior under matched host load. Preserve exclusive lifecycle/native constraints. |

That pilot kept the first four steps at two workers, with bounded timing series and failed attempts retained.

## Historical preset and shadow-selection checkpoint

Checkpoint `762607d`; superseded by the execution pipeline and iteration policy above.

- `blank_slate` and `conversation_ready` use fresh owned instances and deterministic application APIs. Three desktop consumers declare the latter in the existing registry. `verification-presets` checks real captures, fresh identity, mutation isolation, cancellation admission and refusal to overwrite state; the inventory now has 149 scenarios and 44 groups.
- The first layout attempt exposed different initial scroll modes between a new send and loading history. The layout fixture now explicitly scrolls toward the beginning through real input. Both reviewed screenshots pass unchanged; no screenshot expectations were regenerated.
- `--affected` records an advisory prediction and always executes the full selection. Markdown presentation and model routing have explicit file/consumer declarations, expansion budgets and inclusion reasons. Static relative-import checks are a drift signal, not a complete dependency/coverage proof. Optional historical estimates include observed setup/cleanup where available and disclose missing groups.
- `test:audit` checks executable inventory consistency and limits similarity suggestions to changed tests by default. Three reviewed distinctions are stored with canonical test-body fingerprints; changed evidence makes them eligible for review again. Quick checks exercise actual Git moves, new consumers, new dependencies, unknown/shared paths, unregistered scenarios and an injected duplicate.

At this checkpoint, snapshot reuse, larger presets, broad ownership mapping and additional workers remained experiments. The later DAG pilot enabled reviewed iteration narrowing; snapshot reuse still lacks a demonstrated benefit.

## Pilot measurements

Same Mac, Node 24.19.0, two workers, accelerated disposable-test timing, installed dependencies. Three sequential invocations per selection and condition; source frozen within each run. Before: `36756e7`; after preset readiness correction: `d0a00a9`. Timings include types, build, test setup, assertions, evidence and cleanup.

| Selection | Before median (range) | API preset median (range) | First-attempt outcomes |
| --- | --- | --- | --- |
| Layout, reading, context inspection | 39.8s (38.6–52.8s) | 41.7s (37.0–46.4s) | 3/3 invocations, 9/9 scenario results in each condition |
| Layout alone | 31.5s (30.8–34.8s) | 28.1s (26.9–42.9s) | 3/3 invocations, 3/3 scenario results in each condition |

No reliable elapsed-time improvement is established: ranges overlap, the family median increased, and conditions were measured sequentially under variable host load. The original UI send-to-completed precondition took 0.93s median across nine family trace spans; API recipes took 0.93s across nine spans and additionally waited for saved naming/visibility outcomes. Provisioning, service/Electron startup and prerequisites dominate these selections. Keep the small recipes for explicit reusable preconditions; do not add snapshot caching or migrate more consumers on the strength of this speed comparison.

Two diagnosed fixture failures cost 75.9s before the corrected series: initial scroll-mode mismatch and returning while a visibility assessment was still running. Both are retained as failures; assertions and reviewed screenshots were preserved. The corrected series passed 12/12 scenario results without retries. Normal timing retains its actual scheduler delay; preset readiness allows a 30s margin.

Final review additionally hardened readiness to check both saved assessment outcomes, because naming counters also mark claims. The timing table identifies its earlier checkpoint; no final-code speedup is claimed. Independent normal-timing app exploration passed a new send, reload, draft preservation, captured-request inspection, hidden native state and cleanup.

Evidence: `~/.ash-dev/evidence/testing-feedback-01a16a31/preset-pilot/`, with individual report paths in the comparison. Diagnostic audit work now compares changed tests against the inventory, and import scanning runs once per source file; expanding the registry does not repeat parsing for every component.

### Selection checks

At `033bf53`, two deliberate behavior faults in a disposable checkout compiled successfully and failed the expected real scenario. Source remained frozen during each run and cleanup passed. The CLI's shadow preview retained full execution scope while explaining these predictions:

| Fault | Direct / expanded scenarios | Detecting scenario | Historical estimate |
| --- | --- | --- | --- |
| Markdown renders empty output | 8 / 34 | `design-reading` | 114s |
| Routing chooses the opposite model role | 3 / 3 | `model-routing-execution` | 25.6s |

Estimates use the single 451s baseline report and include prerequisites and observed setup/cleanup; they are predictions, not measured selected-run promises. The Markdown expansion makes existing group overhead visible: 26 additional scenarios come from legacy whole-file execution groups. These two faults validate useful examples, not selection soundness for every possible change. Automatic narrowing remains disabled.

Evidence: `~/.ash-dev/evidence/testing-feedback-01a16a31/selection-faults-pv848m/`. The baseline also showed a 22.3s desktop tail with only one file left running. Review file scheduling before adding workers; the variable host load and lack of a demonstrated preset speedup do not justify increasing concurrency in this pilot.

### Preset-pilot full gate

Code checkpoint `762607d`: full verification passed 149/149 scenarios in 437s, all on their first attempt, with source validation and all 102 recovery-cleanup records passing. Two workers, accelerated timing, no live-provider calls. Under the original fallback policy, shadow selection retained all scenarios for the infrastructure changes. Diff review and normal-timing app exploration passed; their evidence is separate from the automated gate.

Evidence: `~/.ash-dev/evidence/19102fc119fa53e993af3d7b/`. The earlier 451s baseline has one fewer scenario; these single full runs do not establish an overall speedup. This gate predates the DAG implementation; the [current gate](#dag-full-gate) records that implementation's verification.
