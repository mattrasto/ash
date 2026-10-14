# Inspectable tools: delivery and test plan

Product behavior and test plan approved, 2026-10-12 · Implemented · [Verification](../features/tools.md#verification)

[Product rules and acceptance](../../specs/features/tools.md) · [Asha source review](../features/tool-use-reference.md) · [Testing policy](../testing.md) · [Delivery agreement](../../specs/product.md#confirmed-engineering-agreement)

[Execution implementation](../features/tools.md) · [Filesystem configuration](../features/filesystem.md)

## Scope

This slice covers model adapters, Run execution/storage, dispatch, filesystem tools and inspection. Topics, instructions, context selection and Topic retrieval are separate features using the additive tool contract. Deferred capabilities remain listed in the [product scope](../../specs/features/tools.md#scope-and-flow).

## Dispatch and storage design

### Filesystem and authorization

Implement [TOOL-R12](../../specs/features/tools.md#initial-filesystem-tools) with live filesystem operations. Capture canonical file identity, observation time, returned-content hash and one-based inclusive line references. A hash of an excerpt must be labeled as such; neither it nor a Git revision implies a whole-filesystem snapshot. Verify identity against the content actually read, including when a file changes during access.

Provide `filesystem.list`, `filesystem.read`, `filesystem.glob` and `filesystem.search`. Each operation applies current configured scopes to every reached target, including descendants and symlink destinations. Constrain metadata resolution and traversal as well as content reads; opening a file must not introduce a path-resolution race that bypasses scope checks. Report unreadable/unsupported files and bounded-search omissions. Use bounded literal content matching initially; regex evaluation is not required by the product spec.

The common authorization boundary implements the accepted [permission staging](../../specs/features/tools.md#accepted-decisions). Capture normalized action/targets, effective operation grant, configuration revision and check outcome under PERM-R13. Recheck at dispatch and for resources discovered during execution. Each configured scope states the allowed operations explicitly; reject ambiguous or incomplete scope configuration rather than inventing inheritance rules. More-specific restrictions override broader access under PERM-R07. No scope grants no access; an unavailable evaluator is recorded as not performed, never as approval.

Development setup uses synthetic fixtures or explicitly selected source directories, with configured exclusions for credentials, runtime data and Git internals. Verify exclusions without reading actual secrets. They are development configuration, not a permanent protected-path policy. Setup describes retention and transmission of returned content to the selected model. No permission-management UI, classifier, sensitive-action detector, Decision or waiting state is introduced.

### Model rounds and scheduling

Accept calls only from a complete successful model response. Validate names and complete arguments server-side; never execute argument deltas. Persist proposals in provider order, then schedule bounded concurrent calls whose handlers declare safe independence. Other calls execute exclusively. Dependencies use results from completed rounds before a subsequent request; this slice needs no model-authored dependency graph. Store proposal order separately from dispatch/completion times. Continuations associate results by call identity and use stable proposal order even when completion order differs.

Persist each model request before provider dispatch; persist complete calls and the checked dispatch identity before handler execution; persist each result before the next model request. Advance a versioned checkpoint transactionally at each boundary, including when parallel completions race. The checkpoint references independently recorded call states rather than replacing the whole batch with the last completion. Keep transcripts/results in Artifacts and opaque provider data in restricted backend storage. Preserve the [single-source Artifact rule](../../specs/features/artifacts.md#rules); earlier results are context references, not extra causal parents.

Treat intermediate assistant text as public model-step commentary. Only a completed round without tool calls supplies the final answer. Preserve existing text-only streaming and settled Surfaces; do not erase a visible answer to conceal an intermediate step. Derive UI progress and inspection from the same persisted records, including overlaps and individual errors.

Scope provider call IDs to their model step. Duplicate delivery reuses its durable dispatch/result identity; conflicting duplicate payloads are protocol errors. An equivalent query with a new call ID is new bounded work. Reserve call counts, concurrency and result capacity atomically so parallel calls cannot overspend limits. Count consecutive errors in proposal order, not completion order. Recoverable validation, denied-action and handler errors produce structured results for correction within the remaining allowance. A protocol/storage failure or exhausted Run limit stops new dispatch, cancels active work and preserves prior evidence.

### Stop, restart and retry

Pass cancellation to preparation, scope checks and every active handler. Cancellation and dispatch admission share a durable state check so queued calls cannot start after Stop is accepted. Late output cannot revive the Run or replace terminal records. Use the last durable checkpoint for the distinct outcomes required by TOOL-R10.

Backend startup marks unfinished work interrupted without dispatch. Reconnect and inspection only read saved records. Explicit Retry creates a linked Run from the captured initial request, rechecks current access and makes new observations; it does not substitute old results for fresh reads. Current authority and retry limits remain separate from the immutable request. Future effectful tools must declare whether repetition is safe or requires outcome reconciliation.

### Execution limits

| Bound | Default |
| --- | --- |
| Model calls / tool calls per Run | 8 / 12 |
| Concurrent independent calls per Run | 4 |
| Consecutive tool errors / repeats of the same normalized action | 3 / 3 |
| Tool argument nesting / argument-string length | 64 JSON containers / 32,768 characters |
| Tool deadline | 5 seconds, including preparation |
| Result bytes per call / cumulative per Run | 32 KiB / 128 KiB |
| Required provider continuation data per Run | 1 MiB |
| Distinct access-check records per call | 512; exceeding this limit fails the call |
| Bytes examined per file per call | 1 MiB |
| Search/traversal work per call | 5,000 entries and 32 MiB examined |
| List/path matches / content matches | 500 / 200 |

Record effective limits with the initial request. Existing model deadlines/output limits and provider-session allowances also apply. Stop traversal at work limits with explicit omissions; do not load an unbounded file to produce a bounded excerpt. Truncate structured results at item/content boundaries, never by slicing serialized JSON. Required continuation material cannot be silently dropped. A terminal limit has a specific stop reason and does not expire the interactive model session. Result envelopes must retain room for errors and omission metadata.

## Handler contract

The [registration seam](../features/tools.md#handler-registration) is in `packages/server/src/modules/tools/contract.ts`; cross-process call/result/inspection shapes belong in `packages/shared/src/contracts/tools.ts`. Keep provider SDK types and permission logic out of shared.

```ts
interface ToolHandler<Args, Prepared extends PreparedToolAction> {
  definition: ToolDefinition;
  parse(input: unknown): Args;
  prepare(args: Args, context: ToolContext): Promise<Prepared>;
  execute(action: Prepared, context: ToolContext): Promise<ToolResult>;
}
```

`ToolDefinition` declares stable name/version, description, argument schema, limits, effects, concurrency safety and repeatability. `parse` has no effects. `ToolContext` carries trusted Run/thread/call identity, an AbortSignal and scoped resource access. `PreparedToolAction` contains normalized operation, resource/scope identities and known effects; content identity can be attached after observation. Preparation cannot read unrestricted content or execute the requested action. Dynamic traversal uses trusted per-target authorization rather than allowing a handler to authorize itself.

The dispatcher owns authorization, persistence, scheduling, deduplication, deadlines, result validation/bounds and exception sanitization. Handlers cannot supply captured model instructions. `ToolResult` is a JSON-safe success/error union with bounded content, typed source references and omission metadata; [implemented content support](../features/tools.md#execution-and-inspection). Filesystem-specific evidence belongs in its reference type; another retrieval handler can provide resource identities without importing filesystem internals.

Publish additive exports and keep readers for historical text/image requests and legacy Run checkpoints. Provider wire names may encode canonical names as API-compatible function names; inspection retains canonical names. The [structured retrieval fixture](../../tests/support/retrieval-tool.ts) exercises the contract independently of Topic retrieval.

## OpenAI continuation evidence

Checked official documentation and installed `openai@7.32.0` on 2026-10-12. With `store:false`, replay prior output items and matching `function_call_output` items in order. Current guidance supplies encrypted reasoning by default and still accepts `include: ["reasoning.encrypted_content"]`. Do not flatten reasoning/function items into text or rely on `previous_response_id`. [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses)

The installed SDK defines `ResponseFunctionToolCall`, `ResponseReasoningItem` and `toResponseInputItems` in `src/resources/responses/responses.ts` and `src/lib/responses/ResponseInputItems.ts`. Its conversion helper removes output-only/SDK fields without mutating saved items; unsupported types throw, and some non-replayable types can be omitted. Validate supported output kinds before conversion so omission cannot silently lose required continuation. Preserve completed opaque reasoning items, using terminal output rather than partial `output_item.added` material. Keep them backend-only, linked by identity/hash to public records; never expose them through inspection JSON, copy-context, errors, logs or diagnostics. [SDK usage](https://developers.openai.com/api/docs/guides/deployment-checklist)

Use strict function schemas and enable parallel function proposals for supported models. Backend scheduling still enforces handler safety and concurrency limits; provider settings do not authorize dispatch. Keep SDK automatic retries disabled. Each continuation consumes the existing durable provider-call allowance before HTTP dispatch. [Function calling](https://developers.openai.com/api/docs/guides/function-calling)

## Automated scenarios

Use real PostgreSQL, temporary filesystem scopes, dispatcher and Run services. Substitute scripted deterministic events or HTTP-level Responses SSE at the external model boundary. Shared checks TOOL-02, 06–14, 17–18, 22–23 live in `tests/integration/tools.test.ts`. The filesystem feature adds `tests/integration/filesystem-tools.test.ts` for TOOL-01, 03–05, 15–16, 19–21, 24 and filesystem-specific validation/limits. `tests/scenarios.ts` lists the checks available in each checkout; existing adapter boundary tests cover additional provider failures. Full `pnpm verify` includes every registered check.

| ID | Scenario and observable assertions |
| --- | --- |
| TOOL-01 | List/path lookup → search → read across several model calls → cited answer. Verify file/line/hash references, supplied definitions/scopes/options, immutable requests/results, metadata and single-source lineage. Ordinary text/image conversations work without filesystem configuration. |
| TOOL-02 | Unknown name, malformed/incomplete JSON, wrong types, extra keys, invalid ranges, excessive arguments and partial argument streams never reach execution. Distinguish correctable validation errors from incomplete/failed provider responses. |
| TOOL-03 | All four filesystem operations: valid absolute paths, parent traversal, encoded/alternate path forms, NUL, prefix collisions, nested restrictions, internal/escaping symlinks and target substitution races. No unauthorized names/content escape through traversal or search. An internal symlink cannot bypass a more-specific restriction. |
| TOOL-04 | Missing/invalid configuration, per-operation grants, more-specific restrictions and changed/revoked access. Captured definitions and source text claiming authority cannot broaden access. Inspection records actual scope/check revisions and absent evaluator evidence. Synthetic credential/runtime/Git fixtures excluded by development configuration never reach provider/public output. |
| TOOL-05 | Read, edit, read again and retry. Fresh calls observe changes; prior requests/results remain unchanged. Cover non-Git folders, dirty/untracked files, rename/deletion between search and read, and mutation during a read. Identity describes returned content; saved inspection works with the source removed. |
| TOOL-06 | Oversized/Unicode results, too many matches, unreadable/unsupported/missing files, invalid handler results, exceptions and deadlines. JSON stays valid/bounded with omissions or safe errors; no credentials, unrelated host paths or stack traces leak. Legitimate target paths remain inspectable. |
| TOOL-07 | Cancel before dispatch, during model/preparation/tool work, with multiple active calls plus queued work, after model completion, and between result commit/continuation. No new dispatch or late revival; completed records remain immutable, active calls receive cancellation and the thread becomes available. |
| TOOL-08 | Concurrent duplicate submissions, repeated worker dispatch, duplicate terminal events/call IDs, conflicting duplicates and an equivalent query with a new ID. One workflow/execution per durable identity; new calls remain subject to repetition bounds; other threads are independent. |
| TOOL-09 | Exhaust every call/concurrency/error/repetition/time/scan/result/continuation bound at and across its edge, including racing completions. Save the specific stop reason or omission and prior progress; no extra provider reservation or tool dispatch. Interactive sessions retain their existing uncapped lifetime. |
| TOOL-10 | Restart at queued, model-dispatch-started, model-output-saved, tool-dispatch-started, result-saved, partially completed parallel batch, continuation-request-saved and final-commit boundaries. Recover interrupted/completed state accurately with zero automatic external calls, no invented result and no lost committed record. |
| TOOL-11 | HTTP-mocked Responses uses `store:false`, strict schemas, enabled parallel proposals and disabled SDK retries. Replay ordered assistant/function/opaque reasoning items and matched outputs across consecutive rounds. Reverse tool completion order does not swap results. Public request projections retain permitted fields. |
| TOOL-12 | SSE fragmentation, duplicate terminal event, final-vs-stream mismatch, incomplete response, dropped stream, missing required continuation, unsupported output type, refusal, provider error, cancellation and allowance exhaustion. No partial execution or hidden retry; metadata and unknown usage remain honest. |
| TOOL-13 | Sentinel opaque reasoning survives backend persistence/continuation but is absent from every API/inspector/copy-context/error/log/evidence view. Corrupt/oversized continuation stops instead of dropping items or exposing them. |
| TOOL-14 | Migrate existing text/image fixtures; inspect/retry historical payloads. Validate Prisma/DBML/deployed schema, immutable row grants, checkpoint transitions, unique dispatch identity, image retention and one-active-Run constraint. No unrelated Topic/instruction schema changes. |
| TOOL-15 | Hidden Electron: acceptance question, public commentary, compact progress, Stop, citations and call/result inspection. Preparing differs from executing; user expansion persists; errors and overlaps remain discoverable. Keyboard open/close restores focus, long content works at 1040×830 and 740×650, reload never dispatches or makes automated windows visible/focusable. |
| TOOL-16 | Actual desktop cancellation and backend restart preserve partial progress and stop reason. Retry is visibly separate and observes edited files. Another worktree's preview/data/processes remain unchanged. |
| TOOL-17 | Independent handlers overlap within the cap and finish in reverse order; exclusive handlers do not overlap; a later dependent call receives earlier results. Concurrent result commits retain both outcomes. Recoverable errors permit bounded correction; terminal failure/cancellation prevents queued admission. Timing does not imply serial execution. |
| TOOL-18 | Register a synthetic retrieval handler with structured data and non-filesystem references. Verify common validation, authorization, progress, cancellation, errors, supported attachment-reference handling and inspection without repository/provider-specific assumptions or actual Topic implementation. |
| TOOL-19 | Malformed configuration and a removed scope directory preserve ordinary chat, including HTTP-mocked OpenAI. Definitions are unavailable; the safe diagnostic reaches the model, immutable request, workflow and hidden desktop. Repair changes new requests only; invalid configuration after capture denies current dispatch. |
| TOOL-20 | Recursive patterns at multiple positions include direct and nested files. Glob and patterned search through an internal symlink root match relative to its canonical root and retain canonical source references. |
| TOOL-21 | A valid multibyte UTF-8 file capped inside a character returns the readable prefix with an explicit byte omission. Malformed interior bytes and incomplete characters at actual EOF still fail. |
| TOOL-22 | Two independent calls fit in the cumulative allowance after unused reservations are released, but cannot be admitted together. Both complete without overspending; Stop while the second waits prevents its execution and releases reservations. |
| TOOL-23 | A deeply nested invalid argument within the string-size bound returns `invalid_call` while a later valid call completes. Capture the original proposal and effective depth limit; valid recursive arguments at the nesting boundary execute, those beyond it do not. |
| TOOL-24 | Repeated source IDs across calls and within a result receive distinct citation IDs without losing source identity. Hidden Electron clicks open the later saved result; long/Unicode/slash/percent IDs remain usable. Ambiguous old-ID links fail closed; reload and backend restart preserve the captured citations. |

Use controlled boundary barriers for cancellation/fault injection, not timing-dependent sleeps. Test a process restart as well as service reconstruction. Compare saved payloads and count handler/provider invocations; PITR remains separate.

## Execution, review and delivery

1. Keep handler contracts additive and preserve recoverable commits.
2. Use Node >=22.12, lockfile-pinned dependencies, `pnpm dev:setup` and isolated development instances. Never reset or stop a sibling preview.
3. Run `pnpm verify --profile quick` during implementation and targeted scenarios while debugging. Update payload/schema documentation and operator configuration instructions as implementation settles; preserve the deferred Codex feasibility check.
4. Explore this worktree's actual disposable preview: ask where a behavior is implemented in explicitly configured Ash source, inspect calls and captured references, edit a fixture between reads, stop concurrent work, restart and compare saved records. Assess clarity separately from automated assertions. Preserve hidden mode for automation.
5. Perform a separate diff review after implementation, emphasizing dispatch races, authority boundaries, opaque-data exposure, historical readers, SQL privileges and Topic integration seams. Fix findings and rerun affected checks.
6. Run full `pnpm verify` with source unchanged and baseline updates disabled. Record outcome/cleanup evidence. Only after an explicit integration request, rebase on current master if needed, rerun verification for the integrated candidate, and integrate linearly by fast-forward or squash without extra integration branches.

Offline deterministic and mocked-provider checks are required regardless of live allowance. A live smoke test is optional and uses an explicitly configured provider session and synthetic/non-sensitive source with a bounded allowance; this plan does not require a new paid session. Report absent live testing without blocking offline completion.

Human acceptance after implementation: ask where response cancellation is implemented, inspect one search and one read, follow the cited lines, then reopen Ash and confirm the saved answer/steps remain. Automated results and agent exploration do not substitute for that UX judgment.
