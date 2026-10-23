# Model routing implementation

Initial policy implemented · Functional verification performed · Personalized calibration deferred

Behavior: [spec](../../specs/features/model-routing.md) · [implementation/test plan](../plans/model-routing.md)

## Operation

The default `gpt-6.1-sol` live session enables routing. `gpt-6-luna` is the fast candidate; both use low reasoning. Other explicitly configured base models retain fixed-model behavior. Configure the existing owner-only `JEV_API_KEY` alongside `OPENAI_API_KEY`; neither enters the client or captures. Missing/failed Jev routing selects Sol, independently of permission checks. Global **Model routing** guidance is editable in Settings → Instructions and preserved without overwriting user edits on restart.

Use the advanced **Model settings** control to pin Sol/Luna for new responses or return to Automatic. Its dialog, select, status and dismissal use the [shared design system](design-system.md#adding-frontend-ui). Active/waiting Runs and explicit retries retain their captured models. Private is visibly unconfigured; no Chinese/private provider has been selected or integrated.

To disable routing for a new fixed-model session, stop this worktree's preview and restart with `pnpm dev --no-model-routing`. Session settings survive restart; changing the flag requires a new session. Default automated verification stays offline. Routing usage is captured separately from inference; existing session call counters count inference calls, not Jev permission/routing requests.

## Code and persistence

| Path | Responsibility |
| --- | --- |
| `platform/models/jev-router.ts` | Pinned Jev Choice protocol, bounded response decoding, no automatic retries |
| `modules/threads/model-routing.ts` | Prepared-context packet, one-second deadline, policy, transactional selection and sticky upgrade |
| `modules/threads/service.ts` | Accept before assessment, dispatch resolved request, override changes, interrupted retry handling |
| `platform/models/openai.ts` | Fixed/routed model validation and frozen wire settings; shared session reservations |
| `modules/instructions/model-routing.ts` | Initial editable global Instruction; preserves existing text |
| `packages/shared/src/contracts/model-routing.ts` | Routing state, immutable evidence and override validation |
| `ModelSettings.svelte`, `Chat.svelte` | Advanced control and routing inspection |

The server paths above are relative to `packages/server/src/`; client paths are under `packages/client/src/renderer/features/threads/`.

Thread `lifecycle.modelRouting` holds upgrade state, override and its own optimistic revision. Existing visibility updates preserve it through the shared lifecycle schema. Routing does not change archive/read activity or create application-history notices.

A queued Run initially references an immutable `model_routing_request` Act containing the prepared inference context and permitted routing evidence/Instruction snapshot. Selection appends the actual `model_request` beneath it and updates the Run pointer and Thread state atomically before inference. A database trigger protects routing captures. Bypassed sticky/manual selection captures a model request directly. No private continuation crosses a model switch; tool rounds retain their selected model.

Restart interrupts unfinished routing without dispatch. Explicit retry of an interrupted assessment uses its frozen strong request and records that source; completed inference retries retain the selected request. Cancellation before selection commits prevents inference. Overrides changed during assessment are checked under Thread/Run locks before committing selection.

## Verification

Targeted routing integration scenarios and desktop controls passed, along with quick verification (types and boundary checks). Coverage includes actual OpenAI wire model/settings, multi-round tools, sticky upgrades, Instruction snapshots, retry/restart, timeout/cancellation, override races, immutable captures and private bypass. Desktop controls use a controlled live-model API boundary; Instruction editing persists through the actual backend. These checks verify functionality, not Jev quality on personal usage or live latency; no paid API calls were made. A separate hidden desktop exploration verified selection/input inspection, the Instruction editor and keyboard dismissal.

Bounded live smoke, 2026-10-22: the actual application routed formatting to Luna, upgraded a payment-protocol design question to Sol, then kept Sol without another assessment. Three OpenAI responses and two Jev calls completed; routing took 204 ms and 82 ms. This confirms provider integration on synthetic prompts, not personalized calibration or a latency distribution.
