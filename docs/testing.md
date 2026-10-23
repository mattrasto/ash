# Testing

Approach accepted, 2026-10-09 · Group selection, phase timing and disposable test timing implemented · Autonomous promotion deferred

Implementation and measurement: [testing improvement plan](plans/testing-improvements.md).

Verify observable behavior at stable boundaries and through real user journeys. Repository commands own execution and evidence so Codex and, later, Ash can use the same workflow. Reports are agent diagnostics; the human receives a concise outcome and targeted manual checks when their judgment is needed.

## Verified baseline

Revision `8a9650c`, macOS arm64, 2026-10-09: full automated verification passed all 20 scenarios, including cleanup. The user confirmed the `desktop-experience` manual check passed: disposable preview, editing, compact mode, resizing, keyboard focus, app/Spaces switching and shutdown with the persistent preview preserved. This establishes the initial local baseline; future relevant changes still require the checks below.

## Coverage policy

- No routine unit-test requirement or line-coverage target. Prefer integration tests over implementation-shaped mocks. Retain small invariant checks where they cheaply protect filesystem isolation, credentials, locking or process ownership.
- Integration tests use real internal components, including PostgreSQL and filesystem state. Substitute controlled adapters at external boundaries. Test invalid input, retries, interruption and recovery as well as success.
- Scripted E2E tests and agent exploration use the hidden [background mode](development.md#startup-and-process-ownership); add `--background` when exploring with `pnpm dev:verify`. Reserve visible windows for user-facing demonstrations or native-window checks and announce them before opening. Seed through fixture infrastructure; do not bypass the operation under test with direct state edits.
- UX checks include keyboard access, focus, visible status, draft preservation, scrolling and supported window sizes as relevant. Automated accessibility checks complement interaction testing when added.
- Visual comparisons detect changes against reviewed baselines. Agent exploration evaluates clarity and design quality against the intended experience. Keep these judgments distinct from deterministic passes.
- Write short manual procedures for critical flows and native behavior. Do not require a human to inspect reports or repeat every automated check.

Choose acceptance criteria before implementation. Each scenario references stable IDs in feature specs or [workflow acceptance](development.md#workflow-acceptance); a passing linked scenario does not imply every clause of that requirement is covered.

## Commands

Run from the checkout root. Docker and an awake, unlocked graphical macOS session are required for workflow and desktop suites; quick checks need neither Docker nor Electron. Process inspection and writes to the development evidence directory still require appropriate host permissions.

| Command | Scope |
| --- | --- |
| `pnpm verify` | Full: types, isolated build, boundary checks, real-worktree lifecycle checks and desktop scenarios. Required before integration. |
| `pnpm verify --profile quick` | Types and boundary checks for iteration; reported as partial verification. |
| `pnpm verify --scenario chat-layout` | Types, build and only the independent layout scenario. |
| `pnpm verify --group model-routing --scenario model-routing-desktop` | Types, build, the ordered routing integration group and its desktop scenario. |
| `pnpm verify --scenario DEV-07` | Types, build and complete execution groups containing checks linked to DEV-07. |
| `pnpm verify --workers 1` | Serialize feature groups and desktop files for diagnosis or comparison; lifecycle groups always run alone. |
| `pnpm verify --timing normal` | Use normal scheduling in disposable test instances for comparison. |
| `pnpm verify --list` | JSON scenario inventory with group/file expansion; combine with profile/scenario/group selection. No resources are provisioned. |
| `pnpm test:boundary`, `pnpm test:workflow`, `pnpm test:desktop` | Direct suite commands for debugging; `pnpm test` aliases the boundary suite. Use `verify` for an aggregate report. |
| `pnpm dev:verify --fixture scratchpad --deterministic` | Fresh offline disposable app for exploration/manual checks; Ctrl+C stops and disposes it. For live exploration, use the [bounded model options](features/threads.md#openai-mode). |

Selection expands a scenario or requirement to its complete execution group, preserving ordered setup. Comma-separated scenario/requirement IDs and group names select their union. Independent desktop scenarios each have their own group. `tests/scenarios.ts` owns group membership, files and exclusive lifecycle groups. Reports distinguish selected groups from full verification; missing results, unexpected results, skips and failed attempts fail the run. Shared runtime, schema, dependency or verification changes still require full verification. Automatic diff-based selection remains deferred.

The verifier defaults to two workers and records its worker count and timing profile. Direct suite commands default to one worker and normal timing. Accelerated timing is admitted only in disposable `test` instances using the deterministic model. It shortens synthetic visibility deadlines, debounce and scheduler intervals; assertion timeouts retain their normal margin. Preview/verification instances use normal timing. The controlled OpenAI protocol group explicitly uses normal timing because it exercises live-session configuration. Deadline boundary integration tests retain their injected clock. See the [improvement plan](plans/testing-improvements.md) for measurement targets and evidence.

## Infrastructure

| Path | Responsibility |
| --- | --- |
| `tests/scenarios.ts` | Scenario IDs, requirement references, suite/fixture metadata and authored manual procedures. No duplicate product rules. |
| `tests/support/desktop.ts` | Shared Electron launch and authenticated backend inspection. |
| `tests/support/fixtures.ts` | Fresh instance per desktop test, diagnostic capture and disposal. |
| `tests/support/node-scenarios.ts` | Record named Node test outcomes without replacing the test runner. |
| `tests/support/playwright-reporter.ts` | Playwright outcomes, attempts and artifact references, including fixture failures. |
| `tests/boundary/` | Fast ownership invariants and verification CLI contract checks. |
| `tests/integration/workflow.test.ts` | Ordered lifecycle journey across real detached worktrees and isolated infrastructure. |
| `tests/e2e/`, `tests/playwright.config.ts` | Playwright Test scenarios against Electron; bounded file concurrency, no automatic retries. |
| `tests/baselines/` | Versioned screenshot expectations. |
| `scripts/dev/verify.ts` | Selection, progress, command execution, source validation, recovery cleanup and aggregate evidence. |
| `scripts/dev/test-workflow.ts` | Bounded feature concurrency followed by exclusive lifecycle groups. |
| `scripts/dev/telemetry.ts` | Phase/scenario events and ownership records for disposable resources. |
| `tests/support/ui.ts`, `tests/support/electron.ts` | Polling-safe route teardown, reload fixtures, live inspector controls and tracked Electron launches. |

Reuse the [instance lifecycle and data isolation](development.md#workspace-and-instance-identity). Test instances never reset the persistent preview. Ordinary desktop tests dispose their own instances while retaining the shared development database service. The infrastructure lifecycle suite owns and removes its separate temporary cluster.

Disposable `test` instances disable hot reload. Svelte 5.55.7's HMR wrapper can collect the same transition twice, leaving a reopened inspector outside the viewport; [upstream fix](https://github.com/sveltejs/svelte/pull/18655). Feature checks retain real motion and pointer actions. Preview/verification profiles retain hot reload, exercised by the exclusive lifecycle group. Revisit this configuration when upgrading Svelte.

Keep network fault-injection routes installed during polling scenarios and switch their response behavior. Toggling Electron request interception can abort unrelated requests in flight and turn a simulated failure into a test-harness failure. After navigation or archive commands, await the destination, restored draft and settled archive state before using the new controls.

Desktop scenarios assert that hidden windows remain invisible and non-focusable through interaction, resize and reload, then exercise keyboard message submission, persisted threads, drafts, sidebar preferences and Artifact inspection after reopening, plus thread screenshots at 1040×830 and 740×650 content sizes. Workflow checks retain database/file isolation, reset, crash recovery, hot reload and disposal coverage. The thread, image and mocked OpenAI integration checks are registered in the scenario inventory; boundary checks also run the existing context, storage and model tests.

## Design requirements

Frontend changes must identify affected [DS-R requirements and DS-V acceptance scenarios](../specs/design-system.md). Hard requirements need observable checks, automated where reliable and explicit manual checks where necessary. Experiential principles need real-app review against Final; optional/deferred refinements do not block delivery. Record actual coverage and gaps in the [design implementation](features/design-system.md#verification-coverage).

Check motion separately from reduced-motion screenshot baselines. Wait until the renderer observes reduced motion before triggering an action; verify zero animation duration separately from asynchronous animation-object cleanup. Exercise popup/dialog focus, reversal, editing and streaming continuity, native fallbacks, varied scenes and stacked glass where affected. Retain existing feature checks. A screenshot match is not evidence of contrast, keyboard behavior or performance. During replacement, query the live named region or accessible roles; text-only queries can also match inert visual copies. For reversal from a fully open state, await settled content as well as material.

## Visual expectations

Playwright Test compares screenshots with `updateSnapshots: 'none'`; a missing baseline fails. Baselines are partitioned by OS and architecture, with Electron/Playwright pinned in the lockfile. Match OS version, display scale and fonts when comparing; a new environment needs its own reviewed expectations. Initial baselines cover macOS arm64 only.

Static layout scenarios use reduced-motion mode to avoid entry/stream animation timing; integration scenarios cover motion and scrolling. The desktop test helper sets macOS `AppleShowScrollBars=Always` through the [process argument domain](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/UserDefaults/AboutPreferenceDomains/AboutPreferenceDomains.html#//apple_ref/doc/uid/10000059i-CH2-SW4), preserving baseline geometry without changing user preferences. Preview identity text is normalized, and variable response timing/thread age are hidden by `tests/support/visual.css`. Product colors remain unchanged in screenshots. The background desktop scenario checks the displayed identity against the API; the workflow identity scenario checks branch creation, rename and detached HEAD without changing instance ownership. The remaining thread layout and content are real. These screenshots do not cover the hidden metadata; interaction tests cover its behavior. Reviewed images record the current implementation, not human approval of its design.

For an intentional visual change:

1. Run `pnpm test:desktop --update-snapshots` explicitly.
2. Inspect changed images and explain the intended design change. Do not regenerate expectations merely to make a failing check pass.
3. Run `pnpm verify` with baseline updates disabled on the final source.

Electron automation is [experimental](https://playwright.dev/docs/api/class-electron). Screenshot comparisons have [environment sensitivity](https://playwright.dev/docs/test-snapshots). Native focus, Spaces, window management and subjective design quality still need exploration/manual judgment.

## Evidence and handoff

Each verification session prints an evidence directory outside disposable state. It retains `report.json`, `checks.log`, scenario records, screenshots, action traces, cleanup diagnostics and, when relevant, `manual-plan.md`. Direct desktop runs use ignored `out/verification` output relative to the test configuration and may replace previous direct-run artifacts.

Reports identify source commit and content fingerprint, lockfile, runtime versions, fixtures/schema, model mode, selected scope and command/scenario outcomes. Version 2 adds end-to-end duration, worker/timing configuration, timestamped phase/scenario events and recovery cleanup outcomes. Phase spans may nest or overlap; use timestamps rather than adding them to infer elapsed time. Progress streams as scenarios and setup phases execute. Resource recovery uses recorded instance ownership, process start identities and session-scoped checkouts/clusters; cleanup failure still fails verification. The fingerprint covers code, tests, baselines, specs, engineering docs and workflow configuration, including uncommitted additions/deletions. A changed source invalidates the session even if tests pass; verification does not freeze files or detect every transient edit reverted before the final fingerprint. Keep source unchanged while verifying. Recheck the integrated revision after merge.

Missing selected results are blocked; omitted scenarios are not-selected; failed attempts remain failures even if a retry passes. Cleanup failure fails its suite. Human checks remain pending and agent review remains unrecorded until separately performed; an automated pass makes no claim about either. Reports are local diagnostics, not tamper-resistant attestations.

Only synthetic data is allowed. Logs redact credential-shaped fields; runtime configuration is never copied into evidence. Desktop traces retain actions/screenshots with network/DOM snapshots and source capture disabled to avoid recording authenticated requests. Review any new diagnostic capture for secret leakage. Forced termination may leave owned resources for recovery; never claim successful cleanup without evidence.

Before handoff, the coding agent reviews the diff in a separate pass and explores the actual app. Report what works, what was verified and material limitations. Present manual steps directly in the thread when needed, drawn from the selected procedures; do not ask the human to read a report. A discovered reproducible bug becomes an automated regression scenario where useful.

## Product and self-modification extensions

The deterministic adapter covers streaming, controlled delay, failure and cancellation while internal persistence/context processing remains real. Product coverage and remaining acceptance gaps live in the [chat test plan](plans/persisted-chat-tests.md) and [image test plan](features/images.md). Mocked Responses checks run offline; live-model usefulness is evaluated separately. [OpenAI mode](features/threads.md#openai-mode) keeps ordinary interactive sessions uncapped and optional live tests bounded. Exhausting a live budget does not stop offline verification.

The approved [inspectable tools test plan](plans/inspectable-tools-tests.md#automated-scenarios) covers shared dispatch and feature-specific handlers. The scenario inventory lists the checks available in this checkout; generic execution/provider tests do not require filesystem or Topic implementations.

Recovery verification follows [backup and recovery](data-model.md#backup-and-recovery): restore a physical backup plus archived WAL into a separate PostgreSQL instance, verify state at the chosen time with zero external calls, and check startup interruption handling separately.

Ash can invoke the same commands and attach reports to Runs and Decisions. [Local renderer application](features/adapt.md#local-application) adds a fixed protected verifier outside candidate-controlled source. Broader code promotion still requires protected required checks and explicit review of changed tests, baselines and verification policy. The candidate cannot establish trust by modifying its own pass criteria. A separate reviewer helps but does not enforce that boundary.

Broader promotion must reference the exact verified revision and migration/recovery evidence. Passing tests does not authorize replacing the running product. Execution isolation, rollout authority and rollback remain G08/G10; Git rollback alone cannot reverse a database migration. Hosted CI, live providers, automatic impact analysis and source integration remain outside the scenario harness.
