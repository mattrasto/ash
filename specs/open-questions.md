# Open questions

Recommendations below are proposed unless marked accepted. G01 is resolved: [separate codebase](../docs/decisions/0001-separate-codebase.md). G03 is partially resolved.

## Before the first journey

### G02 — Deployment and interface

Laptop-off work needs an always-on runtime; local-only applications still need a reachable device. Hosting affects privacy and cost.

**Recommend:** an independent backend, local development and a minimal desktop client. Confirm first-release native requirements, personal hosting, remote access and offline behavior.

### G03 — Artifact membership and recovery

**Accepted, 2026-10-09:** [artifact rules](features/artifacts.md#rules) and the [six-table model](../docs/data-model.md), including current-state storage, single-source chains, deferred application audit history and PITR instead of application-event replay.

**Remaining:** choose backup storage/retention, acceptable data loss and restore time, archive monitoring and restore-drill ownership. See [recovery design](../docs/data-model.md#backup-and-recovery). Moves during active runs remain [feature-level questions](features/artifacts.md#remaining-scope).

### G04 — Organization automation

**Accepted, 2026-10-14:** autonomous initial placement under [ART-R12–13](features/artifacts.md#incoming-item-slice), preserving explicit targeting and recording assumptions. No routing clarification or Decision. Topic membership and later reorganization remain manual/suggestion-based. Optional review of ambiguous placements is a follow-on.

### G05 — Context selection

“All Artifacts” may duplicate messages or expose untrusted internal records.

**Accepted first-phase design:** current-thread context and retry selection follow [CONV-R03, R05 and R15](features/threads.md#requirements); ownership, edits and captured requests follow the [instruction rules](features/instructions.md#rules).

**Accepted, 2026-10-12:** instruction applicability, scope priority and the authority boundary follow [INST-R05–06 and R09](features/instructions.md#rules). Topic instructions guide Route; they are excluded from response guidance.

**Accepted, 2026-10-12:** [Topics and working context](features/topics-context.md), including bounded linked-Topic retrieval, immutable captures and membership changes during work.

**Accepted, 2026-10-12:** response-context limits and coverage in the [engineering test plan](../docs/plans/topics-context-tests.md). Incoming Route composition follows [ART-R13](features/artifacts.md#incoming-item-slice).

### G06 — Deletion and retention

Deletion may mean hiding or erasing content from live data, captured requests, search, files and backups.

**Accepted:** Topic soft deletion follows the [DBML](data/model.dbml).

**Remaining:** define erasure, backup expiration and deletion handling after a restore. Set retention before personal-data use; use synthetic fixtures meanwhile. A tombstone alone is not erasure.

### G07 — Interrupted work and retries

Work can outlive a process or device connection. Recovery must avoid duplicated output, actions and cost.

**Accepted first-phase design:** concurrency, outcomes, recovery and cancellation follow [CONV-R07–11](features/threads.md#requirements). Checkpoints and explicit retries follow the [execution contract](../docs/data-model.md#execution-and-transactions).

**Initial OpenAI policy:** explicit retries preserve the original model/options; cancellation aborts the local stream without promising reversal of provider work.

**Implemented:** durable Decision waits, automatic resumption and scheduling alongside newer Thread work follow the [execution design](../docs/features/decisions.md#execution-integration) under [DEC-R05 and R10](features/decisions.md#rules).

**Remaining:** changing models on retry, broader deployment ownership and a contract for general background execution.

### G09 — Privacy, observation and cost

Private access does not specify provider data access, recording retention or spending. Logging “thinking” cannot assume access to private model reasoning.

**Selected provider:** OpenAI, using Responses for text first and its image capabilities later. [Live-mode behavior](features/threads.md#requirements) and [configuration](../docs/features/threads.md#openai-mode).

**Initial live check:** the authorized model and bounded allowance passed the [text smoke test](../docs/features/threads.md#verification).

**Interactive development:** remove the short session call/time cap from normal chat. Keep routine automated verification offline; isolate optional live checks and use cheaper models where the behavior under test permits. [Provider rule](features/threads.md#requirements) · [Test strategy](../docs/plans/persisted-chat-tests.md#openai-adapter).

**Remaining:** broader spending policy and retention/access before personal-data use. Use synthetic fixtures without observation. Provider application storage is disabled, but separate provider retention policies still apply.

Before observation/dreamtime: set capture scope, exclusions, pause controls, storage/spending limits and notification rules. Specify retention of filtered inputs and what source erasure does to recordings and derived memories.

## Before broader capabilities

### G08 — Identity, permissions and Decisions

**Accepted, 2026-10-12:** [permission rules](features/permissions.md#permission-behavior), including configurable defaults, fixed UI-only categories, faithful formalization and discovery of sensitive actions that existing permissions have not addressed. Later accepted rules below supersede earlier matcher and direct-request authorization behavior.

The [starting evaluator and implementation guidance](../docs/features/permissions.md#selected-evaluator) are accepted following the isolated experiments; integration for current tool adapters is implemented.

**Direction, 2026-10-14:** specify [Permissions](features/permissions.md) and [Decisions](features/decisions.md) as separate general features with a shared request/response handoff. Self-modification workflows are deferred consumers.

**Accepted refinements, 2026-10-14:** [Decision rules and panel entry](features/decisions.md#rules); [permission rules](features/permissions.md#permission-behavior) now specify explicit deny exceptions, editable connection scopes, optional wording improvements and mandatory Decision-control confirmation for Ask under PERM-R11.

**Scope decision, 2026-10-14:** private-data handling, evaluator disclosure and retention/erasure policy are deferred to separate security/privacy work under G06/G09. They are outside the current Permissions/Decisions review; sensitive-action discovery remains in Permissions.

**Accepted simplification, 2026-10-14:** [immutable answers](features/decisions.md#rules) replace amendment and approval-withdrawal behavior. The [data model extension](../docs/data-model.md#permissions-and-decisions-extension) uses two simplified tables, with no answer/rule versioning or separate authorization records. Implementation is authorized and routine defaults are adopted; current-tool delivery follows the [implementation/test plan](../docs/plans/permissions-decisions-tests.md).

**Single-rule redesign implemented, 2026-10-14:** one Permission is an explicit verb/resource rule or a complete semantic condition, with a derived name and reviewed semantic override relationships. [PERM-R05–07/R15/R21/R26](features/permissions.md#permission-behavior) own the behavior; the [policy contract](../docs/features/permissions.md#permissions) and [DBML](data/model.dbml) record the model. Decisions and immutable approval behavior remain unchanged.

### G10 — Custom apps and self-modification

Isolated per-app stores/runtimes must coexist with one core backend/database. Sandbox privileges, rollout, rollback and modified-instance upgrades remain undefined.

**Direction accepted, 2026-10-12:** the next path targets usable self-modification, supported by images, tools and Topics/context. The [delivery plan](../docs/plans/self-modification.md) proposes a first code-change demonstration through the detached Codex harness; custom apps are not a prerequisite.

**Remaining:** finalize harness integration/authentication, workspace containment, Decision scope and apply/revert behavior before enabling code changes. Defer concept-tree sharing/upgrades until a concrete compatibility need exists.

## Feature-level details

- Recording feedback: [capture defaults](features/recording-feedback.md#before-screen-recording) and [video understanding defaults](features/recording-feedback.md#before-video-understanding) are implemented; [Live Mode integration](features/recording-feedback.md#live-mode-integration) remains future work.
- Causality: [ART-R07](features/artifacts.md#rules) settles single-source chains initially; revisit merging only for a concrete workflow.
- Moves/references: see [remaining artifact scope](features/artifacts.md#remaining-scope).
- Visibility: manual archive/pin state is accepted under [CONV-R14](features/threads.md#requirements). Automatic archive timing/revival, automation overrides, read markers, pin ordering and notification effects remain open.
- Tasks: assignment does not define scheduling, completion or permission.
- Live Mode: closing/resuming, interruptions, focus changes and device conflicts.
- Scale: expected input volume and response/processing latency targets.
- Engine stages: Listen records, skipped stages and organization-change lifecycle.

Sources: [human spec](HUMAN_SPEC.md). Technical model: [architecture](../docs/architecture.md).
