# Asha tool-use reference

Source inspected, 2026-10-12 · Ash behavior accepted in the [tool spec](../../specs/features/tools.md)

Reference checkout: `/Users/mattrasto/Documents/Programming/asha`, HEAD `0b0593c759bd5b7bdce52eba7158bf2a8fc4e5ea`. Read the implementation rather than treating its older filesystem ADR as current behavior. No Asha files were changed or runtime started.

## Adopt or adapt

| Concept | Evidence in Asha | Ash application |
| --- | --- | --- |
| Tool descriptions and request-specific availability | [`toolsForRequest`, `dispatchTool`](/Users/mattrasto/Documents/Programming/asha/packages/server/src/conversation/tools.ts) separate definitions, selection and dispatch. | Capture the tools actually offered for each model request. Keep feature-specific handlers behind the common executor; no skill/MCP loader is required for this slice. |
| Distinct filesystem operations | [`fsToolDefinitions`, `fsRead`, `fsList`, `fsGlob`, `fsGrep`](/Users/mattrasto/Documents/Programming/asha/packages/server/src/fs/tools.ts) separate listing, reading, path patterns and content search. | Use general filesystem capabilities, line references and bounded results, rather than repository-only tools. |
| Find short paths before asking | `buildFilesystemSection` in the same file instructs lookup within configured scopes and clarification for ambiguous matches. | Adopt the behavior with concise tool guidance; do not copy repetitive prompt admonitions. |
| Structured denials | `gate` and `FsDenyError` return reason/suggestion information and produce an error step. | Keep typed denial/error outcomes consistent for the model, saved result and UI. Do not pass arbitrary exception strings through to users/providers. |
| Scope-aware authorization | [`canonicalizePath`, `checkFsPermission`](/Users/mattrasto/Documents/Programming/asha/packages/server/src/permissions/fs.ts) distinguish operations and choose the most-specific scope. | Reuse the concepts already selected by PERM-R07. Apply the effective check to every reached target; copying the walker is insufficient to establish all child-scope restrictions. |
| Stable call identity and multimodal results | [`ToolContext`, `ToolResultContent`](/Users/mattrasto/Documents/Programming/asha/packages/server/src/conversation/tools.ts), [`ToolCallStep`](/Users/mattrasto/Documents/Programming/asha/packages/shared/src/types.ts). | Carry trusted execution identity and cancellation separately from model arguments. Keep results extensible beyond strings without importing a provider's SDK into shared contracts. |
| Compact timeline and step details | [`Timeline.svelte`](/Users/mattrasto/Documents/Programming/asha/packages/client/src/renderer/src/components/Timeline.svelte), [`ToolTrace.svelte`](/Users/mattrasto/Documents/Programming/asha/packages/client/src/renderer/src/components/ToolTrace.svelte), [`Message.svelte`](/Users/mattrasto/Documents/Programming/asha/packages/client/src/renderer/src/components/Message.svelte). | Show live progress, preserve user expansion choices, then compact it. Include target, outcome and timing; expose full inspection as a normal capability rather than a developer-only setting. |
| Trace survives reload | [`tool_steps_persisted.eval.ts`](/Users/mattrasto/Documents/Programming/asha/packages/server/evals/turns/tool_steps_persisted.eval.ts) checks streamed versus saved step identity/status. | Retain that acceptance check and extend it to mid-Run restart, cancellation and duplicate delivery. |

## Differences and limits

- **Scheduling:** [`runConversationTurn`](/Users/mattrasto/Documents/Programming/asha/packages/server/src/conversation/turn.ts) executes `toolUses` with sequential `await dispatchTool` (around line 1610). Ash's accepted TOOL-R01 permits bounded concurrent independent calls, so its scheduler needs a different design.
- **Freshness:** filesystem handlers read the live filesystem, with no per-Run source snapshot. Ash accepted this direction under [TOOL-R12](../../specs/features/tools.md#initial-filesystem-tools), adding immutable captured results for inspection.
- **Policy:** Asha's `inHardDenylist` blocks `.ssh`, `.aws`, `.gnupg`, `.asha`, `.env*` and paths outside the home directory. Ash's PERM-R07 explicitly does not adopt these defaults. The accepted [TOOL-Q01 staging](../../specs/features/tools.md#accepted-decisions) keeps policy separate from handlers.
- **Durability:** `recordStep` updates an in-memory map and emits progress; the main turn saves steps with the final assistant interaction. Unresolved running steps are filtered out at settlement. Ash must persist intermediate boundaries and preserve interrupted/unknown outcomes instead of dropping them.
- **Cancellation:** the turn checks an AbortSignal between model iterations, but its shown `ToolContext` has no signal and the tool batch has no per-call abort check. Ash needs cancellation through the dispatcher and every active handler, especially with parallel calls.
- **Narration and reasoning:** Asha labels preceding public text as a step's `thinking`; its turn/types also contain provider thinking blocks. Ash retains public commentary with accurate labels and never exposes private/opaque continuation. No new reasoning viewer is proposed.
- **Result bounds:** Asha's read has a byte cap; its content search builds a JavaScript regex, reads matching candidates into memory and caps match count. Those mechanisms alone do not establish bounded bytes, safe regex work, complete omission reporting or search cancellation. Implement and verify those properties in Ash.
- **Waiting and authority changes:** [`approvals.ts`](/Users/mattrasto/Documents/Programming/asha/packages/server/src/permissions/approvals.ts) keeps pending confirmations in memory, binds them to a client and times out after five minutes. Its standing-permission promotion and waiting UX belong to future Permissions/Decisions work, not this slice.

These are source-review findings, not a runtime verification of Asha or approval of its security boundaries. The review contributes no write tools, subagents, plugins or additional providers to Ash's scope.
