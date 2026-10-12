# Development workflow

Workflow accepted, 2026-10-09 · Persisted chat with opt-in OpenAI mode

Give each feature a Git worktree, a persistent preview and disposable verification environments. Repository commands own the runtime; Codex supplies worktrees and launch actions. Ash can later invoke the same commands for [self-modification](../specs/HUMAN_SPEC.md#modifying-ashs-code).

The Electron/Svelte shell opens [persisted deterministic chat](features/conversations.md). **Storage test screen** retains the database note/counter, file note and persisted client preference used by the workflow suite. It is a separate screen in the current app, not an older build; its `dev_meta` and `dev_scratch` tables remain development scaffolding. **Developer info** in the chat sidebar identifies the instance, persistence profile and model session. PITR operation, signed packaging, personal-data imports and production rollout remain deferred.

## Run the preview

Prerequisites: macOS desktop session, Node 22.1 or later, pnpm 9 and running Docker Desktop. Versions are pinned in the lockfile and PostgreSQL image digest. `pnpm verify` opens temporary, windowed Electron apps; a graphical session is required. Linux/Windows and native macOS Spaces/focus behavior have not been verified.

```sh
pnpm dev:setup
pnpm dev
```

Use Codex's checked-in `.codex/environments/environment.toml` for automatic worktree setup and the [preview and test actions](#commands). In the current Codex layout, hide the sidebar to reveal Actions. The same commands work from a terminal. Setup uses `node scripts/dev/setup.mjs` so installation works before dependencies exist. No personal `.env` is required.

The launcher requires process inspection, loopback sockets and Docker access. A coding-agent sandbox may need permission to run it; denial of process inspection fails closed. Logs live in the instance's `logs/` directory, and `pnpm dev:status --json` reports safe endpoints and errors. After changing launcher code or dependencies, stop and start again; app source changes reload automatically. Startup reuses the verified healthy database container unless its identity or Compose configuration changes. After restarting Docker, Run Preview restores the development service and reconnects the preview without reseeding, including when Docker assigns a different database port.

## Everyday flow

1. Start a Codex chat in a new worktree for a feature. Automatic setup installs pinned dependencies, registers the workspace and prepares its preview data.
2. Choose **Run Preview**. Open that feature's chat preview with hot reload. Other feature previews keep running.
3. Iterate in the same preview; restarts preserve its database, file and client preference. Reset explicitly when a clean fixture is useful. Product fixtures will replace the scratchpad as features land.
4. Run automated checks and let the coding agent exercise a separate verification instance. Testing does not interrupt or rewrite the preview being inspected.
5. Review the diff and verification evidence, then demonstrate the feature in its preview. Follow the [delivery agreement](../specs/product.md#confirmed-engineering-agreement) for review and integration.
6. Preserve source changes in a Git checkpoint or saved patch, including relevant untracked files. Dispose of development resources before archiving the checkout; retain verification evidence.

## Workspace and instance identity

A **workspace** is one registered checkout. An **instance** is one isolated set of application data and runtime resources within it.

| Instance | Lifetime | Data |
| --- | --- | --- |
| Preview | One per workspace; survives stop/start | Editable sample data, retained until reset or disposal |
| Verification | New ID for each verification session | Fresh selected fixture; never the preview's database or files |
| Test worker | New ID per test invocation and parallel worker needing state | Minimal fixtures; removed after the worker finishes |

`dev:setup` creates a random workspace ID, persisted in ignored `.ash-dev/workspace.json`, and registers its canonical checkout path. Branch names and chat titles are display labels; renaming them cannot change resource ownership. The primary checkout follows the same isolation rules. Setup requires no Conductor or Codex environment variable and refuses a copied identity registered to another checkout.

Host storage is `~/.ash-dev/`. Set `ASH_DEV_ROOT` before registering a checkout to use another dedicated root; an existing checkout refuses a different root.

```text
<checkout>/.ash-dev/workspace.json        # Workspace ID; never copied to new worktrees
<dev-root>/registry/                     # Checkout and owned-resource records
<dev-root>/workspaces/<workspace-id>/
  preview/                              # Manifest, credentials, files, client state, logs
  verify/<verification-id>/              # Independent data and build output
<dev-root>/evidence/<verification-id>/    # Reports retained after instance disposal
```

The workflow test creates two real detached worktrees and its own temporary development root/container. It copies the current source, installs from the lockfile using the local pnpm store, and removes those resources afterward. Stateful worker profiles currently use the `verify/` layout; more granular worker allocation is deferred until needed.

State outside the checkout survives Codex worktree removal and does not trigger source watchers. Registry updates and lifecycle operations take locks scoped to their resources. Dispose before archiving; an orphan-list/reclamation command is not implemented. Checkout absence never authorizes deletion. Handoff uses the destination checkout's preview; future data transfer requires explicit export/import.

## Data isolation

Use one PostgreSQL container dedicated to Ash development, with a separate database and credentials for every instance. Each instance runs one backend and one core database. The container must not host the user's daily Ash or reuse Asha's container or volume. Sharing development infrastructure keeps parallel previews inexpensive while allowing independent migrations and resets.

| Resource | Isolation rule |
| --- | --- |
| Database | Database name derives from opaque IDs, not user-entered labels. Each instance has distinct migration and runtime roles. Runtime roles cannot connect to another instance or administer the cluster. |
| Files | Attachments, settings, instruction caches, exports, generated apps and their stores, MCP working files and temporary output resolve beneath that instance's root. No development fallback to the user's normal application directory. |
| Client | Separate Electron `userData`, browser storage, session state and caches. Set paths before Electron initializes. Any future keychain entries use an instance namespace. |
| Jobs | Each instance's workers use only its database, files and configured services. No shared queue or cache namespace; add instance scoping when either is introduced. |
| Builds | Verification output is separate from preview output. Dependency changes and installs cannot race with verification in the same checkout. |
| Credentials | Synthetic mode receives no provider or personal connector credentials. Explicit live mode receives only its selected development provider credential in the backend. Generated database/admin credentials never reach the renderer, reports or child tools. |

Provisioning revokes default `PUBLIC` access to instance databases and grants access only to their designated roles; PostgreSQL grants database `CONNECT` to `PUBLIC` by default. The provisioner alone receives development-cluster administration access. The runtime reads metadata and updates its scratchpad and permitted product columns; it cannot change schema. Runtime writes preserve the [Artifact and run constraints](data-model.md#constraints-beyond-dbml) and [edit/undo constraints](data-model.md#application-edits-and-undo). [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html)

All application-owned writes use a centrally provided instance storage interface. Child tools receive an explicit working directory, temporary directory and allowlisted environment; tools that require unrestricted home-directory access stay disabled in synthetic mode. Connectors, observation, system notifications and global shortcuts start disabled. Test doubles capture intended external actions for assertions.

This provides application data isolation for trusted local development. Processes under the same OS account can still access files their account permits; directories and database roles do not contain arbitrary hostile code. Before autonomous self-modification gets personal data or tools, G10 must define an OS sandbox or container boundary, filesystem mounts, credential delivery and outbound access. Separate database containers alone would not solve host-file access.

### Fixtures and personal data

Versioned `empty` and `scratchpad` fixtures both seed the base response instructions; they start with no conversations. Seeding a new instance is automatic; starting an existing preview never reseeds it. Add `conversation` and failure/interruption scenarios with product features, seeded through application commands or validated synthetic data. Freeze clock/ID sources where assertions require repeatability.

Personal snapshots remain outside the initial workflow under [G06 and G09](../specs/open-questions.md). A later import must be explicit, sanitize sensitive content, exclude credentials, mark unfinished runs interrupted, and leave external actions disabled. Copy database state and referenced files at a consistent boundary. Use a non-disruptive export, not a template clone that terminates the source's sessions. Import never overwrites a preview implicitly.

## One launcher and configuration contract

`scripts/dev/` is the TypeScript lifecycle library and CLI; its launcher supervises child processes. Package scripts and Codex actions call it; a later Ash/MCP adapter can do the same. A bootstrap entry uses only Node built-ins until pinned dependencies are installed. Workspace lifecycle logic stays outside product feature modules; the application consumes validated runtime configuration.

Resolve checked-in defaults, local development options and explicit command arguments in that order. The launcher generates instance identity, storage roots, database access, service addresses and an authentication token. Reject conflicting inherited `DATABASE_URL`, application-home or port settings instead of silently mixing configurations. Keep generated runtime secrets in protected instance files; the developer's OpenAI key uses [`.env.local`](features/conversations.md#openai-mode). Status output exposes only safe metadata.

A versioned manifest records workspace/instance IDs, checkout and source fingerprint, profile, fixture version, schema version, service addresses, storage paths and lifecycle state. Backend, desktop launcher and test driver consume that resolved configuration or a safe subset. None independently hashes a name, appends a database suffix or adds a port offset.

### Startup and process ownership

1. Lock the instance; prepare its directories, database and migrations. A second start attaches to or opens the existing healthy instance. An incompatible database stops startup with a migration/reset diagnostic; it never triggers an automatic reset.
2. Start only the declared backend, frontend and desktop processes. Experimental packages have separate commands rather than joining a recursive `dev` invocation.
3. Bind services on loopback using OS-assigned ports where supported, then publish their actual addresses. For services requiring a chosen port, use bounded retries on failed binds; do not rely on a probe-then-bind check. Node supports binding to port `0` and retrieving the assigned port after listening. [Node server listen](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)
4. Require an authenticated readiness response matching the expected instance and schema before launching the client. A listening socket alone is insufficient. UI verification also waits for a connected scratchpad.
5. Record owned process groups and process start identity. Stop by ownership, never by port number or a bare remembered PID. On normal stop, startup failure or cancellation, close owned clients/workers and terminate their process groups with a bounded graceful period and forced fallback.

Unexpected supervisor loss must leave recoverable ownership records; the next status/start reconciles surviving processes before replacing them. Hot reload preserves the instance's data. If a service restart changes its address, republish configuration and reconnect or relaunch the client. Foreign listeners are never killed.

The shell has a workspace label, stable accent color and Dock badge. Human previews default to fullscreen; `--windowed` keeps a normal window. Verification windows are labeled distinctly and stay windowed; `--background` requests inactive display. Native Spaces/focus behavior needs manual verification. DevTools are available through Electron's menu. Closing the client leaves the backend available for reconnect testing; **Stop Preview** ends the entire instance.

## Commands

Run from the target checkout; cleanup commands accept registered instance identities, not arbitrary database URLs or deletion paths. Commands show concise summaries by default; add `--json` for structured output. Use `pnpm --silent dev` to omit pnpm's script banner too; Codex actions already do this. Normal starts remain attached to the terminal; Ctrl-C stops the instance. `--detach` leaves it running until explicit Stop.

| Codex action | Command | Contract |
| --- | --- | --- |
| Automatic setup | `pnpm dev:setup` | Install from the lockfile; ensure the pinned development database service is healthy; register workspace; create, migrate and seed its preview once. Idempotent and safe when workspaces set up concurrently. |
| Run Preview | `pnpm dev` | Start/open the persistent preview with hot reload; default fixture is `scratchpad`. |
| Status | `pnpm dev:status` | Report identity, source, profile, readiness, safe endpoints and owned-resource state; include actionable startup errors. |
| Stop Preview | `pnpm dev:stop` | Stop the preview and its children; retain application data. Never stop the shared database container. |
| Reset Preview | `pnpm dev:reset` | Stop the preview, replace all mutable application state with `scratchpad`, and leave it stopped. Add `--fixture empty` for blank state. |
| — | `pnpm test` | Run fast ownership, lock and environment unit tests. |
| — | `pnpm test:workflow` | Run isolated PostgreSQL, real-worktree and Electron integration checks. |
| Run Tests | `pnpm verify` | Run typechecking, build validation and relevant automated acceptance checks in fresh instances; write a report. A narrower selection must be explicit in the report. |
| Run Ephemeral Preview | `pnpm dev:verify --fixture scratchpad` | Start a fresh windowed instance for exploration; return its ID and endpoints. Ctrl-C stops and disposes it. A detached session requires explicit disposal. |
| — | `pnpm dev:dispose` | Stop and delete this workspace's preview, verification/test resources and generated runtime credentials; retain source, developer configuration and exported evidence. |

`--instance <id>` targets a registered instance for start/status/stop/reset/disposal; it cannot target a sibling workspace. `--headless` starts backend/frontend without Electron. `pnpm build` writes a local build to `dist/`; verification uses separate build output under its evidence directory.

### Reset and cleanup

Reset removes the target's database, files, settings, client state, pending jobs, logs and runtime credentials, then migrates and seeds fresh state. Preserve workspace identity, source changes, developer configuration and exported verification evidence. Rotate instance authentication so old clients cannot reconnect to reset state. Restarting is a separate operation.

Before destructive operations, verify the registered development-cluster identity, database ownership metadata and canonical instance directory; reject roots, symlink escapes, personal stores and mismatched IDs. A database-name suffix alone is insufficient. Disconnect only the target instance's sessions. Failed reset/disposal remains visibly incomplete and can be retried; never report ready after partial cleanup.

The integration test releases its owned resources in final cleanup, retaining evidence. A force-killed test can leave temporary resources for manual recovery; automatic orphan recovery and a shared-infrastructure teardown command are deferred. Ordinary Stop and Dispose leave the shared development PostgreSQL container running. Codex archive is not assumed to run a cleanup hook.

## Verification and evidence

### Manual checks

Open **Storage test screen**, then run these in order using disposable sample edits; reset deliberately removes the selected preview's data.

1. **Persistence and reopening:** Run, save a scratchpad note and file note, add a marker, and enable **Compact scratchpad**. Close the app window and Run again, then Stop and Run. Both notes, the count and the preference should survive. Repeated Run should reuse the same preview.
2. **Parallel features:** Open another Ash worktree based on the current `master` and Run it. Save different notes in A and B. Refresh or reopen each: labels distinguish the workspaces and each retains its own values. Stop A; B should still work.
3. **Ephemeral preview:** With A open, choose **Run Ephemeral Preview**. The window should say verification and start with fresh sample data. Change its note, then Ctrl-C that terminal. The ephemeral preview closes and is discarded; A's saved values remain.
4. **True reset:** Run `pnpm dev:reset --fixture empty` in A, then Run. Notes and file note should be blank, the counter zero and Compact off. B should retain its values. Reset leaves A stopped until Run.
5. **Hot reload:** In A's `packages/client/src/renderer/features/development/Scratchpad.svelte`, temporarily change the main heading to “Hot reload works.” The open A window should update while B stays unchanged. Revert the text; saved data should survive both updates.

### Automated checks

`pnpm verify` runs typechecking, an isolated build, unit tests and the workflow integration suite. It writes `report.json`, `checks.log`, screenshots and cleanup results under the printed evidence directory. Tests exercise two simultaneous worktrees plus a verification instance, cross-database access denial, database/file/client persistence, renderer hot reload, reset/token rotation, native launch/stop, supervisor crash recovery, Docker configuration changes, database-container recreation and disposal. Protected server configuration is excluded from Vite's served paths. The test helper in `tests/integration/workflow.test.ts` drives real Electron windows with Playwright.

Future product verification: keep deterministic regression checks and agent exploration distinct in reports. Extend the driver with conversation, recorded input/run/context/output inspection, attachment and voice controls as those features land. Observation endpoints must remain authenticated and development-only.

The deterministic adapter supports streaming, controlled delay, failure and cancellation. [OpenAI mode](features/conversations.md#openai-mode) separates interactive chat from bounded live checks and isolates the credential from the client. Mocked Responses protocol tests run in ordinary verification; [live-test model selection and budget exhaustion](plans/persisted-chat-tests.md#openai-adapter) do not constrain offline coverage. Report calls and available usage.

Use the [chat test plan](plans/persisted-chat-tests.md) for this slice and the remaining [C01–C14](../specs/features/conversations.md#acceptance-examples) as their features land. The restore test follows the [backup and recovery design](data-model.md#backup-and-recovery): use synthetic data and restore a physical backup plus archived WAL into an isolated PostgreSQL instance, not the shared development cluster. Verify C10 with external dispatch disabled, then separately verify startup interruption handling. Add accepted artifact-move examples when that feature enters scope.

Each report records source commit plus dirty-content fingerprint, lockfile, fixture and schema versions, commands/scenarios, outcomes, model mode, screenshots and relevant traces. Source changes during verification invalidate the result. Include failed/skipped checks and subjective judgments; a screenshot alone is not a pass. Store evidence outside disposable state and never include credentials. Recheck the integrated revision after merge, especially migrations and shared contracts; code integration never merges preview databases.

## Codex now and Ash later

Codex's local environment setup and [actions](#commands) call repository commands. Keep generated `.codex` configuration in Git. Codex supports automatic worktree setup and project actions; `.worktreeinclude` can copy selected ignored local setup files. If needed, include only a designated development configuration file, never `.ash-dev/`, runtime databases, instance credentials or a general personal `.env`. [Local environments](https://learn.chatgpt.com/docs/environments/local-environment), [worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)

Use Codex's chat/worktree tools for feature routing and status instead of reproducing Asha's private Conductor-database and Accessibility integration. Recorded feedback should remain attached to its destination chat with the reproduction scenario and evidence.

Later, Ash can attach a workspace ID and verification report to a Run and use the same lifecycle adapter. Workspace creation and testing do not authorize publishing or replacing the running product. Decisions, promotion and rollback follow G08/G10; a Git rollback alone cannot reverse a database migration. Keep development resource records outside the core Artifact Log so provisioning/reset never depends on the instance being tested.

## Workflow acceptance

The storage/lifecycle suite and deterministic chat checks cover the implemented slice. Conversation/PITR recovery (DEV-10), full worker parallelism, foreground-focus guarantees, exhaustive startup cancellation and orphan tooling remain deferred or unverified.

| ID | Scenario and required result |
| --- | --- |
| DEV-01 | Set up two worktrees simultaneously: each gets distinct identities/data; the shared database service is created once and neither setup clears existing state. |
| DEV-02 | Run two previews plus verification: change conversations, instructions, settings and files in one; all others remain unchanged, and its runtime database credentials cannot connect to a sibling. |
| DEV-03 | Occupy a candidate port with an unrelated process: startup selects another valid address or fails clearly; the unrelated process remains alive and no client connects to it. |
| DEV-04 | Start the same preview twice: one backend remains; both commands identify the same instance. Restart/reconnect preserves its data. |
| DEV-05 | Run tests in parallel across and within worktrees: no shared mutable database, file directory or build output; one worker's cleanup cannot affect another. |
| DEV-06 | Stop, cancel startup or crash the supervisor: owned processes are cleaned up or identified for recovery; another workspace stays running. A reused PID is never treated as proof of ownership. |
| DEV-07 | Reset a populated preview: all mutable application state returns to the fixture, old client credentials fail, and source/evidence/sibling state is unchanged. A forged target or symlink escape is rejected. |
| DEV-08 | Run with inherited personal connection/path/key settings: launcher rejects conflicts and synthetic children receive no personal credentials. Inspect written paths and captured external actions. |
| DEV-09 | Rename a branch or start from detached HEAD: resource ownership remains stable. A copied workspace marker cannot take ownership of the original instance. |
| DEV-10 | Restore conversation data under C10 in an isolated PostgreSQL instance: state matches the selected recovery point, external-call count is zero, and startup does not redispatch restored work. |
| DEV-11 | Verify while a human uses the preview: preview state/focus is preserved, evidence identifies the tested source, and changing source invalidates the result. |
| DEV-12 | Dispose resources and remove the checkout: no owned processes/databases remain; reports survive. Unexpected checkout removal exposes orphaned resources without deleting them automatically. |

Restore checks remain pending. Ongoing spending and personal-data decisions remain in G09; stronger execution isolation and rollout belong to G10.
