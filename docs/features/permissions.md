# Permission evaluation

Single-condition policies, reviewed overrides and current-tool integration implemented, 2026-10-14 · [Delivery and verification](../plans/permissions-decisions-tests.md)

[Behavior and acceptance](../../specs/features/permissions.md) · [Decisions integration](decisions.md) · [Run boundary](../data-model.md#run-boundary) · [Testing](../testing.md)

## Current implementation

| Location | Responsibility |
| --- | --- |
| `modules/permissions/service.ts` | Atomic permission/review writes, relationship impact, current-policy resolution and scoped Decision authority. |
| `modules/permissions/authoring.ts` | Natural-language proposals, canonical paths and compatible override-priority review with the capable model. |
| `modules/permissions/matching.ts` | Explicit resource matching, scope winners and per-recipient/filesystem-target evaluation. |
| `modules/permissions/migration.ts`, `approval.ts` | Live policy conversion and unchanged legacy approval binding. |
| `modules/permissions/evaluator.ts` | Jev choice requests, threshold 0.8, combined sensitivity/examples and fail-closed decoding. Synthetic instances inject an offline evaluator; production never substitutes it for Jev. |
| `modules/tools/executor.ts` | Capability guard, canonical filesystem targets, captured evaluations, action/argument binding, holds and safe retry reuse. |
| `modules/filesystem/runtime.ts`, `modules/context/tools.ts` | Existing filesystem and Topic capability ceilings, including canonical paths, exclusions and captured/current Topic scope. |
| `modules/decisions/` | Durable questions and explicit-control responses; [continuation](decisions.md#execution-integration). |
| `contracts/permissions.ts`, `contracts/decisions.ts` in shared | Validated API/persistence shapes. |

Permissions is edited in Settings's Permissions tab, with category tabs, complete conditions and both authoring modes. The seed catalog imports filesystem scopes and read-only Ash code access without overwriting edits or retired IDs. The backend imports newly configured scopes/name restrictions before using a changed configuration. Filesystem capabilities still bound available paths/operations; retained name restrictions are editable explicit permissions. Standalone filesystem runtimes retain their configuration checks unless policy management is explicitly enabled. Topic access stays fixed. New connection/computer/effect adapters still require their own capabilities, concrete action facts and enforcement.

## Boundaries

Implement permission checking at the backend's action-dispatch boundary. Exact resource checks, semantic evaluation, sensitivity discovery and the final effect resolver are separate responsibilities. Provider adapters return evidence about applicability or sensitive consequences; they cannot grant resource access, mutate permissions or execute an action.

The tool slice's [dispatch design](../plans/inspectable-tools-tests.md#filesystem-and-authorization) defines the shared authorization boundary; feature runtimes supply their scoped checks. The evaluator below and the [general Decision handoff](../../specs/features/permissions.md#decision-handoff) are app integrations. An application-wide boundary must account for each route actually enabled; a check attached to one named tool cannot constrain alternative access paths by itself.

Keep permission evaluation usable without a Thread or Decision. A caller supplies a normalized action, relevant evidence, current policy and trusted authorization; the evaluator returns an outcome and explanation. The requesting workflow uses Decisions when input is needed. Decisions records the answer; Permissions interprets its authority during reevaluation; the workflow owns execution.

## Selected evaluator

Use the following starting configuration. [Experiment results](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/results/2026-10-12-round2.md) own the measurements and limitations; this selection does not settle the product's [remaining policy decisions](../../specs/features/permissions.md#open-decisions).

| Component | Implementation |
| --- | --- |
| Provider | Jev `jev-1.13.0`, through a replaceable server-side adapter. Keep API credentials on the server. |
| Answers | Three-way `applies`, `does_not_apply`, `insufficient_evidence`; keep these separate from permission effects. Validate response shape, question identity and score distributions. |
| Threshold | Require a unique highest-scoring answer at or above **0.8**, initially for permission matching, sensitivity, authorization and coverage. Explicit uncertainty, ties, invalid/missing answers and lower scores remain unresolved. Scores are not correctness guarantees. |
| Permission evaluation | Evaluate every relevant semantic condition, including possible reviewed overriders. No learned retrieval, category routing or action-time specificity ranking. Runtime applies saved relationships after matching. Split oversized requests without dropping questions or material evidence; oversized individual inputs require preparation or a hold. |
| Request arrangement | Batch independent permission questions, direct-user authorization when present, and **one combined sensitivity question** against the same minimized packet. Ask coverage separately only when a sensitive consequence is detected. One action check can therefore require several HTTP requests. |
| Context and wording | Use the original relevant-evidence packet with short contrasting examples. Retain the distinction between inspected public content, unknown contents, restricted content, and owner-only versus shared audiences. The tested versions are `permissions-questions-v2` plus the `examples` variant of `false-positive-round-1`; exact prompts are linked below. |
| Detection scope | Start with credential/private disclosure, irreversible data destruction, consequential commitments and changes to Ash's governing instructions/code/permissions. This is configurable detection scope, independent of UI categories. |
| Failure handling | Start with the tested 15-second request timeout and no automatic retries or model fallback. Errors hold affected work; retain an error code separately from semantic uncertainty. Configure production request/cost limits separately from the experiment's session caps. |

Structured repacking and four separate sensitivity questions increased unnecessary prompts; neither is part of this starting configuration. Threshold calibration changed no final decisions, so retain 0.8 until further evidence supports a change.

The experiments predate the revised PERM-R11: their resolver allowed a direct user request to satisfy Ask. Production must instead require a saved, valid approval from the Decision controls. User wording remains context for intent and sensitive consequences; classifier output cannot supply confirmation. Recheck affected acceptance cases when adapting the evaluator; the earlier pass rates do not verify this revised policy.

## Persistence

Keep one `permissions` table and permission-evaluation payloads on existing Artifacts. [Decisions](decisions.md#storage) keeps scoped approval with its reviewed request and immutable resolution. The [DBML](../../specs/data/model.dbml) describes the implemented policy. Physical columns are unchanged; shared contracts and runtime conversion validate the replacement JSON.

### permissions

| Field | Meaning |
| --- | --- |
| `id` | Stable permission identity. |
| `category` | One UI category, fixed at creation; excluded from evaluation. |
| `effect` | `allow`, `ask` or `deny`. |
| `policy` JSONB | Tagged `explicit` verb/resource matcher or `semantic` condition, optional boundary examples and reviewed override references. Contract below. |
| `created_at`, `updated_at`, `deleted_at?` | Current-state timestamps. Removal retires the permission; setting a capability to Never instead saves an active deny. |

Policy contract:

| `kind` | Fields |
| --- | --- |
| `explicit` | `verb`: a supported operation or declared operation family; `resource`: one typed deterministic matcher. A filesystem resource specifies a canonical `path` and `scope: file \| subtree`; optional `pattern` begins `./` for a relative path glob. Existing bare name patterns retain their recursive legacy meaning. Future connection resources bind stable connection/account/resource IDs supplied by their adapter. |
| `semantic` | `condition`: the complete accepted verb + resource/action phrase, including qualifications and identifying details; `examples?`: boundary examples; `overrides?`: distinct UUIDs of the Permissions overridden with reviewed priority under [PERM-R26](../../specs/features/permissions.md#permission-behavior). Omitted lists mean empty lists. |

An explicit example is `{"kind":"explicit","verb":"read","resource":{"type":"filesystem","path":"/projects/ash","scope":"subtree"}}`. A semantic example is `{"kind":"semantic","condition":"Send messages to John Smith (john@example.com)","overrides":["00000000-0000-0000-0000-000000000002"]}`, referring to a reviewed broader Send messages permission. Effect remains in the column, not in either predicate. Explicit permissions derive their display from verb/resource; semantic permissions display their accepted condition. Do not add a separate name, wording copy, original text, resource/activity flag, exception array or revision history.

Resource matchers and verbs are validated adapter contracts. `read` covers `list`, `read`, `glob` and `search`; `read_file` covers file-content reads alone. Other filesystem verbs remain granular. The `permissions/filesystem-resource` endpoint accepts a path or glob, canonicalizes its fixed prefix, and infers file/subtree scope with filesystem metadata. Missing literals are files unless suffixed `/`; no client Scope or Name pattern controls are needed. Split a glob into the canonical fixed `path` and `pattern: ./relative/glob`; `*`/`?` match one component and `**` crosses directories. A trailing `/**` uses the matched folder depth for inheritance, so a deeper literal permission can still override it. Pattern inheritance follows PERM-R07; same-verb computer permissions use application identity before general scope. Never treat a permission for reading as a permission for writing. A qualified filesystem-plus-recipient condition remains one semantic condition, rather than mixed policy sections or two independent permissions. Unsupported explicit resource types cannot be silently downgraded or broadened. Identifying addresses/domains can appear in accepted semantic wording; no entity registry is introduced.

Formalization returns transient `{rules, removals, clarification}`. Each write in `rules` is an addition or an update identified by its saved UUID; `removals` contains `{id, reason, replacementId?}`. No proposal activates here. Reconcile complete scopes across explicit/semantic representations, retain saved IDs/categories, and preserve unchanged baselines. Local canonicalization covers exact predicates and known universal phrases such as “Send messages to any recipient”; other semantic equivalence uses the capable model. Do not lowercase resource identities or discard qualifiers. Collapse repeated proposals and remap references. Return no operations when requested meanings/access/links are already saved. Clearer wording belongs in the proposed condition.

The editor keeps operation selection in memory under [PERM-R06](../../specs/features/permissions.md#permission-behavior). It displays Add/Change/Remove, before/after changes and removal impact. Drop references to unchecked new proposals; unchecked changes/removals leave saved rows active. Display selected target effects in override tables, falling back to saved values when an update is unchecked. Validate the selected final set rather than assuming the entire proposal was accepted. Save checks affected rows against displayed `updatedAt` values and requires another Save after refreshing concurrent changes. Requests allow 40 seconds for each bounded 30-second model operation. Direct filesystem Save resolves the Resource before review/commit.

Settings shares the editor's busy state: close, Escape, tab navigation and draft-discard controls stay unavailable until permission preparation or saving finishes. A failed operation restores navigation while preserving the draft and any pending Save/Discard choice.

Review uses `permissions/formalize`, `permissions/review` and `permissions/commit`. Review accepts writes, `removeIds`, and optional `replacements: [{id, replacementId}]` for selected consolidations. Require a selected removal and a retained equivalent replacement. Transfer incoming overrides and merge outgoing overrides into the survivor, dropping only consolidation-created self references; validate compatibility and cycles on the final set. Ordinary retirement removes incoming references. Include generated relationship writes and affected rows in the review. Scope checks independently reject equal-scope duplicates/overrides; unresolved equivalence cannot grant consolidation authority. Known explicit comparisons run locally; capable review compares semantic scopes separately from override priority.

A process-signed token binds final writes/removals to the reviewed current state; commit these atomically under the policy lock. Stale/edited drafts or process restarts require fresh review. Matcher/effect edits review incoming and outgoing links. The plain save route accepts only an unchanged matcher with an unlinked effect change. No persistent change-set, relationship, review-status or version records are introduced; historical evaluations and Decision approvals retain their existing contracts.

At evaluation, a definitely matching semantic permission suppresses only its named overridden permissions for the covered target/consequence, including uncertainty in an overridden group membership. Keep the original verdict and record the applied override; do not turn unknown membership into an asserted match. Uncertainty in the overrider or independent permissions still holds affected work; transport/evaluation failures stay blocking. Apply saved links from matching permissions; chains use their recorded links, never an inferred shortcut to an unlisted permission. Capture the matching permission and each suppression so the outcome can be explained. Independent restrictions and unresolved conditions remain governed by PERM-R21/R12. Recheck current permissions and relationships before dispatch; a derived policy fingerprint can detect changes without persistent permission versions.

Global secret defaults include filename globs and a semantic secret-value Never permission. Unchanged, unlinked prior code-folder exclusions retire on upgrade; edited/linked permissions and exclusions retained in explicit filesystem configuration stay intact. The offline evaluator treats synthetic fixture contents as non-secret, while preserving uncertainty for edited semantic conditions; this is never a production fallback.

The seed catalog remains [`modules/permissions/defaults.ts`](../../packages/server/src/modules/permissions/defaults.ts). Adapt it to the new policy contract under the migration below, preserving edited and retired permissions. Connection setup follows PERM-R20. Computer adapters must describe `kind: computer`; no computer-control adapter is included yet.

The connection picker edits the same permission's effect. When a connector is implemented, its connection record will own provider-granted capabilities, a credential reference and the mapping from capabilities/resources to Permission IDs. Reconnecting must preserve edited or retired permissions without duplicating or resetting them; no `provisioning_key` is needed on Permissions. Policies reference the connection without storing tokens. An Ash deny does not revoke provider credentials, and an Ash allow cannot add provider capability. Connection storage and provider authorization are outside this general feature's migration.

### Migration

Startup converts live legacy rows atomically; seed/import writes use the same policy lock as review commits. Historical captures are not rewritten.

- Preserve stable IDs for one-to-one conversions, effects, edits, retirement and category. Split exact operation sets without expanding partial grants. Combined qualifications remain one semantic condition. Deterministic derived IDs make conversion idempotent; migration creates no semantic override authority.
- Exact scopes become verb/resource matchers. Preserve independent legacy restrictions as semantic conditions when automatic path specificity would relax them. Conditional resource grants retain their qualified permission plus visible scope/complementary restrictions, so a non-match cannot become default allowance. Retired filesystem grants with no remaining ancestor boundary gain a visible Never permission; the retired source ID stays retired. No conversion exposes a previously unavailable directory.
- `.ash-tools.json` still bounds available paths/operations. Its retained name exclusions become explicit Never permissions; managed runtimes use those permissions instead of a second hidden name veto. Additions are imported before authorization when configuration changes, preserving edits/retirements. Fixed Topic and provider/OS limits stay separate. Optional traversal targets denied by policy are omitted with an omission record; direct targets and Ask/uncertain matches use the normal Decision boundary.
- Compatibility decoders keep historical evaluations and immutable Decision requests readable. Before reusing a legacy approval, reconstruct its original action binding and compare migrated effective predicates with current policy. A representation-only conversion can preserve approval; changed action/arguments/definition or effective policy cannot gain old authority. Waiting work always reevaluates current checks.
- Shared contracts, authoring, resolution and the seed catalog use the new shape. No physical SQL/Prisma change is needed for this JSON conversion; future structural changes follow the [schema workflow](../architecture.md#schema-workflow).

### Approval data on Decisions

| Location | Permission-specific content |
| --- | --- |
| `decisions.request` | Immutable permission request: concrete action, caller/step/action identity, targets/payload/consequences, scope, evaluation reference and any specifically requested deny exceptions. Store the reviewable content. |
| `decisions.resolution` | Immutable approval or decline using the [answer shape](decisions.md#decisions), including optional comment, submission identity, trusted source and time. The Decision ID identifies the reviewed request; only Decision controls can supply Ask confirmation. |
| Run checkpoint/action state | Which Decision was consumed, which action was claimed and its known dispatch/result state. See [Run dependencies](decisions.md#run-state-dependencies). An unknown execution outcome cannot become a fresh unconsumed action after restart. |

The Decision is the canonical record of this approval. Permissions reads its approved scope and current status, then reevaluates the concrete action under current permissions. There is no copied grant record or required one-Decision-to-one-permission relationship: several permissions can apply, and captured evaluation findings explain them.

Standing access belongs in permissions. Approval lifetime, immutability and retries follow [PERM-R23–25](../../specs/features/permissions.md#permission-behavior). Work cancellation belongs to the execution owner under [DEC-R13](../../specs/features/decisions.md#rules), with no approval-revocation state or separate synchronization path. The Run contract binds the prepared action, parsed arguments, adapter definition and applicable restrictions; capability access and material facts are checked again before execution. Dependencies retain consumption per step and previous-attempt evidence for retries. Non-Run execution consumers must define their own durable consumption before enabling effects.

For retry reuse under PERM-R25, distinguish the approved action's stable identity from each execution attempt. Retain adapter evidence establishing the previous outcome, link the retry to that attempt and approval, and capture the current evaluation. Preserve earlier consumption and attempt records rather than resetting them to unused. A linked retry Run alone is insufficient proof of the same action or absence of effects; the runtime must validate both. The existing evaluator timeout policy does not determine action retry scheduling.

### Evaluation Artifacts

Extend Act payloads with a versioned `permission_evaluation`: concrete action and fingerprint, permitted evidence, effective policy fingerprint and permission snapshots, explicit scope winners and applied semantic override links, Decision/response and other authority-source references, evaluator configuration/model, results and reason codes. Use the triggering action or Input as the single source; optional Run association follows the existing Artifact permissions. Any material reevaluation creates a new capture rather than editing prior evidence.

Use these captures for inspection and Decision request context. They record findings, not authority; dispatch must still check freshness and current authorization. Retain earlier evaluated wording/matchers even after permission edits/removal. No separate evaluation table or general application-edit audit log is needed initially. Payload validation, immutability and retention must follow the existing capture machinery.

## Permission authoring and formalization

1. Accept natural language or direct verb/resource selection under [PERM-R06](../../specs/features/permissions.md#permission-behavior). Use a capable model for interpretation and relationship proposals, separately from action-time matching.
2. Propose explicit/semantic additions, changes and removals using the transient contract in [Persistence](#persistence). Canonicalize paths and validate resource IDs in code. For exceptions, prefer broad scopes plus narrower override proposals under PERM-R06; do not partition them into complementary exclusion clauses. Keep conjunctions within each complete condition. An identified recipient can have reviewed priority over a membership group without asserting membership; do not generate redundant intersection permissions.
3. Compare proposed semantic scopes with current permissions and propose compatible specificity or explicitly scoped exception relationships under PERM-R26. Show linked targets, their effects, unaffected overlapping restrictions and useful example outcomes. A name such as John must be clarified when the identity materially changes scope; include identifying evidence in the accepted wording when available.
4. Review the selected operations and relationships; put clearer wording directly in proposed conditions. Save the accepted batch atomically against the reviewed current policy. A stale or edited review cannot activate a partial batch.
5. Store useful boundary examples with semantic conditions. Model upgrades do not rewrite saved permissions or relationship authority.

Formalization must be tested for semantic preservation, not just valid JSON. Inheritance, recursive paths, content reads versus listing, and new-file paths need explicit examples. The Asha reference is `packages/server/src/permissions/fs.ts` and `packages/server/src/permissions/approvals.ts` in the adjacent Asha checkout; reuse its scope approach. Any adopted presets become editable Ash defaults; its client-bound five-minute approval lifecycle is not adopted under PERM-R23.

## Classifier context

These guidelines are accepted; packet field names and size limits remain experimental.

1. **Concrete action:** derive targets, arguments, recipients, payloads and known effects from the execution adapter. An agent-authored intent summary can supplement them but cannot replace them. Preserve unknown effects for commands or UI interactions the adapter cannot reliably describe.
2. **Authority separation:** identify direct user requests, standing grants and permission text separately from external evidence. Preserve source identity and timestamps where relevant. A quoted message or page instruction is data, not user authorization; a trust label alone is not a defense against misclassification.
3. **Authorization context:** include the exact relevant user wording and enough preceding Thread content to resolve references, negation and scope. “Send it,” “draft it” and “don't send it yet” must remain distinguishable. Supply saved Decision approval as a separate trusted record. User wording establishes intent; it cannot satisfy Ask. Check approval identity, response origin and scope in the runtime rather than letting the classifier invent confirmation.
4. **Narrow questions:** each question contains its own condition, definitions and useful boundary examples. Identify the evidence fields it should examine. Providers may not expose a question's ID to the model, so IDs cannot carry needed meaning. Omit UI categories.
5. **Relevant evidence:** prefer compact structured facts and exact excerpts to a full thread dump. Retain provenance, omissions and uncertainty. Do not truncate away relevant attachments, recipients or qualifications; missing material evidence requires retrieval or an unresolved result.
6. **Computer use:** provide observed application/site identity, the proposed interaction and current UI meaning. Compare structured UI evidence with screenshots where required. Identify the observation used so changed UI state invalidates a stale action check. Jev needs text/structured input; OpenAI Decisions can also inspect images.
7. **Deterministic facts:** normalize paths, compare dates/amounts and apply precedence in code. Separate facts derived exactly from those inferred by a model. Reused inferred facts carry their evidence and uncertainty into every dependent permission.
8. **Minimization and reproduction:** exclude secrets and unrelated personal data. Retain the exact permitted evaluation payload, permission snapshots, evaluator question versions, evidence references, model identifier and result for inspection. If redaction removes necessary meaning, treat the result as unresolved. Retention is governed by G06/G09, not by this packet format.

## Sensitivity discovery

Implement [PERM-R14](../../specs/features/permissions.md#permission-behavior) as an action-based check independent of the saved-permission candidate list. It must work with zero permissions and with a broad grant such as permission to contact friends. Sensitivity and whether the user has addressed it are separate questions; ordinary unfamiliar work is not itself sensitive.

Use cheap local signals and trusted resource metadata where available, supplemented by semantic detection. For each concern, return a described consequence, evidence references and uncertainty. Then establish coverage: an applicable restriction already resolves it, existing informed authorization addresses it, or the concern remains unaddressed/uncertain. Coverage must cite the permission or user instruction that addresses this consequence; a generic capability grant is insufficient. A model's suggestion cannot become authority.

Do not disclose a secret to the classifier while checking whether Ash may disclose it. Before any provider request, use local inspection, source labels and typed placeholders where available, such as `bank_password` and its proposed destination. Preserve whether the action authenticates with the intended service or communicates the credential to a person. If available evidence cannot establish that distinction without exposing the secret, hold the action for local inspection or user clarification. Apply the same minimization to Decisions and stored evidence.

For an unresolved concern, a capable authoring model proposes a permission through the existing formalization path. Preserve the sensitive object and consequence while removing incidental names or channels. In the bank-password case, examples should cover another recipient and another messaging tool, and exclude ordinary authentication with the intended bank; do not generalize to all banking activity or all personal information. The detector may suggest an effect but cannot activate it.

Present the concern and proposed permission in one Decision, merging any permission question already needed for that action. After the user's response, save only their accepted interpretation and rerun evaluation. Existing permissions should resolve repeat cases without duplicate proposals. One-time responses and concern dismissal follow the adopted defaults in [PERM-Q06](../../specs/features/permissions.md#open-decisions).

Detection scope, prompts and thresholds are versioned, configurable defaults. Evaluate missing-permission recall, false alarms and proposal scope separately from saved-permission matching: a detector is fallible and is not proof that all sensitive effects have been found. The selected combined check does not require an additional discovery request on every action.

## Evaluation pipeline

1. Freeze an action description and relevant observations. Snapshot effective policy, sensitivity configuration and available user authorization; prepare minimized evidence before provider requests.
2. Match explicit permissions and select canonical filesystem scope winners per verb/covered operation. Remove a candidate only when exact facts establish non-applicability; missing fields do not prove it. Include semantic permissions whose reviewed links could affect a matching restriction.
3. Evaluate relevant semantic conditions using the selected evaluator, preserving each covered target/consequence. An empty candidate list or broad Allow cannot skip sensitivity discovery. Do not stop at an explicit deny before potential reviewed overrides are resolved.
4. Apply definitely matching reviewed links, then scoped one-time exceptions. Resolve remaining effects and default allowance in code under [PERM-R21–22/R26](../../specs/features/permissions.md#permission-behavior), with capability, authorization and sensitive-consequence checks. Missing material evidence remains unresolved. In a multi-recipient action, an override for John cannot suppress a restriction for another recipient.
5. For Ask, require a valid explicit Decision approval for this action; a direct request is insufficient. Reuse the same outstanding Decision when no answer has arrived. Apply accepted exceptions within their scope, and request unresolved permission or sensitivity input as needed. Include a proposed permission when a sensitive boundary is missing. Refusal, missing answers, malformed output and timeout remain unresolved, including failures in required sensitivity checks.
6. Before dispatch, revalidate material action/evidence/policy state, including any newly saved permission. A waiting Decision is not a promise to execute stale work. Approval reuse follows PERM-R25; durable attempt tracking and resumption follow the [Run design](decisions.md#execution-integration).

Return a final effect, per-permission matches, reason codes, authorization/coverage references, any inactive proposal, and an action/evidence/policy fingerprint. Preserve individual provider answers, raw scores and actual model identifiers for inspection; a correct final hold can conceal an incorrect intermediate answer.

A cached evaluation requires unchanged action, evidence, authorization, effective policy, provider/model, questions, thresholds and sensitivity configuration; never reuse a bare category or domain verdict as permission. Material changes invalidate the check before dispatch. Model or prompt changes require reevaluation against saved acceptance cases and fresh final-test families when tuning.

## Implementation references

Reference repository: `/Users/mattrasto/Documents/Programming/ash_experiments`, checkpoint `2f2a459`. Port the relevant components; do not make Ash depend on the experiment checkout, fixture labels or runner.

| Responsibility | Reference |
| --- | --- |
| Validated permission/action/evidence/authorization shapes and provider interface | [schema.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/schema.ts) |
| Canonical path matching, inheritance and conjunction | [exact.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/evaluate/exact.ts) |
| Minimized context, redaction and freshness fingerprints | [context.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/evaluate/context.ts) |
| Base questions, conditional coverage and effect resolution | [pipeline.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/evaluate/pipeline.ts), `evaluate` |
| Selected examples and threshold handling | [round2-variants.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/round2-variants.ts), `VariantProvider(inner, "examples", DEFAULT_THRESHOLDS)` |
| Jev request/response contract, packing, timeout and usage accounting | [http.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/providers/http.ts), `HttpProvider("jev", key, budget, {format: "choice", threshold: 0.8})` |
| Narrow filesystem formalization and inactive permission proposals | [formalize/index.ts](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/src/formalize/index.ts) |

Ash placement follows the [repository layout](../repository-structure.md): permission logic under `packages/server/src/modules/permissions/`, transport in server model infrastructure, and only cross-process permission/evaluation contracts in shared. [Decisions](decisions.md) owns its separate service and contracts. Connect evaluation findings and Decision responses through the requesting workflow before extending effects. The migration is `202610140001_permissions_decisions`; Run checkpoints own consumption and attempt state.

The experiment reference's dispatch is simulated; secret labels and action facts are authored fixtures. General secret detection, OS/browser enforcement and richer concern-by-concern coverage require future adapters. Current authoring uses an exact path grammar and the capable model for qualified language and reviewed relationships. Offline synthetic authoring supports only a bounded send/recipient narrowing grammar; arbitrary semantic conditions stay unresolved in the offline action evaluator. Controlled integration checks establish enforcement and persistence, not live classifier correctness; verification targets are in the [delivery plan](../plans/permissions-decisions-tests.md#permission-model).

Use the [permission examples](../../specs/features/permissions.md#acceptance-examples) for acceptance; [registered integration and desktop scenarios](../plans/permissions-decisions-tests.md#boundary-integration) cover current enforcement. Verify any new adapter before enabling its effects. The [runbook](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/README.md) owns replay/live commands and evidence reproduction; the [experiment plan](/Users/mattrasto/Documents/Programming/ash_experiments/permissions/PLAN.md) owns broader comparisons.

## Configuration

Live semantic checks use `JEV_API_KEY` from the checkout's owner-only `.env.local`, alongside the existing OpenAI configuration. Missing credentials or transport/schema failures hold required checks and report setup/retry guidance. Synthetic previews use the explicitly labelled offline evaluator; it establishes ordinary read sensitivity but leaves arbitrary semantic conditions unresolved. Live evaluator quality remains grounded in the linked experiments, rather than mocked integration results.

## Future checks

- Incorrect/stale adapter facts; unlabelled secrets, images and redaction before provider access.
- Partial authorization, multiple consequences, multi-step disclosure and cumulative limits.
- Changed targets, alternate execution routes, approval reuse and duplicate retries.
- Overlapping permissions, exceptions and faithful natural-language formalization.
- Hostile evidence, unfamiliar sensitive actions and independently reviewed fresh cases; track intermediate errors as well as final outcomes.
