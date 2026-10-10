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

Suggestion-only defaults conflict with automatic topic assignment and backfilling new topics.

**Recommend:** preserve explicit thread selection; use manual topic membership initially. Require acceptance for inferred changes until the user enables scoped automation. Membership also affects context access.

### G05 — Context selection

“All Artifacts” may duplicate messages or expose untrusted internal records. System/topic/thread instruction precedence is unspecified.

**Accepted first-phase design:** current-thread context and retry selection follow [CONV-R03, R05 and R15](features/conversations.md#requirements); ownership, edits and captured requests follow the [instruction rules](features/instructions.md#rules).

**Remaining:** concrete context limits and selection/precedence across global, Topic and Thread scopes. External text cannot override permissions.

### G06 — Deletion and retention

Deletion may mean hiding or erasing content from live data, captured requests, search, files and backups.

**Accepted:** Topic soft deletion follows the [DBML](data/model.dbml).

**Remaining:** define erasure, backup expiration and deletion handling after a restore. Set retention before personal-data use; use synthetic fixtures meanwhile. A tombstone alone is not erasure.

### G07 — Interrupted work and retries

Durable continuation lacks rules for cancellation, disconnection, crashes, duplicate delivery and concurrent inputs. Mistakes can duplicate output, actions and cost.

**Accepted first-phase design:** concurrency, outcomes, recovery and cancellation follow [CONV-R07–11](features/conversations.md#requirements). Checkpoints and explicit retries follow the [execution contract](../docs/data-model.md#execution-and-transactions).

**Remaining:** retry model selection, provider-specific cancellation and deployment ownership. General continuation and waits need a separate execution design.

### G09 — Privacy, observation and cost

Private access does not specify provider data access, recording retention or spending. Logging “thinking” cannot assume access to private model reasoning.

**Recommend initially:** choose one provider/model and call budget; use synthetic fixtures without observation. Captured model requests are part of the accepted model; set their retention and access policy before using personal data. Record input/output, execution metadata and available summaries.

Before observation/dreamtime: set capture scope, exclusions, pause controls, storage/spending limits and notification rules. Specify retention of filtered inputs and what source erasure does to recordings and derived memories.

## Before broader capabilities

### G08 — Identity, permissions and Decisions

The prohibition on sending/publishing as the user has unspecified exceptions. Approval scope, expiry and changed-action behavior are undefined; Decisions also cover ordinary questions.

**Recommend:** prohibit impersonation/publishing until exceptions are explicit. Enforce permissions outside editable prompts. Bind approvals to action, target and scope. Specify revocation, denial, timeout and waiting-run continuation before enabling tools.

### G10 — Custom apps and self-modification

Isolated per-app stores/runtimes must coexist with one core backend/database. Sandbox privileges, rollout, rollback and modified-instance upgrades remain undefined.

**Recommend:** keep the core simple; define isolation with the first app. Progress from reviewable instruction edits to isolated apps, then tested code changes with rollback. Defer concept-tree sharing/upgrades until a concrete compatibility need exists.

## Feature-level details

- Causality: [ART-R07](features/artifacts.md#rules) settles single-source chains initially; revisit merging only for a concrete workflow.
- Moves/references: see [remaining artifact scope](features/artifacts.md#remaining-scope).
- Visibility: manual archive/pin state is accepted under [CONV-R14](features/conversations.md#requirements). Automatic archive timing/revival, automation overrides, read markers, pin ordering and notification effects remain open.
- Tasks: assignment does not define scheduling, completion or permission.
- Live Mode: closing/resuming, interruptions, focus changes and device conflicts.
- Scale: expected input volume and response/processing latency targets.
- Engine stages: Listen records, skipped stages and organization-change lifecycle.

Sources: [human spec](HUMAN_SPEC.md). Technical model: [architecture](../docs/architecture.md).
