# Architecture

Persisted chat, deterministic/OpenAI adapters and desktop bootstrap implemented; [bounded live text verification passed](features/threads.md#verification). File layout: [repository structure](repository-structure.md).

## Stack and runtime

The bootstrap uses TypeScript, Svelte, Electron, Node/Fastify and PostgreSQL. Prisma implements the product schema; execution details are in the [chat implementation](features/threads.md).

Use one backend and one core database. The client handles presentation and native integration; the backend owns rules, context, model calls, execution and persistence. Keep credentials out of renderer contracts.

Run the backend independently of desktop windows. Laptop-off operation needs an always-on host; local-only applications still need a reachable device. Hosting remains open in [G02](../specs/open-questions.md).

Asha's data model does not establish Ash's topic membership or recovery contract. Ash has a [separate codebase](decisions/0001-separate-codebase.md); evaluate components individually for reuse.

## Processing and persistence

- Treat Listen/Input/Filter/Route/Act/Surface as logical stages within the backend.
- Explicitly targeted user text bypasses Filter/Route; its Input retains the selected Thread. Incoming source items follow [ART-R11–16](../specs/features/artifacts.md#incoming-item-slice). Intake checkpoints are separate from Act Runs; action work reuses the existing executor.
- Store current state directly; application audit history is deferred. Manual edits do not require engine Artifacts.
- Capture model inputs before dispatch and retain Artifact source links for inspection.
- Give commands stable identities to prevent duplicates on transport retry. A deliberate execution retry creates a linked Run.
- Start with one backend owning database-backed execution; record interruptions instead of automatically repeating work. Broader scheduling and worker takeover require separate design.
- Use the accepted [recovery contract](../specs/features/artifacts.md#rules) and verify restores separately from database migrations.

## First model

The [data model](data-model.md) defines ownership, causal links, context capture, Run checkpoints and recovery for the thread core. The [DBML](../specs/data/model.dbml) contains tables, columns and foreign keys. Physical details and remaining product decisions are marked in the model.

## Schema workflow

`specs/data/model.dbml` is the design diagram before implementation. Column notes must state purpose, population/null conditions and any allowed mutations. Keep JSON payload contracts in the [data model](data-model.md#artifact-payloads).

Keep its schema, committed migrations and the UML/DBML diagram synchronized in the same change. The Prisma schema describes intended application structure; migrations establish the database, including constraints that require additional SQL. Do not update one representation and leave the others stale.

1. Update and validate the Prisma schema using the pinned version's tooling; generate and review the migration, including SQL-only constraints.
2. Apply migrations to a clean, isolated development database.
3. Generate DBML from that database with `db2dbml` and normalize its output. Preserve field usage notes; document constraints the diagram cannot represent.
4. Compare tables, columns, nullability, keys and relationships with the Prisma schema and migration, then inspect the diagram in dbdiagram. The chat integration suite checks schema drift.

Pinned versions and migration commands: [schema operations](features/threads.md#schema-operations). References: [Prisma migrations](https://www.prisma.io/docs/orm/migrations/applying-a-migration), [DBML CLI](https://dbml.dbdiagram.io/cli/), [DBML syntax](https://dbml.dbdiagram.io/docs/).

## Bootstrap and verification

The [development workflow](development.md) implements workspace isolation, a synthetic desktop preview, startup/reset commands and lifecycle checks. Thread coverage and deferred features are recorded in the [chat test plan](plans/persisted-chat-tests.md).
