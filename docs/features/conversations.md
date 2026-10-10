# Persisted chat implementation

Deterministic and mocked OpenAI paths verified · Live verification pending

Scope and behavior: [conversation spec](../../specs/features/conversations.md). Verification scenarios: [test plan](../plans/persisted-chat-tests.md).

## Try it

Run `pnpm dev:setup`, then `pnpm dev`. Create a named thread, send a message and follow up. **Inspect** opens the Artifact chain; select its request Act or Ash Surface to see captured model messages, instruction identity, selection/omissions, generation options and Run checkpoint. The inspector refreshes while the selected chain has active work.

The **Test response settings** selector controls the deterministic adapter: normal, slow streaming, failure before output, failure after partial output, or an empty response. It is development behavior, saved in each model request. Explicit deterministic retries reuse the frozen message/context selection and use the current test setting. The default launch makes no external calls. [OpenAI mode](#openai-mode) requires explicit configuration.

**Development checks** retains the original scratchpad for database/file/client isolation checks. Chat drafts and pending delivery keys live in the isolated desktop's browser storage. Accepted messages and execution state live in PostgreSQL.

## Implementation map

| Location | Responsibility |
| --- | --- |
| `packages/server/prisma/` | Six product tables, development baseline and committed SQL migrations. |
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

## Schema operations

Prisma CLI/client are pinned to 6.19.3 and DBML CLI to 10.3.1. `pnpm db:generate` generates the client and runs automatically after dependency installation. Startup of a stopped instance applies committed migrations before launching its backend; a running preview needs Stop/Run after migration changes.

Existing `dev_meta`/`dev_scratch` tables are baselined only in an identity-checked development database. Product migrations then run using its owner role. Runtime credentials have no schema privileges and cannot change immutable identity/provenance columns. The shared bootstrap schema version remains 1; product structure is tracked in Prisma's migration table. Fixture version 2 adds seeded base instructions, including in an otherwise empty instance.

The schema test compares DBML-exported tables with the migrated database and checks Prisma drift. DBML's exporter emits deferrable foreign keys; deployed keys are immediate and non-deferrable. The comparison checks their targets/actions while allowing that exporter difference. SQL-only checks and partial indexes are tested separately.

## Limits

Topic management, instruction editing, archive/pin controls, Artifact moves, image input/generation and generalized background execution remain deferred. A persisted checkpoint does not imply automatic continuation. PITR operation and restore drills remain pending; restart tests establish persistence, not recovery from lost database storage.

## OpenAI mode

Use a development API key with access to the chosen model. In the checkout root, copy `.env.example` to `.env.local`, run `chmod 600 .env.local`, and fill in `OPENAI_API_KEY`. The file is gitignored plaintext, readable only by its owner. The backend reads that entry only when explicitly launched in live mode; other entries are not loaded into the process environment. Normal `pnpm dev` and `pnpm verify` ignore this file and inherited provider keys.

The key stays in `.env.local`; it is not copied into session storage or passed to supervisor/renderer environments. Stop and restart the backend to reload a changed key. Reset and disposal preserve this developer file. Remove its key while stopped to prevent local reuse.

Stop the existing preview before changing modes. Example with an explicitly selected model and allowance:

```sh
pnpm dev:stop
pnpm dev --openai-model MODEL_ID --live-calls 5 --live-minutes 10 --max-output-tokens 1024 --reasoning-effort low
```

Replace `MODEL_ID` with an available Responses model. No live model is selected by default. Reasoning effort is optional and must be supported by that model. For disposable exploration, use the same flags with `pnpm dev:verify --fixture empty`.

The launcher prints a session ID. After Stop/Run, use `pnpm dev --live-session SESSION_ID` (plus `--instance INSTANCE_ID` for disposable instances) to reuse its original allowance and expiry. Hot reload retains that session. Starting without live flags returns to the deterministic adapter. Each new `--openai-model` launch creates a new allowance; it is not a renewal of the prior session.

`--live-calls` and `--live-minutes` are required. Output defaults to 1,024 tokens and each call has a 60-second deadline, shortened by session expiry. Input retains the [context bound](#execution-details). These limits bound work; they are not a dollar-denominated spending cap. Reasoning tokens count toward the output bound.

A slot is reserved on disk before HTTP dispatch; failed or ambiguous attempts still consume it. Concurrent threads share the allowance. Session records contain only settings and usage at `~/.ash-dev/workspaces/WORKSPACE_ID/model-sessions/SESSION_ID/`, outside resettable instance data. Restart, reset and disposal cannot replenish them.

The backend uses the pinned OpenAI SDK and Responses API with `store:false`, no provider conversation ID and no enabled tools. It sends the saved message list and recorded options. SDK automatic retries are disabled. Each explicit OpenAI retry preserves provider/model/options as well as messages; its session must match the model and allow at least the original output limit. A different model requires a new submission.

Streaming deltas and refusal text use the existing Surface persistence path. A completed provider event must agree with the streamed text. Incomplete, truncated, lost or failed streams produce a failed Run and retain partial output. Cancellation aborts the local HTTP stream; it cannot guarantee that provider work or billing stops immediately. The inspector exposes request/response IDs, resolved model, provider status and reported input/output/cached/reasoning tokens. Missing usage stays unknown.

Ash remains the authoritative conversation store. `store:false` disables retained Responses application state; it does not promise zero provider retention. OpenAI documents separate abuse-monitoring and prompt-cache retention. Use synthetic content until the personal-data policy in [G06/G09](../../specs/open-questions.md) is settled. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

The Responses API supports image inputs and a built-in image-generation tool. Ash still needs attachment storage, image payloads and rendering before enabling them. [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision).

## Verification

The deterministic baseline passed `pnpm verify` on 2026-10-09; evidence: `~/.ash-dev/evidence/2ba6f2ea74eb63aa1c53b997/`.

`pnpm verify` passed after moving the key to `.env.local`: typechecking, isolated build, 18 unit tests and 31 integration/desktop checks. Evidence: `~/.ash-dev/evidence/b6ff9bc787b39e5c6b8f721e/` (`report.json`, `checks.log`, `openai-inspection.png`); zero live calls. All assertions passed, but the workflow runner needed manual cleanup of one lingering Electron test process before exiting. A separate review checked live-only key loading, environment isolation, session counters and reset/disposal behavior; the screenshot confirms provider metadata remains visible.

Live model quality, account access and paid usage have not been tested. See the [test plan](../plans/persisted-chat-tests.md#openai-adapter).
