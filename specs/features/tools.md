# Tool execution and inspection

Behavior accepted, 2026-10-12 · Implemented · [Verification](../../docs/features/tools.md#verification)

[Conversations](conversations.md) · [Artifact rules](artifacts.md) · [Permissions](permissions.md) · [Asha reference review](../../docs/features/tool-use-reference.md)

## Goal

Ash can use available tools to complete a request while the user follows progress, stops work and inspects what actually happened. Tools share an execution and inspection model across features; a source-code investigation is one use case.

## Scope and flow

One Run can make several model calls, execute tools, return their results to the model and produce an answer. Filesystem tools and Topic retrieval are separate feature registrations on the shared execution system. Existing text/image conversations remain available.

1. The user requests work. Ash receives descriptions of the tools and resources available for that request.
2. Ash calls tools as needed and uses their results to decide what comes next. Progress shows proposed, active and finished work.
3. The user can stop the Run or expand a step to inspect its arguments, result and outcome.
4. Ash provides an answer or explains why work stopped. The saved conversation and execution evidence remain available after reopening.

This slice excludes filesystem writes, shell execution, delegation and its feasibility investigation, general MCP/plugins, permission management, Decisions and self-modification.

## Rules

- **TOOL-R01 — Workflow and concurrency:** one active Run per thread does not mean one active tool call. Independent calls may run concurrently within a bounded allowance; dependent calls wait for their inputs, and calls that cannot safely overlap are serialized. A call keeps its identity and result regardless of completion order. The [conversation draft and concurrency rules](conversations.md#requirements) still apply.
- **TOOL-R02 — Available capabilities:** Ash knows each available tool's purpose, arguments, limits and accessible resources. Tool availability and permission are distinct: a tool appearing in a request does not authorize every use. Capture the definitions, scope information and availability problems actually supplied; later configuration changes cannot rewrite that record. An unavailable optional capability leaves ordinary chat and healthy capabilities usable; its limitation remains visible in progress and inspection.
- **TOOL-R03 — Tool-specific behavior:** each tool defines its operation, accepted inputs, possible results, effects and whether calls can safely overlap or be repeated. The execution system does not assume every tool reads a repository, returns text or uses a frozen source. The initial capabilities are listed below.
- **TOOL-R04 — Authorization boundary:** check the concrete action and targets before execution through a common authorization boundary. Permissions owns access policy and protected-resource defaults under [PERM-R01, R07, R09–13](permissions.md#rules). This spec adds no permanent list of forbidden paths. Configured scopes still apply to canonical targets, including every target reached through search or symlinks. Tool results cannot grant authority.
- **TOOL-R05 — Results and evidence:** preserve the result actually returned, including structured data, supported attachment references, errors and omissions. Identify the source and observation time/version where meaningful. Source citations lead to captured supporting excerpts and distinguish successive observations of the same resource. Ash distinguishes observed results from inference and does not claim a current action succeeded based only on an old result or its own narration.
- **TOOL-R06 — Progress and answer:** show a concise label, relevant target and status for each call, with public commentary alongside progress. Preparing a call must not look like executing it. Keep progress visible while working and collapse completed work to a summary; errors stay discoverable and user expansion choices are respected. Stop remains available throughout. Preserve keyboard access, focus and reading position.
- **TOOL-R07 — Inspection:** expose each model request, supplied tool definitions, complete call arguments, validation/access outcomes, results, timing, provider identity when relevant and the final Run outcome. Show which results informed each continuation and which calls overlapped. Inspection is a normal product capability. Exclude credentials and private reasoning; provider continuation material remains opaque and outside public inspection. Public commentary is labeled commentary, not private reasoning.
- **TOOL-R08 — Durable history:** save requests, calls, results and progress boundaries as work happens. Captured records remain immutable when source data, instructions or configuration change. Preserve [single-source Artifact lineage](artifacts.md#rules), historical text/image readability and existing [follow-up context selection](conversations.md#requirements).
- **TOOL-R09 — Failures and limits:** invalid/incomplete calls do not execute. Return actionable, structured errors; a denial is not a success with an error hidden in its body. Recoverable errors may lead to corrected calls within the Run. Bound work, concurrency, time, repeated failures and result size. Report truncation and skipped content explicitly; if work cannot continue, retain progress and explain the stop reason.
- **TOOL-R10 — Stop and interruption:** Stop prevents further dispatch and requests cancellation of all active calls. Keep completed results; distinguish calls never started from cancelled or interrupted calls and unknown outcomes. Late events cannot revive a stopped Run. Reconnect reads saved state; backend restart never automatically repeats work. Cancellation cannot promise reversal of an effect already started.
- **TOOL-R11 — Retry and duplicate delivery:** deliberate Retry creates a linked Run from the captured request, with access checked again. Its new observations do not replace earlier results. Whether an operation can be repeated depends on its effects and known outcome; Retry does not authorize blind replay of future writes. Duplicate delivery of a submission or execution step does not repeat that work.

## Initial filesystem tools

Read-only to start, accepted 2026-10-12. These tools work in explicitly configured filesystem scopes, including directories that are not Git repositories.

| Capability | Behavior |
| --- | --- |
| List | Show entries in a directory. |
| Read | Read a bounded file excerpt with line numbers. |
| Find files | Match file/path patterns within a scope. |
| Search contents | Find matching text with file and line references, optionally narrowing the files searched. |

When given a short filename, Ash first tries to locate it within the available scopes; it asks the user to choose if relevant matches remain ambiguous. Unsupported formats, unreadable files, result limits and skipped content are visible rather than reported as a complete search with no matches.

- **TOOL-R12 — Filesystem freshness:** accepted 2026-10-12. Calls read current filesystem contents and preserve the exact results observed, with file/content identity and line ranges. Files may change between calls; a Run does not promise one consistent filesystem snapshot. Retry may observe changed files while earlier results remain intact. A Git revision is additional evidence only when it accurately describes the observed content. This supersedes the original fixed repository-snapshot requirement.

Start with configured access under PERM-R01, without per-read prompts for covered work. Setup states that returned content can be retained and sent to the configured model. The full evaluator, sensitive-action discovery and permission UI remain deferred; inspection does not claim they ran. Credential/runtime exclusions required for the isolated development environment belong to its configuration, not universal policy embedded in every tool. A missing or unresolved grant prevents execution.

## Accepted decisions

- **TOOL-Q01 — Permission staging:** accepted under TOOL-R04 and the initial filesystem scope above, replacing the earlier blanket exclusion proposal.
- **TOOL-Q02 — Source freshness:** resolved by TOOL-R12 above.
- **TOOL-Q03 — Initial parallelism:** bounded parallel execution under TOOL-R01 is included in this slice, superseding the original serialized-only scope.

## Acceptance examples

| ID | Example | Expected result |
| --- | --- | --- |
| TOOL-A01 | Ask where a behavior is implemented. | Ash finds and reads relevant files across multiple calls, cites matching captured evidence and exposes each step. |
| TOOL-A02 | Use a non-Git folder, then request a path outside its scope. | Ordinary filesystem tools work within the grant; the outside action is denied with an actionable reason. No grant means no access. |
| TOOL-A03 | Retrieved text directs Ash to another tool or protected location. | It grants no authority; the same authorization boundary applies. |
| TOOL-A04 | Read a file, change it, then read again and inspect both calls. | The second call observes the changed file; each call retains its own captured result and identity. |
| TOOL-A05 | A call is invalid, denied, fails or exceeds a limit. | Its status and result agree. No invalid action executes; corrections are bounded and omissions are explicit. |
| TOOL-A06 | Stop with two reads active and a further call queued. | Cancellation reaches both active reads; the queued call never starts. Saved results and individual outcomes remain inspectable. |
| TOOL-A07 | Restart during tool work, change a file, then choose Retry. | Old work is interrupted without automatic dispatch. Retry may observe the changed file under TOOL-R12; the earlier evidence remains intact. |
| TOOL-A08 | Reconnect or deliver an execution event twice. | There is no duplicate workflow, call execution or result. |
| TOOL-A09 | Reopen a completed Run. | Requests, calls, results and answer remain inspectable without invoking models/tools to display them. |
| TOOL-A10 | Two independent calls finish in reverse order; a third needs one result. | Allowed calls overlap, results retain their identities, and the dependent call waits. Inspection does not invent a serial order. |
| TOOL-A11 | Another feature registers a retrieval tool with structured results. | It uses the same progress, cancellation, error and inspection behavior without repository-specific assumptions. |

The [engineering/test plan](../../docs/plans/inspectable-tools-tests.md) is approved. [Implementation and configuration](../../docs/features/tools.md).
