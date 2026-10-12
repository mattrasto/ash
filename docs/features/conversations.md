# Persisted chat implementation

Deterministic, mocked OpenAI and bounded live text paths verified · [Image extension](images.md) verified

Scope and behavior: [conversation spec](../../specs/features/conversations.md). Verification scenarios: [test plan](../plans/persisted-chat-tests.md).

## Try it

Run `pnpm dev:setup`, then `pnpm dev`. Create a named thread, send a message and follow up. **Inspect** opens the Artifact chain; select its request Act or Ash Surface to see captured model messages, instruction identity, selection/omissions, generation options and Run checkpoint. The inspector refreshes while the selected chain has active work.

The **Test response settings** selector controls the deterministic adapter: normal, slow streaming, failure before output, failure after partial output, or an empty response. It is development behavior, saved in each model request. Explicit deterministic retries reuse the frozen message/context selection and use the current test setting. The default launch makes no external calls. [OpenAI mode](#openai-mode) requires explicit configuration.

**Development checks** retains the original scratchpad for database/file/client isolation checks. Chat drafts and pending delivery keys live in the isolated desktop's browser storage. Accepted messages and execution state live in PostgreSQL.

## Implementation map

| Location | Responsibility |
| --- | --- |
| `packages/server/prisma/` | Product tables, development baseline and committed SQL migrations. |
| `scripts/dev/product-database.ts` | Guarded baseline/deploy, seeded base instructions and restricted runtime grants. |
| `packages/server/src/modules/conversations/` | HTTP routes, submission transactions, streaming persistence, cancellation, retries and inspection. |
| `packages/server/src/modules/context/select.ts` | Current-thread Surface selection and omission metadata. |
| `packages/server/src/platform/models/` | Deterministic and OpenAI adapters, safe provider metadata, bounded live sessions. |
| `packages/shared/src/contracts/conversations.ts` | Command validation, payload/checkpoint schemas and client contracts. |
| `packages/client/src/renderer/features/conversations/Chat.svelte` | Thread list, transcript, composer, pending delivery and inspector. |

## Execution details

The backend owns execution independently of a desktop window. A dedicated database connection holds an advisory lock before unfinished work is marked interrupted. Loss of that connection terminates the backend; another process cannot perform startup recovery while the original owner holds the lock.

Submission uses a serializable transaction and thread lock. Conflicting transactions retry before dispatch. Each accepted command has a stable key and command hash; repeated delivery reads the existing Run before checking whether the thread is busy. Streaming writes and cancellation serialize on the Run row. Response creation, checkpoint changes and completion are committed together as required by the [data-model contract](../data-model.md#execution-and-transactions).

The desktop polls saved snapshots every 150 ms while a response is active and every 800 ms otherwise. This is the initial incremental delivery transport; no durable event stream is added. A reconnect fetches state without dispatching work. Snapshots use a consistent database transaction so content and Run outcome agree.

Context uses a 12,000-character budget and a 4,000-character input limit; this is an application bound for both adapters, not a token estimate. Selection follows CONV-R15. Older conversation groups are omitted together when they do not fit; the current message and base instructions must fit. The captured request records every selected source and excluded Surface.

## Conversation controls

The [UX review](conversation-ux.md) records the Asha comparison and test plan. `Sidebar.svelte`, `Message.svelte`, `Menu.svelte`, `scroll.ts` and `streaming.ts` own the interaction behavior; `Chat.svelte` owns API/draft state and inspection.

`GET /api/threads` includes archived rows and each thread's latest Run identity/outcome. `POST /api/threads/:id` accepts only a nonempty title and/or archive flag. Metadata changes preserve activity order and do not alter Runs. The first-message title is committed in the same transaction as accepted input and only replaces an empty conversation's “New conversation” placeholder (80-character display bound). UI names never enter captured model requests.

No product migration is needed: the existing `threads.is_archived` field is used. Restart an existing development instance once to apply its additive runtime column grant. Preserve the current live session ID when restarting.

## Schema operations

Prisma CLI/client are pinned to 6.19.3 and DBML CLI to 10.3.1. `pnpm db:generate` generates the client and runs automatically after dependency installation. Startup of a stopped instance applies committed migrations before launching its backend; a running preview needs Stop/Run after migration changes.

Existing `dev_meta`/`dev_scratch` tables are baselined only in an identity-checked development database. Product migrations then run using its owner role. Runtime credentials have no schema privileges and cannot change immutable identity/provenance columns. The shared bootstrap schema version remains 1; product structure is tracked in Prisma's migration table. Fixture version 3 seeds response and image-description instructions, including in an otherwise empty instance. Existing instruction text is preserved.

The schema test compares DBML-exported tables with the migrated database and checks Prisma drift. DBML's exporter emits deferrable foreign keys; deployed keys are immediate and non-deferrable. The comparison checks their targets/actions while allowing that exporter difference. SQL-only checks and partial indexes are tested separately.

## Limits

Topic management, instruction editing, pin controls, Artifact moves, image generation and generalized background execution remain deferred. [Image input and descriptions](images.md) are implemented separately from chat response Runs. A persisted checkpoint does not imply automatic continuation. PITR operation and restore drills remain pending; restart tests establish persistence, not recovery from lost database storage.

## OpenAI mode

Use a development API key with access to the chosen model. In the checkout root, copy `.env.example` to `.env.local`, run `chmod 600 .env.local`, and fill in `OPENAI_API_KEY`. The file is gitignored plaintext, readable only by its owner. The backend reads that entry only when explicitly launched in live mode; other entries are not loaded into the process environment. Normal `pnpm dev` and `pnpm verify` ignore this file and inherited provider keys.

The key stays in `.env.local`; it is not copied into session storage or passed to supervisor/renderer environments. Stop and restart the backend to reload a changed key. Reset and disposal preserve this developer file. Remove its key while stopped to prevent local reuse.

Stop the existing preview before changing modes. Interactive chat has no session call cap or expiry:

```sh
pnpm dev:stop
pnpm dev --openai-model MODEL_ID --max-output-tokens 1024 --reasoning-effort low
```

Replace `MODEL_ID` with an available Responses model. No live model is selected by default. Reasoning effort is optional and must be supported by that model. For an explicitly bounded session, add both `--live-calls` and `--live-minutes`. Disposable live exploration with `pnpm dev:verify --fixture empty` requires those limits; ordinary `pnpm verify` uses no live calls.

The launcher prints a session ID. After Stop/Run, use `pnpm dev --live-session SESSION_ID` (plus `--instance INSTANCE_ID` for disposable instances) to retain its model, settings, call counter and any limits. Hot reload retains that session. Starting without live flags returns to the deterministic adapter. Each new `--openai-model` launch creates a new session; it does not renew a prior bounded allowance.

Output defaults to 1,024 tokens and each call has a 60-second deadline, shortened by expiry when the session is bounded. Input retains the [context bound](#execution-details). These per-request limits still apply to interactive chat. Reasoning tokens count toward the output bound; no dollar-denominated spending cap is enforced.

A call is counted on disk before HTTP dispatch, including failed or ambiguous attempts. Concurrent threads share the counter and any bounded allowance. Session records contain only settings and usage at `~/.ash-dev/workspaces/WORKSPACE_ID/model-sessions/SESSION_ID/`, outside resettable instance data. Restart, reset and disposal cannot replenish a bounded allowance. Interactive records explicitly store null call/expiry limits and are accepted only for the persistent preview.

The backend uses the pinned OpenAI SDK and Responses API with `store:false`, no provider conversation ID and no enabled tools. It sends the saved message list and recorded options. SDK automatic retries are disabled. Each explicit OpenAI retry preserves provider/model/options as well as messages; its session must match the model and allow at least the original output limit. A different model requires a new submission.

Streaming deltas and refusal text use the existing Surface persistence path. A completed provider event must agree with the streamed text. Incomplete, truncated, lost or failed streams produce a failed Run and retain partial output. Cancellation aborts the local HTTP stream; it cannot guarantee that provider work or billing stops immediately. The inspector exposes request/response IDs, resolved model, provider status and reported input/output/cached/reasoning tokens. Missing usage stays unknown.

Ash remains the authoritative conversation store. `store:false` disables retained Responses application state; it does not promise zero provider retention. OpenAI documents separate abuse-monitoring and prompt-cache retention. Use synthetic content until the personal-data policy in [G06/G09](../../specs/open-questions.md) is settled. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

The Responses API supports image inputs and a built-in image-generation tool. Ash now supports image input; the built-in image-generation tool remains deferred. [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision).

## Verification

Latest conversation UX verification and evidence: [UX review](conversation-ux.md#verification).

The deterministic baseline passed `pnpm verify` on 2026-10-09; evidence: `~/.ash-dev/evidence/2ba6f2ea74eb63aa1c53b997/`.

`pnpm verify` passed after separating interactive sessions from bounded live tests: typechecking, isolated build, 20 unit tests and 32 integration/desktop checks. Evidence: `~/.ash-dev/evidence/a3811acde49c79b7168d645d/` (`report.json`, `checks.log`, `openai-interactive.png`); zero live calls and automatic cleanup completed. Tests cover interactive calls beyond five requests and eleven simulated minutes, retained bounded-session enforcement, and the desktop without a countdown. A separate review checked paired limits, preview-only interactive sessions, backward compatibility with bounded records and preserved per-request deadlines.

### Live text smoke test

Passed 2026-10-12 on `8ef4380` using `gpt-6.1-sol`, low reasoning, with the approved maximum of five calls over ten minutes and 1,024 output tokens per call. Four calls covered a synthetic checklist, a follow-up with exact captured history, cancellation after partial output, and a completed retry with the original request. Electron inspection showed provider IDs and usage. Backend restart and desktop reopen preserved the conversation and call counter without another dispatch.

Three completed calls reported 391 input and 370 output tokens (761 total). The cancelled call reported no usage; these totals exclude its unknown billable work. Provider dashboard/billing reconciliation was not performed. The disposable instance was removed and the persistent preview remained in deterministic mode.

Evidence: `~/.ash-dev/evidence/live-f484cd4b6d74c96c340f9c56/` contains the source fingerprint, session ID/counter, individual Run outcomes, captured conversation/inspection, smoke driver and desktop screenshots. This establishes live text connectivity and the tested flows; image verification is recorded in the [image implementation](images.md); broader quality evaluation remains deferred. [Repeat procedure](../plans/persisted-chat-tests.md#live-smoke-test).
