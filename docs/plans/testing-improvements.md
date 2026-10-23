# Testing improvement plan

Authorized, 2026-10-22 · Implemented · Verified on frozen feature source, 2026-10-23

Shorten feedback during feature work and reduce repeated full verification caused by harness failures. Deliver two stages: focused verification and reliable fixtures, then cheaper setup, shorter test timings and bounded concurrency. Ordinary development follows the updated [testing policy](../testing.md).

## Baseline

Audit revision: `d43a883`. The latest passing full run covered 147 scenarios: 114 workflow, 26 desktop and 7 boundary scenarios. Its command durations totaled 13m 38s: workflow 7m 35s, desktop 5m 45s, types 11.5s, build 2.3s and boundary checks 3.9s. Local evidence: `~/.ash-dev/evidence/493b2ac9f9c9ea33df420831/report.json`.

Across nine successful full runs on October 22, the median was 12m 51s; successful quick checks had a 13.3s median. These runs span different feature revisions and establish direction, not a controlled performance baseline. Freeze a current source and scenario inventory before implementation, including newly integrated features.

## Measured results

Timing checkpoint: `e74b477` · Handoff fixture checkpoint: `fda258d`. Ordinary invocations include prerequisites and cleanup. Quick, routing and layout samples remain labeled `5ee4e7c`; their paths are unchanged. Visibility and full timing samples use the timing checkpoint. The handoff adds only completed Thread-navigation/archive waits and failure snapshots; application and shared harness code are unchanged.

| Selection | Median | Slowest | Samples |
| --- | --- | --- | --- |
| Quick | 16.3s | 17.1s | 5 |
| Routing integration and desktop | 28.0s | 29.7s | 5 |
| Visibility deadline and recovery | 56.2s | 58.0s | 5 |
| Chat layout | 22.4s | 25.1s | 5 |
| Full verification | 7m 34s | 8m 13s | 3 |

The former layout and visibility selections expanded to all desktop checks: about 5m 59s including prerequisites, estimated from the saved baseline commands. The routing pair required both broad suites or the full gate.

Quick and focused feedback meet their targets. Quick increased from the frozen baseline's 12.3s median because it now includes additional verifier failure/cancellation contracts. The two deadline scenarios themselves total a 38.3s median against 110.2s in the reference, a 65.3% reduction.

All three benchmark full runs passed 147/147 scenarios on the first attempt. The subsequent ordinary handoff gate at `fda258d` passed 147/147 in 7m 43s, bringing the corrected Thread fixture to ten consecutive first-attempt passes. Scenario IDs, requirement mappings and existing assertions are preserved; existing checks gained verification and database-conflict guards. Full verification takes 44.5% less time than the [baseline](#baseline). The 40% reduction target is met. The median exceeds the 7-minute aim by 34.1s. This compares three new samples against one complete reference; [baseline replication](#baseline-replication) did not provide the planned three passing samples.

The tracked fragile scenarios and new intake regression each reached ten consecutive first-attempt passes. Ten interruption probes recovered their owned directories and processes; all final cleanup passed. Progress reached the runner within 428ms. These are bounded checks, not estimates of a zero failure rate.

One-worker versus two-worker comparison for `threads,video,topic-tools`: 117.7s in one serial sample against 80.6s in one adjacent parallel sample, 31.5% less time. Both settings use identical corrected source and selected test files; one sample per setting under ordinary background load limits attribution. Median full command time remains concentrated in feature/lifecycle work (4m 10s) and desktop checks (2m 55s).

### Failures retained and corrections verified

| Failure boundary | Verified correction |
| --- | --- |
| Intake capture aborted on a concurrent Thread foreign-key check | A real transaction-barrier regression fails before the correction and passes afterward, proving one committed capture, one filter model call and one source entry. [Preparation retry contract](../features/artifacts.md#implementation). |
| Navigation and sidebar relocation invalidated controls opened on outgoing content | The Thread fixture now completes its draft/navigation and archive/rename journeys through live destination controls. [Fixture guidance](../testing.md#infrastructure). |
| Rail check reused an earlier completed response and did not observe the active emulated preference | Each new response must arrive; reduced motion must be active. The immediate zero-animation assertion and normal-motion sampling remain. |
| Pinned Svelte HMR wrapper duplicated an exit | Disposable test configuration and a one-exit regression isolate the [upstream defect](../testing.md#infrastructure). |

Awake candidate full failures consumed 14m 27s; the post-benchmark navigation diagnostics consumed 3m 47s. Successful timing samples exclude these failures; their outcomes and costs remain in the evidence.

Earlier full and 140-scenario attempts contained confirmed system-sleep gaps; retain their failures and exclude their elapsed times from the speed comparison. Native recording subsequently produced empty output during diagnosis, then passed unchanged once the user confirmed an awake, unlocked desktop. Its precise host cause remains unproven; experimental recording changes were reverted. Final native checks passed ten consecutive first attempts.

Local diagnostics retain successful samples, failed/interrupted attempts, source fingerprints, filtered database/sleep evidence and series manifests: `~/.ash-dev/evidence/testing-improvements-01a166f5/summary.json`.

## Stage 1 Focused verification and reliable fixtures

1. **Add timing and progress to the existing runner.** Record end-to-end elapsed time, group and scenario outcomes, and setup phases: checkout/install, database provision/migration, service readiness, Electron launch, test body and cleanup. Stream redacted progress at phase boundaries, including the active group and completed/selected counts. Attribute concurrent work with timestamps; do not sum overlapping durations as wall time.
2. **Select the smallest independently runnable group.** Add group/file metadata to `tests/scenarios.ts` and use it in `scripts/dev/verify.ts`. Preserve scenario and requirement IDs. A scenario selects its complete ordered group; a requirement selects the union of matching groups. Independent desktop tests can be selected individually. `--list` explains the expansion without provisioning resources. Unknown IDs, missing results and unexpected skips must still fail. Focused verification remains explicitly partial; full verification remains the integration gate.
3. **Pilot three focused selections.** Use routing integration plus its desktop scenario, both visibility deadline/recovery desktop scenarios, and `chat-layout`. Include type checking and relevant build prerequisites in their measured invocation. Add a small group selector only if needed to express the routing pair. Keep the mapping explicit; automatic dependency analysis is deferred.
4. **Centralize the known fixture fixes.** Share safe network-fault setup and teardown, storage initialization before app boot, and helpers that await the live accessible UI after transitions. Apply them first to routing, recording recovery and Topic inspection. Diagnose failures with the affected group before rerunning the full candidate.

Selection contract checks must prove correct group expansion, execution and result accounting. Exercise an intentional assertion failure and an invalid selection to ensure neither can produce a passing or full report. These are verification-boundary checks, not a new unit-test program.

## Stage 2 Cheaper full verification

### Shorter test timings

Try shorter real timings first, as requested. Add an explicit accelerated timing configuration restricted to disposable deterministic test instances. Start by measuring a 1s synthetic visibility deadline and a 100–250ms scheduler tick; these are experiment values, not accepted defaults. Account for debounce and other relevant delays together so shortening one wait exposes the next rather than changing behavior accidentally.

Install draft/recovery protection and confirm the intended precondition before the countdown begins. Await observable state transitions instead of fixed sleeps. Keep assertion timeouts generous: reducing an assertion timeout only makes failures arrive sooner and can increase intermittent failures.

Preserve normal preview/production timing. Test before/at/after deadline semantics through the existing server clock injection. Keep a small real-scheduler path to cover scheduling and cross-process behavior. Use additional clock control only where shorter timings cannot preserve a reliable ordering; browser-only clock changes cannot advance the backend scheduler.

### Separate feature checks from lifecycle checks

Give checkout/install, reset, crash, ownership and hot-reload journeys a dedicated group, retained in full verification. Move ordinary feature checks off fresh Git worktrees where they do not modify source or exercise checkout behavior. Keep tests that change source or configuration isolated.

Six feature groups now reuse the checkout's installed dependencies and read-only source. Mutable state remains per instance. No new persistent build/database cache is introduced; the existing lockfile/setup workflow still owns dependency preparation.

Use the timing breakdown to choose reuse opportunities. Reuse compatible immutable dependencies and builds before considering database templates or persistent workers. Preserve separate mutable databases, files, credentials and browser state. Any cache needs explicit keys covering relevant source, lockfile, tool versions and platform; verify both cache miss and hit behavior. A cached build never substitutes for a test result.

### Introduce bounded concurrency

Benchmark independent integration groups with one and two workers. Keep ordered groups intact and declare exclusive resources for lifecycle operations. Consider two desktop workers only after checking process ownership, database/file separation, hidden-window behavior and screenshot stability. Select the faster configuration only if it meets the reliability criteria below. Ensure failure or interruption stops owned processes and still reports cleanup outcomes.

At each step, retain [coverage and evidence requirements](../testing.md#coverage-policy). Review assertion equivalence when moving checks. Do not trade away recovery, persistence or native coverage to meet a time target.

## Success criteria

Targets apply to the frozen comparison workload. Report feature additions separately so growth does not conceal a regression or inflate the claimed gain.

| Measure | Target | Evidence |
| --- | --- | --- |
| Quick feedback | Median at most 20s | Five ordinary invocations before and after |
| Focused feedback | Each pilot selection has median at most 120s, including prerequisites and cleanup | Five invocations per selection after implementation; compare with the incumbent scope from baseline reports |
| Full verification | Median at least 40% lower with equivalent coverage; aim for 5–7 minutes on the audited 147-scenario workload | Three comparable full runs before and after; successful runs and all failures shown |
| Fixture reliability | Ten consecutive first-attempt passes for each changed fragile scenario; three final full runs pass without retries | Attempt records, errors and cleanup results; this is a bounded stability check, not proof of a zero failure rate |
| Deadline tests | Combined median for `visibility-desktop` and `visibility-recording-recovery` at least 50% below their measured baseline; audit observation was about 110s | Scenario timing, protected-before-expiry assertions and archive-after-release assertions |
| Progress | Active phase visible during long work; outcomes emitted within 1s of completion | Event timestamps compared with runner output |
| Coverage and isolation | Every intended scenario accounted for; preserved assertions, no unexpected skips, no leaked owned resources or changes to the persistent preview | Inventory comparison, failure-path checks, lifecycle evidence and targeted real-app exploration |

## Baseline replication

Two unchanged reruns at `d43a883` failed before desktop execution: `2438115ee2f335cc5f8d48b1` failed Topic inspection, chat unread indication and recording navigation; `6acfce3d8e6ea94c86475932` repeated the Topic inspection failure. Both retained valid source fingerprints. Use the saved complete passing baseline above as a single-sample timing reference and report this replication limitation alongside the final comparison. The failed replications consumed 16m 40s of command time; retain them in reliability/cost accounting.


## Measurement procedure

Run this comparison once for the harness change. Ordinary feature work uses focused checks and the existing full integration gate.

- Freeze source, scenario inventory, fixtures and configuration before each measurement series. Use the same Mac, Node/Electron/Playwright versions, Docker configuration and display environment. Record source fingerprint, timing profile and worker count in every report.
- Measure ordinary warm development runs with installed dependencies. Run the compared conditions sequentially with the same persistent-preview state and no competing full suite. Record load and contention; compare one versus two workers separately from other changes.
- Reuse existing results only when source, workload and environment match. For focused baselines, derive the incumbent expanded-suite cost from those baseline runs and label it an estimate; spot-check one old selection if its prerequisites differ. Avoid five repeated executions of each broad legacy selection. Use the same scenario inventory for the full-suite speed comparison.
- Report median and slowest observed duration, sample size, first-attempt pass counts, failure categories and minutes spent on failed attempts. Keep failed/interrupted runs visible; classify product, harness and environment causes only after diagnosis. These small samples do not support a meaningful p95 estimate.
- Include one explicit cache-miss and cache-hit check for each reuse mechanism, without deleting the user's shared caches. Compare initialization cost and output correctness. Cache benefits and concurrency benefits must be reported separately.
- Keep the experiment bounded. Measure the three focused pilots, repeat only affected fragile scenarios, and perform the full comparison at the final candidate. Count eligible timing samples and full-run scenario passes toward the reliability samples. A failure triggers focused diagnosis; repeat a series only after a relevant fix or changed condition. Matching final full runs also satisfy final verification.

Handoff: a compact before/after table, preserved coverage, first-attempt outcomes, remaining slow groups and any unmet target. Update `docs/testing.md` with implemented commands and selection behavior. Follow the existing [Git integration requirements](../development.md#git-integration); this plan does not authorize integration.

## Deferred work

Product refactors have a separate [launchpad](code-refactor-launchpad.md). Hosted CI, automatic impact analysis, caching passing test results and broad architecture changes are outside this plan.
