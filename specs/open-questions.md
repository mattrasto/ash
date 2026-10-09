# Open questions

Recommendations below are proposed. G01 is resolved: [separate codebase](../docs/decisions/0001-separate-codebase.md).

## Before the first journey

### G02 — Deployment and interface

Laptop-off work needs an always-on runtime; local-only applications still need a reachable device. Hosting affects privacy and cost.

**Recommend:** an independent backend, local development and a minimal desktop client. Confirm first-release native requirements, personal hosting, remote access and offline behavior.

### G03 — Artifact membership and replay

Mandatory thread ownership conflicts with pre-routing and dropped artifacts. Moving entries must preserve immutable history. Replayable “core state” is undefined.

**Recommend:** internal artifacts may lack a thread; Surface Artifacts have one current owner. Record membership changes and rebuild current views. Initially replay topics, threads, membership, surfaced content, run outcomes and instruction revisions. Resolve before foreign-key design.

### G04 — Organization automation

Suggestion-only defaults conflict with automatic topic assignment and backfilling new topics.

**Recommend:** preserve explicit thread selection; use manual topic membership initially. Require acceptance for inferred changes until the user enables scoped automation. Membership also affects context access.

### G05 — Context selection

“All Artifacts” may duplicate messages or expose untrusted internal records. System/topic/thread instruction precedence is unspecified.

**Recommend:** versioned base instructions plus the current thread's visible conversation; inspect included and omitted content. Confirm deferral of cross-thread topic context. External text cannot override permissions.

### G06 — Deletion and retention

Deletion may mean hiding or erasing content from history, search, files and backups. Append-only replay conflicts with permanent erasure.

**Recommend:** removing topics unlinks threads. Distinguish archive from erasure and limit replay guarantees accordingly. Set retention before personal-data use; use synthetic fixtures meanwhile. A tombstone alone is not erasure.

### G07 — Interrupted work and retries

Durable continuation lacks rules for cancellation, disconnection, crashes, duplicate delivery and concurrent inputs. Mistakes can duplicate output, actions and cost.

**Recommend initially:** one response run per thread; independent runs across threads; client reconnect without restarting work; visible server interruption and explicit retry with a distinct attempt. General continuation and waits follow later.

### G09 — Privacy, observation and cost

Private access does not specify provider data access, recording retention or spending. Logging “thinking” cannot assume access to private model reasoning.

**Recommend initially:** choose one provider/model and call budget; use synthetic fixtures without observation. Record input/output, execution metadata and available summaries. Decide whether full context snapshots are retained before using personal data.

Before observation/dreamtime: set capture scope, exclusions, pause controls, storage/spending limits and notification rules. Specify retention of filtered inputs and what source erasure does to recordings and derived memories.

## Before broader capabilities

### G08 — Identity, permissions and Decisions

The prohibition on sending/publishing as the user has unspecified exceptions. Approval scope, expiry and changed-action behavior are undefined; Decisions also cover ordinary questions.

**Recommend:** prohibit impersonation/publishing until exceptions are explicit. Enforce permissions outside editable prompts. Bind approvals to action, target and scope. Specify revocation, denial, timeout and waiting-run continuation before enabling tools.

### G10 — Custom apps and self-modification

Isolated per-app stores/runtimes must coexist with one core backend/database. Sandbox privileges, rollout, rollback and modified-instance upgrades remain undefined.

**Recommend:** keep the core simple; define isolation with the first app. Progress from reviewable instruction edits to isolated apps, then tested code changes with rollback. Defer concept-tree sharing/upgrades until a concrete compatibility need exists.

## Feature-level details

- Causality: combining inputs may require multiple parents, not just branching chains.
- Moves/references: define ordering and behavior when a target moves or is erased.
- Visibility: indefinite archive time, pin/override precedence, hidden work's context and notification effects.
- Tasks: assignment does not define scheduling, completion or permission.
- Live Mode: closing/resuming, interruptions, focus changes and device conflicts.
- Scale: expected input volume and response/processing latency targets.
- Engine stages: Listen records, skipped stages and organization-change lifecycle.

Sources: [human spec](HUMAN_SPEC.md). Technical model: [architecture](../docs/architecture.md).
