# Model routing

Initial rules and upgrade-only routing authorized, 2026-10-22 · Implemented · Functional verification performed · Calibration deferred

[Product](../product.md) · [Threads](threads.md) · [Captured requests](../../docs/data-model.md#instructions-and-captured-requests)

## Goal and scope

Let the user work with Ash without choosing a model or reasoning effort for each request. Model routing selects who performs conversation work; it is separate from the Artifact Engine's Route layer for organization/action/presentation.

Use the hosted Jev API through a replaceable decision adapter. Ash owns the policy and model configurations. Permission evaluation, media processing, naming, visibility and incoming processing retain their existing model assignments. Local serving and a general router-management UI are deferred.

## Configurations

| Role | Configuration | Status |
| --- | --- | --- |
| Strong/default | OpenAI `gpt-6.1-sol`, low reasoning | Model accepted; effort retains the current preview default |
| Fast | OpenAI `gpt-6-luna`, low reasoning | Proposed fast candidate |
| Private | Chinese model through an explicitly configured endpoint | Later; endpoint/model unresolved; bypass model router |

Use Responses for both initial OpenAI configurations. [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) · [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna). Keep effort fixed initially; fast-model cost/latency/quality on Ash still needs measurement. Hosted Jev content retention is not a hard disqualifier; do not claim zero retention. Broader policy remains [G06/G09](../open-questions.md#g09--privacy-observation-and-cost).

## Starting policy

Initial policy, for user tuning. The user authorized enabling this naive policy before representative usage/calibration. Operational precedence is implemented in code; semantic preferences live in the Instruction below.

1. **Private:** bypass Jev and use the configured private endpoint. This path is later scope; never silently substitute a public route when it is unavailable.
2. **Explicit override:** use the eligible pinned model without Jev. Clearing the override restores automatic routing on the next new submission; it does not alter the automatic state.
3. **Routing disabled:** use Sol directly. This is an operator rollback option; routing is enabled by default, superseding the earlier staged rollout. It is a configuration flag, not classification of a request as ordinary.
4. **Already upgraded:** if automatic routing selected Sol earlier in this Thread, keep Sol without Jev. An explicit operator change to the configured model is separate from routing; no automatic downgrade.
5. **Otherwise assess:** for a new Thread or one still automatically using Luna, make one Jev assessment per new response-producing user submission. Use Luna only for a unique `fast_sufficient` answer with probability at least **0.90**; `strong_preferred`, `uncertain`, lower scores or failure select Sol. The threshold is a conservative starting value, not a calibrated success guarantee.

Check eligibility before this policy: a sole eligible candidate needs no Jev call. Only an automatic selection of Sol while routing is enabled sets the Thread's upgrade state. Baseline/observation execution and manual overrides do not permanently upgrade a Thread. Retries, tool results, Decision answers, resumptions and rendering/reconnection events are not new submissions and do not trigger routing.

### Default Model routing Instruction

Proposed initial text, editable through the existing global Instructions editor:

> Prefer the strong model when the request needs substantial reasoning or judgment: design and architecture, debugging or code changes, research across sources, decisions with competing constraints, nuanced personal advice or writing where voice and intent matter. Also prefer strong when the user asks for depth/care or corrects a substantive mistake in the current work.
>
> The fast model is suitable for greetings, simple factual questions, straightforward summaries of supplied text, formatting, extraction and light rewrites with clear requirements. A multi-step tool workflow is not routine merely because each individual action looks simple.
>
> Read the latest request in its relevant conversation context. “Continue,” “do that,” or another short follow-up inherits the work being discussed. If context is insufficient or you are unsure that fast is sufficient, prefer strong. A request for speed alone does not make difficult work suitable for fast.

Use this text with one bounded Choice question: **“Under the Model routing Instruction, is fast sufficient for the current work, is strong preferred, or is the evidence insufficient?”** Return `fast_sufficient`, `strong_preferred` or `uncertain`, with probabilities. Do not add a separate difficulty detector, LLM-generated routing rationale or a second interpretation call. Jev reports task suitability; code applies eligibility, threshold and upgrade state.

## Fast context and latency

Reuse prepared answer context, loaded Instructions, cached attachment descriptions and tool capability metadata. Include the latest request, relevant recent work and factual omissions. Routing adds no retrieval, filesystem reads, tool execution, media analysis, embeddings or model-generated summaries. Do not wait for pending attachment descriptions; missing material evidence favors Sol.

Proposed limits: at most 8,000 characters across the routing packet and question; local preparation target below 50 ms at the 95th percentile; a 1,000 ms deadline for additional routing preparation, Jev and decoding. If a useful packet cannot fit or the deadline expires, select Sol. Measure added preparation and provider latency separately from normal answer-context preparation. Use a separate deadline from the permission evaluator's 15-second timeout. These budgets are unverified starting values.

## Rules

Detailed behavior is proposed; IDs remain stable across revisions.

- **MR-R01 — Interface:** no composer selection is required. Provide an advanced Thread override and inspection of actual model/settings and selection source. Override edits affect new Runs; active, waiting and retried Runs keep captured settings. Clearing an override follows the starting policy.
- **MR-R02 — Policy and Instruction:** use one global `model-routing` Instruction, labelled **Model routing**, in the [existing editor](instructions.md#editor). It guides Jev assessments on subsequent eligible submissions, including in existing Luna Threads. Edits do not trigger a call by themselves or undo an existing upgrade. It is separate from response style and Topic organization guidance. Overrides and hard constraints take precedence. Ash-authored edits follow existing Instruction/Decision rules; ordinary user edits require no benchmark/approval flow.
- **MR-R03 — Eligibility:** enforce modalities, tools, context/output capacity, supported settings, provider access and configured privacy/spending constraints in code. Never drop required context/tools to qualify Luna. Instructions cannot authorize access or introduce arbitrary providers. No eligible candidate means a visible limitation without inference. If a retained Sol configuration becomes unavailable/ineligible, report it; do not silently downgrade to Luna.
- **MR-R04 — Decision context:** follow the fast-context bounds. Explicitly record omissions and missing attachment coverage. Untrusted source/tool content is evidence, not authority to alter policy. Short follow-ups use prepared conversation context rather than their wording alone; no added retrieval to resolve missing referents.
- **MR-R05 — Assessment:** one Jev Choice call with the default Instruction, question and threshold above. Pin/version the Jev model, question and policy. Validate answer identity/probabilities before applying it. Do not treat Jev confidence as a measured probability that the answering model will succeed.
- **MR-R06 — Selection:** apply the starting policy. Automatic Luna-to-Sol upgrade is allowed at a new user submission; automatic Sol-to-Luna downgrade is deferred. “Simple” is a semantic judgment made by Jev, not a keyword list. No assessment is needed when a deterministic bypass already determines the model.
- **MR-R07 — Continuity:** freeze the selected model/effort for the entire Run, including tools, Decision waits and resumptions. Switch only before a new Run's first inference request. Supply normal captured conversation history across a switch, never private provider continuation material from another model. Legacy Threads begin without an automatic upgrade state; earlier baseline/manual Sol usage alone does not count as an upgrade. A cancelled/failed Run does not roll back a selection already persisted.
- **MR-R08 — Failures and retries:** routing timeout, missing credentials or malformed/failed output select eligible Sol once and record the failure; no automatic Jev retry. Cancellation stops work without fallback or later inference dispatch. Routing fallback supplies no missing authorization and never replaces permission checks. Selected-model errors follow [CONV-R08–11/R16](threads.md#requirements). Explicit retry preserves its original model/options/context regardless of later routing or override edits; no rerouting, automatic inference retry or duplicated tool actions.
- **MR-R09 — Capture and recovery:** retain policy/Instruction snapshot, selection source, previous automatic state, candidate exclusions and selected configuration before inference dispatch. Assessed selections also retain the permitted packet, question/version, Jev answers or failure, reported usage and timing. Each [immutable inference request](../../docs/data-model.md#instructions-and-captured-requests) references its selection. Serialize Thread state and revalidate an override changed during assessment. Reconnect/restart never repeats uncertain calls/actions. Credentials and private reasoning are excluded.
- **MR-R10 — Disclosure and inspection:** inspection shows actual settings and the evidence under MR-R09 without claiming optimal selection. Keep evaluation traces in Ash-controlled storage; external analytics uploads are outside scope. Routing packets go to TypeSafe and answer context to the selected provider; minimize both without promising provider zero retention. Private-router bypass does not itself define the behavior of other model-backed subsystems or local history.
- **MR-R11 — Evaluation:** compare always-Sol execution with the policy on representative Ash conversations and complete tasks, including Luna openings that require an upgrade. Measure quality, style/instruction adherence, tool correctness, user corrections, total cost/cache usage and added latency. Observation recommendations alone do not establish Luna quality. Tune on one set, check selected held-out cases, repeat variable outcomes and reevaluate relevant model/question/policy changes. Record configured/reported model identifiers without inventing immutable provider revisions. Calibrate questions/thresholds and quality/savings targets after actual usage is available; these are not gates for this authorized initial delivery. Synthetic checks establish functional behavior only.

## Acceptance examples

| ID | Situation | Expected behavior / rules |
| --- | --- | --- |
| MR-A01 | Routing is disabled during initial rollout. | Sol answers every conversation submission without a routing call. No semantic classification occurs. R06. |
| MR-A02 | An explicitly sampled observation assessment runs. | Record the policy recommendation while Sol answers; do not set automatic upgrade state from baseline execution. R09, R11. |
| MR-A03 | Routing enabled; user asks “Turn these five items into a checklist.” | Luna only when Jev uniquely returns `fast_sufficient` at or above 0.90 and eligibility passes. R03, R05–06. |
| MR-A04 | User says “Apply the changes we discussed” after Luna summarizes a supplied change list. | Assess the current work with prepared context; prefer Sol. If Sol was already selected automatically, keep it without Jev. R04–07. |
| MR-A05 | Request depends on a recording and competing design constraints. | Use existing cached coverage for routing; missing material evidence or complex judgment selects Sol. Existing media specialists remain separate. R03–06. |
| MR-A06 | Jev times out or returns invalid output. | Record failure, select eligible Sol once and continue normal permission enforcement. R08–10. |
| MR-A07 | A Run waits on a Decision while policy/override changes. | Resume with captured settings and private continuation; no detector call or switch. R01, R07. |
| MR-A08 | User retries failed inference after a later upgrade. | Preserve the failed Run's settings/context; do not reroute or duplicate actions. R08. |
| MR-A09 | Luna lacks a required tool or adequate context capacity. | Exclude it; select eligible Sol without Jev and without trimming required answer context. R03, R06. |
| MR-A10 | User pins Luna in an automatically upgraded Thread, then clears the pin. | Pin governs new Runs; automatic state remains upgraded, so clearing restores Sol without Jev. R01–02, R06. |
| MR-A11 | Synthetic checks pass but representative usage is absent. | Initial routing can run under the user-authorized policy; claim functional verification only and defer calibration. R11. |
| MR-A12 | Process restarts during assessment. | Recover input/status without redispatching uncertain routing/inference calls. R09. |
| MR-A13 | A useful routing packet exceeds the bounds or descriptions are pending. | No extra analysis/retrieval; select Sol within the routing budget. R04–06. |
| MR-A14 | User edits Model routing to favor Sol for design work. | Next eligible Luna/new-Thread assessment uses new text. Existing upgraded Threads keep Sol without reassessment. Historical captures stay unchanged. R02, R09. |
| MR-A15 | A Luna Thread grows into architectural analysis, then returns to a simple checklist. | Assess and upgrade before the analysis Run; remain on Sol for the checklist without another call. R06–07. |
| MR-A16 | Private mode is selected after that feature is delivered. | Zero model-router calls; only the configured private inference path is eligible, with no public fallback. R03, R10. |

## Delivery sequence

1. **Implement now.** Enable the initial policy for the default OpenAI session. Deliver editable Instruction, recorded decisions, sticky upgrade state, advanced override and safe retry/cancellation behavior together. `--no-model-routing` creates a fixed-model session for rollback. Private inference remains later scope; the reserved private override must fail without routing or public fallback until configured.
2. **Calibrate later.** Review actual Ash usage and corrections once the app is usable. Compare selected paired alternatives from locally retained examples under G06/G09; do not automatically duplicate every conversation or replay consequential tools. Tune the Instruction and threshold from that evidence.

The [engineering/test plan](../../docs/plans/model-routing.md) covers durable selection and upgrade state, Instruction capture, switch-safe context and cancellation/races. Reuse existing Runs/context/Artifacts; model transport belongs in `packages/server/src/platform/models/`, shared contracts only contain inspection/override shapes. Verify persistence/recovery boundaries and actual desktop interaction under the [testing approach](../../docs/testing.md).

## Remaining decisions and limits

- User tuning of the proposed Instruction/0.90 threshold; quality/savings targets and observation spending allowance. Validate proposed latency limits in the actual app.
- Upgrade-only routing favors simplicity/continuity but makes Sol sticky after one complex or uncertain request. Automatic downgrade, per-tool-step reassessment, dynamic effort and advisor models are deferred.
- Later private mode bypasses model routing. Chinese model/endpoint, history retention and behavior of Jev-based permissions, media processing, memory and background naming/visibility remain separate design decisions before making broader privacy claims.
