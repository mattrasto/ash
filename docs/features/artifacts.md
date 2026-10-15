# Incoming Artifact Engine

Behavior accepted · Implemented · Synthetic boundary, desktop and manual acceptance checks passed

[Rules and acceptance](../../specs/features/artifacts.md#incoming-item-slice)

## Boundaries

`modules/artifacts/` owns incoming receipt, Filter, autonomous Route, action/presentation assessment and intake inspection. `Threads` accepts a prepared incoming action into the existing Run path. The tool executor gains only an optional internal-output mode; authorization and Decision waiting/resumption remain owned by their existing feature.

An `incoming_items` row owns delivery identity and processing checkpoint, not a product Run. Input and immutable stage Artifacts own evidence. Only warranted action creates a Run. A busy target retains the item until Run acceptance; no placeholder Run occupies another Thread slot. Startup interrupts unfinished intake; explicit Retry preserves completed stages.

## Verification

`tests/integration/artifacts.test.ts` exercises AE01–11 against real PostgreSQL with synthetic text and controlled provider outputs: receipt identity, targeting and ambiguity, captured guidance, presentation choices, tool authorization, provider limits, dense routing context, busy Threads, failure and explicit retry. `tests/e2e/artifacts.spec.ts` checks source-only and internal-work journeys, inspection, reload, draft preservation and read markers after internal work. Desktop exploration also checked the engine instruction editor; the header baselines include the Processing control at both supported sizes.

A capped live check with seven model calls also passed spam filtering, existing rent-Thread placement and new-matter creation; both useful items selected source-only presentation. This is a small synthetic sample. Broader placement quality still needs evaluation before connecting real incoming sources. Full verification uses the unchanged-source workflow in [Testing](../testing.md).

Human acceptance passed automatic existing/new placement, source-only updates, filtering, actionable responses and inspection.

## Presentation

Use Ash's existing quiet green surfaces and typography. A compact Processing control opens a plain list; selecting an item opens the existing inspector. Source labels distinguish external entries from user chat. Retain current hover/focus transitions, preserve the chat beneath the processing view and respect reduced motion; no decorative animation.

## Implementation

`service.ts` accepts receipts and checkpoints each stage. `context.ts` selects up to 16 candidates from 80 recently active and 40 title-matched Threads, with three 700-character excerpts each; Route captures up to 20 relevant Topic instruction documents. Assessment receives six destination excerpts of up to 1,000 characters. Each stage captures at most 42,000 characters, accepts at most 16,000 output characters and has a 65-second deadline. OpenAI stage requests use the configured model, at most 2,048 output tokens and a 60-second provider timeout. Up to two intake workers run concurrently; each successful untargeted item uses three assessment calls before any optional Act Run. Explicit targets skip the Route model call. No model is called to display inspection.

To fit the stage budget, omit older excerpts from lower-ranked routing candidates first, or older destination history during assessment. Captured scope records included and additionally omitted excerpt counts. Inputs, candidate identities and selected instruction text remain intact; oversized guidance fails before dispatch.

`/api/incoming` supports idempotent receipt and paginated inspection; `/:id/retry` retries failed/interrupted intake. These authenticated local APIs accept synthetic text; provider adapters are deferred. The Processing view exposes these records and a synthetic-item entry form. The existing Instruction editor exposes the three engine guidance documents.

Permissions/Decisions integration remains untouched: `ToolExecutor` changes only final output visibility. This branch adds a narrow `Threads.acceptIncoming` entry point and additive request/message payloads; when integrating alongside the Permissions branch, retain its authorization, waiting/resumption and current policy logic.
