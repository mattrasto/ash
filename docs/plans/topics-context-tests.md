# Topics and working context test plan

Product spec and test plan accepted, 2026-10-12 · Implemented

[Product spec](../../specs/features/topics-context.md) · [Instruction rules](../../specs/features/instructions.md) · [Testing approach](../testing.md)

## Sidebar revision

Accepted, 2026-10-13: expandable sidebar Topics replace Topic management in Settings. Verify Topic creation, menus, linked Thread groups, zero/multiple memberships, expansion persistence across reload/sidebar reopening (including the selected Thread’s group) and new Threads created atomically from the Topic row, including when collapsed. During delayed creation, disable the previous Thread’s composer, preserve its draft and focus the new composer only after creation finishes. Membership uses a checkbox submenu and drag-and-drop links. Check arrow-key/Escape navigation, focus, multiple and zero memberships, duplicate drops, failed/stale saves, collapsed destinations and draft/content/archive preservation. Verify Settings keeps its larger, viewport-bounded dimensions across owner changes, loading, saved/error states and unsaved-change prompts, with internal overflow scrolling. Use Thread terminology in UI, modules and maintained documentation; preserve stable requirement IDs and historical records.

## Acceptance journey

Create an **Insurance** Topic with routing instructions, link an earlier homeowners-insurance thread, then start and link a new thread. Ask about the previously discussed deductible. Ash searches and reads within the linked Topic; inspection shows the applicable response instructions, history and exact retrieved excerpt. Reopen Ash and inspect the same saved record.

Topic routing instructions remain editable but never enter response guidance or trigger organization. Explicit references and automatic routing are outside this plan.

Regression checks: lose a successful Thread-creation response, then retry in the same Topic, another Topic and without a Topic; verify identities and saved memberships. Follow an answer citation after search and a longer read of the same message; it must open that read's exact saved result.

## Fixtures and boundaries

Use real application operations, PostgreSQL and attachment storage with synthetic data: Insurance and Home Topics, a thread shared by both, an archived linked thread, an unrelated thread, and a thread with no Topics. Include saved image descriptions, unanswered inputs, completed/retried/failed answers, long content and enough eligible messages to exceed search limits.

Exercise the narrow Topic retrieval service directly, then through the tools chat's typed handler contract and existing dispatcher. This feature owns selection, source metadata and context UI; it does not introduce another execution loop or change unrelated Run/tool schemas. Test transport validation through the API and substitute only scripted deterministic models or HTTP-mocked providers. Use explicit barriers for concurrent edits and dispatch timing rather than sleeps.

## Accepted numeric limits

The product spec establishes bounded behavior; this plan fixes the implementation limits.

| Boundary | Limit | Required check |
| --- | --- | --- |
| Initial response context | Existing 12,000 characters; existing image budgets | Include applicable instructions and current input without truncation. Older history may be omitted. Test below, at and above the limit. |
| Keyword search | 200 recent eligible messages, at most 10 results and 6,000 excerpt characters total | Stable ordering and deduplication; visible scan/result/output-limit markers. A no-match result after a partial scan is not an exhaustive negative. |
| Read | At most 4,000 excerpt characters per call | Exact source identity, excerpt position and truncation metadata; bounded continuation reads for longer material. |

Retrieval results and subsequent model requests must also respect the dispatcher's result and cumulative context limits. Oversized results remain valid structured output with explicit truncation; they cannot bypass those limits through repeated reads. Do not duplicate dispatcher limit definitions here.

## Automated coverage

IDs are registered in `tests/scenarios.ts`. `tests/integration/topics-context.test.ts` covers service/API/database boundaries; `topic-tools.test.ts` covers the dispatcher, mocked provider and hidden retrieval inspection. `tests/e2e/topics.spec.ts` covers Settings and historical context. Product rules remain in the linked specs.

| Scenario ID | Rules | Observable assertions |
| --- | --- | --- |
| `topics-organization` | TOP-R01–04; TC01–02 | Create/rename/delete Topics; browse linked threads; link/unlink zero, one and multiple Topics. Creating a Topic assigns no Threads. Duplicate commands do not duplicate records; stale changes cannot overwrite newer state. Membership edits preserve messages, drafts, titles, archive state and active work. Deleted Topics cannot acquire new links; their threads remain accessible. |
| `instructions-editing` | INST-R01–03, R07–09; TC03, TC10 | Save each global slot, Topic routing guidance and Thread guidance through the common operations. IDs remain stable; copied text has independent ownership. Reject cross-owner reuse. Empty Topic/Thread text adds no guidance. Save/Cancel and stale concurrent saves preserve the correct document; saving creates no message, Run or automatic organization. |
| `instructions-applicability` | INST-R05–06, R09; I04, I06 | Response requests contain global response text followed by Thread text, with exact identities and order. Topic routing text and image-description guidance are absent, including with several linked Topics. Image-description requests use their own global slot. Text claiming tool permission changes no dispatch grant or retrieval scope. Mocked-provider assertions verify the actual supplied instructions, not a live model's semantic compliance. |
| `context-snapshots` | INST-R04; CTX-R06; TC06 | Pause dispatch after submission, edit response/Thread guidance and Topic routing text, change memberships and delete a Topic. Compare stored and dispatched content exactly: accepted requests and retries retain their snapshots; new submissions use current applicable guidance. Previously captured retrieval results and image descriptions remain unchanged after later edits/completion. |
| `topic-retrieval` | CTX-R02–03; TC02 | Search and read real message text and saved image descriptions in linked and archived threads. Literal case-insensitive search handles punctuation and wildcard characters without widening the query. Overlapping Topics/history do not duplicate content. Latest completed answers follow CONV-R15; internal, unfinished, failed and superseded answers are excluded. Missing descriptions/read targets produce explicit outcomes. |
| `topic-isolation` | CTX-R04, R07; TC01, TC07 | Zero Topics yields no cross-thread results. Unrelated IDs and model-supplied scope overrides cannot bypass eligibility. Adding a Topic during work does not expand captured scope; unlink/deletion prevents later reads through it. Check membership changes on both the requesting and source Threads, including removal between search and read. A remaining eligible Topic still permits access. Already captured content stays readable. |
| `context-limits` | CTX-R05, R09; TC08 | Exercise every numeric edge above, long Unicode text, image descriptions and existing image count/byte limits. Reject oversized required input before partial acceptance/provider dispatch; preserve the draft. Assert exact excerpts, bounded valid output and factual cutoff/count/truncation fields. New metadata contains no generated selection rationale or excluded-candidate assessments. |
| `combined-context` | CTX-R03–04; TOOL-R02, A11 | The running app offers both registrations, executes Topic and filesystem journeys, and inspects both sources from one Run. Invalid filesystem configuration leaves Topic retrieval usable; unlinked Threads receive no Topic tools. Historical mixed-source results remain unchanged. |
| `topic-tool-integration` | CTX-R03, R06–08 | Drive search → read → answer through the actual dispatcher with deterministic and mocked-provider calls. Inspect every supplied excerpt/source identity in the corresponding continuation request. Invalid arguments, out-of-scope reads, cancellation and handler errors use the shared contract. Retry preserves earlier records while any fresh retrieval rechecks scope. Topic handlers cannot supply authorization or change instructions. |
| `context-compatibility` | CTX-R06, R08; TC09 | Inspect and retry legacy global-only text/image captures. After a real backend restart, memberships, independent instructions and exact historical requests/results survive; no work redispatches automatically. Any feature schema migration is additive and agrees with Prisma/DBML; ordinary text/image chat still passes existing coverage. |
| `topics-settings-desktop` | TOP-R01–04; INST-R07–09 | Hidden Electron: create/rename/delete Topics from the sidebar, link/unlink via nested checkbox menus and drag-and-drop, expand groups, create linked/unlinked Threads and switch instruction owners through the common editor. Check purpose labels, keyboard navigation, focus restoration, Save/Discard when switching/closing, Cancel, stale-save errors and draft preservation. Topic deletion explains that threads remain. Assert stable modal bounds and internal scrolling at 1040×830 and 740×650. |
| `context-inspection-desktop` | CTX-R08–09; TC08–09 | Complete the acceptance journey and inspect included instructions/history/retrieved text, source links, pixels versus descriptions and factual limit markers. Distinguish available Topics from sources read, and inspect each model request. Reload/reopen preserves the record. Automated windows stay hidden and non-focusable throughout interaction and resizing. |

Instruction conflict handling inside Route is covered by [incoming-engine verification](../features/artifacts.md#verification). The tools chat owns generic executor/provider fault coverage; these checks exercise Topic integration with that boundary rather than duplicating its test suite. No routine unit-test or line-coverage target is added.

## App exploration and separate review

After automated checks, use a disposable app instance to perform the acceptance journey, edit each instruction scope, switch Topics during work, inspect a truncated result and revisit a historical answer after deletion. Assess readability, keyboard access, error recovery and narrow-window layout. Inspect intentional screenshot changes before updating baselines.

Then review the diff in a separate pass, focusing on scope enforcement, applicable instruction selection, ownership/concurrent saves, immutable captures, query/output bounds, compact metadata and historical compatibility. Turn reproducible findings into regression checks where useful, and recheck fixes.

## Verification and delivery

Use supported Node >=22.12, pinned dependencies and isolated synthetic development data. Run `pnpm verify --profile quick` during implementation and full `pnpm verify` before integration, with source unchanged and baseline updates disabled. Preserve other worktrees' previews and verify cleanup. No paid/live provider calls are required.

Follow the [Git integration requirements](../development.md#git-integration) and verify the integrated revision. Handoff reports concise outcomes and any targeted human checks, without requiring report inspection.
