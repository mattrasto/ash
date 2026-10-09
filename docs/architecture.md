# Architecture

Draft. File layout: [repository structure](repository-structure.md).

## Stack and runtime

Recommend TypeScript, Svelte, Node/Fastify, PostgreSQL and Drizzle. Electron depends on the first desktop requirements (G02).

Use one backend and one core database. The client handles presentation and native integration; the backend owns rules, context, model calls, execution and persistence. Keep credentials out of renderer contracts.

Run the backend independently of desktop windows. Laptop-off operation needs an always-on host; local-only applications still need a reachable device. Hosting remains open in [G02](../specs/open-questions.md).

Asha's manifests and schema confirm this stack is already in use nearby. Its conversations/interactions/log-events model does not establish Ash's topic membership or replay contract. Ash has a [separate codebase](decisions/0001-separate-codebase.md); evaluate components individually for reuse.

## Processing and persistence

- Treat Listen/Input/Filter/Route/Act/Surface as logical stages within the backend.
- Route explicit text input directly; record skipped stages without unnecessary model calls.
- Record organization and instruction edits as inputs and state changes.
- Append history and update immediate projections in one transaction when they must remain consistent.
- Give submissions stable identities to prevent duplicates on transport retry. Replay by recorded sequence, not timestamps alone.
- Persist run state and start with database-backed execution. Broader scheduling follows durable waits and background-work requirements.
- Version event payloads and instruction revisions. Test old-event replay separately from database migrations.

## First model

Ownership and erasure depend on G03/G06. All entities belong to the user's Ash instance; deployment will determine authentication and device identity.

| Entity | Relationships and lifecycle |
| --- | --- |
| Topic | Many threads through membership. Removing a topic unlinks threads rather than deleting them. |
| Thread | Zero or more topics; owns current visible entries. Archive and erasure are separate operations. |
| Thread–topic membership | Unique active pair; reconstruct changes from history. |
| Artifact record | Input/action/surface/change with causal links, stage and payload version. Internal records may lack a thread. Retention follows G06. |
| Current thread entry | One Surface Artifact in one current thread, with presentation order. Rebuild from recorded changes; a separate table is undecided. |
| Run / attempt | Initiating input, target thread, outputs and settled outcome. Preserve retries distinctly; replay must not restart work or revive stale leases. |
| Instruction revision | Runs identify the revision used. Retain historical revisions subject to G06. |

## Schema workflow

Start with `specs/data/model.dbml`: table boxes, all columns, foreign-key connections and brief ownership/deletion notes. Once implemented, migrations define database structure:

1. Review and commit SQL migrations.
2. Apply them to a clean development database.
3. Generate DBML with `db2dbml` and normalize its output.
4. Check for drift and inspect the diagram in dbdiagram. Document constraints it cannot represent.

References: [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [DBML CLI](https://dbml.dbdiagram.io/cli/), [DBML syntax](https://dbml.dbdiagram.io/docs/).

## Bootstrap and verification

Pin dependencies; provide startup, synthetic seed data, guarded reset and automated checks. Exercise [conversation acceptance examples](../specs/features/conversations.md) with a deterministic model, then a live-model smoke test after G09 is settled. Test interruption, duplicate delivery and replay without model/tool calls; inspect the full journey in the running app.
