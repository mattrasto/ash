# Permission evaluation

Starting implementation accepted, 2026-10-12 · Isolated classifier experiments verified · App integration pending

[Behavior and acceptance](../../specs/features/permissions.md) · [Run boundary](../data-model.md#run-boundary) · [Testing](../testing.md)

## Boundaries

Implement permission checking at the backend's action-dispatch boundary. Exact resource checks, semantic evaluation, sensitivity discovery and the final effect resolver are separate responsibilities. Provider adapters return evidence about applicability or sensitive consequences; they cannot grant resource access, mutate rules or execute an action.

The initial conversation schema remains unchanged. General tool execution, Decisions and durable waiting are future integrations. An application-wide boundary must account for filesystem tools, shells, browser control and delegated execution; a check attached to one named tool cannot constrain alternative access paths by itself.

## Selected evaluator

Use the following starting configuration. [Experiment results](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/results/2026-10-12-round2.md) own the measurements and limitations; this selection does not settle the product's [remaining policy decisions](../../specs/features/permissions.md#open-decisions).

| Component | Implementation |
| --- | --- |
| Provider | Jev `jev-1.13.0`, through a replaceable server-side adapter. Keep API credentials on the server. |
| Answers | Three-way `applies`, `does_not_apply`, `insufficient_evidence`; keep these separate from rule effects. Validate response shape, question identity and score distributions. |
| Threshold | Require a unique highest-scoring answer at or above **0.8**, initially for rule matching, sensitivity, authorization and coverage. Explicit uncertainty, ties, invalid/missing answers and lower scores remain unresolved. Scores are not correctness guarantees. |
| Rule evaluation | Evaluate every semantic condition remaining after exact pruning. No learned retrieval, category routing or winning-rule selection. Split oversized requests without dropping questions or material evidence; oversized individual inputs require preparation or a hold. |
| Request arrangement | Batch independent rule questions, direct-user authorization when present, and **one combined sensitivity question** against the same minimized packet. Ask coverage separately only when a sensitive consequence is detected. One action check can therefore require several HTTP requests. |
| Context and wording | Use the original relevant-evidence packet with short contrasting examples. Retain the distinction between inspected public content, unknown contents, restricted content, and owner-only versus shared audiences. The tested versions are `permissions-questions-v2` plus the `examples` variant of `false-positive-round-1`; exact prompts are linked below. |
| Detection scope | Start with credential/private disclosure, irreversible data destruction, consequential commitments and changes to Ash's governing instructions/code/permissions. This is configurable detection scope, independent of UI categories. |
| Failure handling | Start with the tested 15-second request timeout and no automatic retries or model fallback. Errors hold affected work; retain an error code separately from semantic uncertainty. Configure production request/cost limits separately from the experiment's session caps. |

Structured repacking and four separate sensitivity questions increased unnecessary prompts; neither is part of this starting configuration. Threshold calibration changed no final decisions, so retain 0.8 until further evidence supports a change.

## Proposed rule representation

| Field | Meaning |
| --- | --- |
| `id` | Stable rule identity. |
| `instruction` | User-authored wording or a user-accepted Ash proposal, with its source reference. |
| `categoryId` | One UI category, fixed at creation; excluded from evaluation and matcher fingerprints. |
| `gate` | `resource` access or `activity` permission; an enforcement distinction independent of UI category. |
| `effect` | `allow`, `ask` or `deny`. |
| `matcher` | Exact predicates, semantic predicates or an explicit composition. |
| `revision` | Identifies changes to effective wording, scope, conditions or effect. |
| `examples` | Expected matching and non-matching cases, including ambiguous boundaries. |

Start with exact path/operation and field-equality predicates, semantic predicates, and `all` for conjunction. A combined matcher can express “inside this directory AND contacting an external recipient” without inventing a connector-specific permission type. Additional operators and exception semantics depend on PERM-Q02; do not let the classifier infer precedence from prose.

Stored wording is the source for interpreting intent; the visible, saved matcher is the executable interpretation of that revision. Keep them synchronized when the user edits a rule. Reject unsupported predicates rather than silently dropping them. Seed the defaults from PERM-R02 as editable rules, not hardcoded resolver branches. This is a logical shape, not a migration or commitment to a separate history table.

## Rule authoring and formalization

1. Interpret wording using a capable model when needed; separate this infrequent work from action-time evaluation.
2. Resolve known resources, operations, negation and qualifications into a proposed matcher. Canonicalize paths and validate application identifiers in code.
3. Preserve unresolved semantic conditions and exceptions. For example, a path may be exact while “outside my company” requires evidence or interpretation. If this distinction changes the scope, clarify it before saving.
4. Show the resulting behavior inline, including what remains semantic. Saving the rule establishes that interpretation; this does not imply a second generic approval screen.
5. Attach boundary examples and a revision. Model upgrades do not automatically rewrite saved interpretations.

Formalization must be tested for semantic preservation, not just valid JSON. Inheritance, recursive paths, content reads versus listing, and new-file paths need explicit examples. The Asha reference is `packages/server/src/permissions/fs.ts` and `packages/server/src/permissions/approvals.ts` in the adjacent Asha checkout; reuse its scope approach. Any adopted presets become editable Ash defaults; its client-bound five-minute approval lifecycle remains a separate choice.

## Classifier context

These guidelines are accepted; packet field names and size limits remain experimental.

1. **Concrete action:** derive targets, arguments, recipients, payloads and known effects from the execution adapter. An agent-authored intent summary can supplement them but cannot replace them. Preserve unknown effects for commands or UI interactions the adapter cannot reliably describe.
2. **Authority separation:** identify direct user requests, standing grants and rule text separately from external evidence. Preserve source identity and timestamps where relevant. A quoted message or page instruction is data, not user authorization; a trust label alone is not a defense against misclassification.
3. **Authorization context:** include the exact relevant user wording and enough preceding conversation to resolve references, negation and scope. “Send it,” “draft it” and “don't send it yet” must remain distinguishable. Check authorization separately from whether a rule matches.
4. **Narrow questions:** each question contains its own condition, definitions and useful boundary examples. Identify the evidence fields it should examine. Providers may not expose a question's ID to the model, so IDs cannot carry needed meaning. Omit UI categories.
5. **Relevant evidence:** prefer compact structured facts and exact excerpts to a full conversation dump. Retain provenance, omissions and uncertainty. Do not truncate away relevant attachments, recipients or qualifications; missing material evidence requires retrieval or an unresolved result.
6. **Computer use:** provide observed application/site identity, the proposed interaction and current UI meaning. Compare structured UI evidence with screenshots where required. Identify the observation used so changed UI state invalidates a stale action check. Jev needs text/structured input; OpenAI Decisions can also inspect images.
7. **Deterministic facts:** normalize paths, compare dates/amounts and apply precedence in code. Separate facts derived exactly from those inferred by a model. Reused inferred facts carry their evidence and uncertainty into every dependent rule.
8. **Minimization and reproduction:** exclude secrets and unrelated personal data. Retain the exact permitted evaluation payload, rule/question versions, evidence references, model identifier and result for inspection. If redaction removes necessary meaning, treat the result as unresolved. Retention is governed by G06/G09, not by this packet format.

## Proposed sensitivity discovery

Implement [PERM-R14](../../specs/features/permissions.md#rules) as an action-based check independent of the saved-rule candidate list. It must work with zero rules and with a broad grant such as permission to contact friends. Sensitivity and whether the user has addressed it are separate questions; ordinary unfamiliar work is not itself sensitive.

Use cheap local signals and trusted resource metadata where available, supplemented by semantic detection. For each concern, return a described consequence, evidence references and uncertainty. Then establish coverage: an applicable restriction already resolves it, existing informed authorization addresses it, or the concern remains unaddressed/uncertain. Coverage must cite the rule or user instruction that addresses this consequence; a generic capability grant is insufficient. A model's suggestion cannot become authority.

Do not disclose a secret to the classifier while checking whether Ash may disclose it. Before any provider request, use local inspection, source labels and typed placeholders where available, such as `bank_password` and its proposed destination. Preserve whether the action authenticates with the intended service or communicates the credential to a person. If available evidence cannot establish that distinction without exposing the secret, hold the action for local inspection or user clarification. Apply the same minimization to Decisions and stored evidence.

For an unresolved concern, a capable authoring model proposes a rule through the existing formalization path. Preserve the sensitive object and consequence while removing incidental names or channels. In the bank-password case, examples should cover another recipient and another messaging tool, and exclude ordinary authentication with the intended bank; do not generalize to all banking activity or all personal information. The detector may suggest an effect but cannot activate it.

Present the concern and proposed rule in one Decision, merging any permission question already needed for that action. After the user's response, save only their accepted interpretation and rerun evaluation. Existing rules should resolve repeat cases without duplicate proposals. False-alarm dismissal and one-time exceptions remain PERM-Q06; merely dismissing a UI panel must not execute the held action.

Detection scope, prompts and thresholds are versioned, configurable defaults. Evaluate missing-rule recall, false alarms and proposal scope separately from saved-rule matching: a detector is fallible and is not proof that all sensitive effects have been found. The selected combined check does not require an additional discovery request on every action.

## Evaluation pipeline

1. Freeze an action description and relevant observations. Snapshot effective policy, sensitivity configuration and available user authorization; prepare minimized evidence before provider requests.
2. Apply deterministic restrictions. Remove a candidate rule only when exact conditions establish that it cannot apply; missing fields do not prove non-applicability. An already resolved deny can stop execution without further classification.
3. Evaluate semantic conditions using the selected evaluator. An empty candidate list or broad allow cannot skip the configured sensitivity check.
4. Resolve rule effects, resource coverage, authorization and sensitive-consequence coverage in code using an explicit policy configuration. Missing material evidence remains unresolved. The experiment uses most-specific pure path scopes per operation, then deny over ask over allow, with no direct-request override of deny; these are reference assumptions, while product defaults and conflict semantics remain PERM-Q01/Q02.
5. Apply existing authorization to the concrete action, or create a Decision for unresolved permission or sensitivity concerns. Include a proposed rule when a sensitive boundary is missing. Refusal, missing answers, malformed output and timeout remain unresolved, including failures in required sensitivity checks.
6. Before dispatch, revalidate material action/evidence/policy state, including any newly saved rule. A waiting Decision is not a promise to execute stale work. Retry/idempotency and durable resumption depend on PERM-Q03 and the future Run contract.

Return a final effect, per-rule matches, reason codes, authorization/coverage references, any inactive proposal, and an action/evidence/policy fingerprint. Preserve individual provider answers, raw scores and actual model identifiers for inspection; a correct final hold can conceal an incorrect intermediate answer.

A cached evaluation requires unchanged action, evidence, authorization, effective policy, provider/model, questions, thresholds and sensitivity configuration; never reuse a bare category or domain verdict as permission. Material changes invalidate the check before dispatch. Model or prompt changes require reevaluation against saved acceptance cases and fresh final-test families when tuning.

## Implementation references

Reference repository: `/Users/mattrasto/Documents/Programming/ash_experiments`, checkpoint `2f2a459`. Port the relevant components; do not make Ash depend on the experiment checkout, fixture labels or runner.

| Responsibility | Reference |
| --- | --- |
| Validated rule/action/evidence/authorization shapes and provider interface | [schema.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/schema.ts) |
| Canonical path matching, inheritance and conjunction | [exact.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/evaluate/exact.ts) |
| Minimized context, redaction and freshness fingerprints | [context.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/evaluate/context.ts) |
| Base questions, conditional coverage and effect resolution | [pipeline.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/evaluate/pipeline.ts), `evaluate` |
| Selected examples and threshold handling | [round2-variants.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/round2-variants.ts), `VariantProvider(inner, "examples", DEFAULT_THRESHOLDS)` |
| Jev request/response contract, packing, timeout and usage accounting | [http.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/providers/http.ts), `HttpProvider("jev", key, budget, {format: "choice", threshold: 0.8})` |
| Narrow filesystem formalization and inactive rule proposals | [formalize/index.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/formalize/index.ts) |

Proposed Ash placement follows the [repository layout](../repository-structure.md): permission logic under `packages/server/src/modules/permissions/`, transport in server model infrastructure, and only cross-process Decision/rule contracts in shared. Start with one enforceable tool adapter, connect the Decision response to reevaluation, then extend tool coverage. Physical storage and authorization lifetime remain open; this documentation does not add migrations or app code.

The reference's dispatch is simulated; secret labels and action facts are authored fixtures. General secret detection, OS/browser enforcement, durable approval consumption, concern-by-concern coverage citations and model-based rule authoring still require implementation. The formalizer handles one path grammar and a bank-password proposal template, not arbitrary language.

Use [P01–P16](../../specs/features/permissions.md#acceptance-examples) for app acceptance, port the relevant experiment boundary checks, and verify the actual adapter before enabling its effects. The [runbook](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/README.md) owns replay/live commands and evidence reproduction; the [experiment plan](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/PLAN.md) owns broader comparisons.

## Future checks

- Incorrect/stale adapter facts; unlabelled secrets, images and redaction before provider access.
- Partial authorization, multiple consequences, multi-step disclosure and cumulative limits.
- Changed targets, alternate execution routes, approval reuse and duplicate retries.
- Overlapping rules, exceptions and faithful natural-language formalization.
- Hostile evidence, unfamiliar sensitive actions and independently reviewed fresh cases; track intermediate errors as well as final outcomes.
