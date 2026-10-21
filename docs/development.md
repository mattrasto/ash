# Development workflow

Workflow accepted, 2026-10-09 · Persisted chat with live OpenAI previews

Give each feature a Git worktree, a persistent preview and disposable verification environments. Repository commands own the runtime; Codex supplies worktrees and launch actions. Ash can later invoke the same commands for [self-modification](../specs/HUMAN_SPEC.md#modifying-ashs-code).

The Electron/Svelte shell opens [persisted chat](features/threads.md). Desktop verification uses threads, drafts and sidebar preferences. The authenticated scratchpad API and `dev_scratch` fixture remain internal database/file isolation probes; there is no storage test screen or developer-info panel. Use `pnpm dev:status --json` for instance diagnostics. PITR operation, signed packaging, personal-data imports and production rollout remain deferred.

## Run the preview

Prerequisites: macOS desktop session, Node 22.12 or later, pnpm 9 and running Docker Desktop. Versions are pinned in the lockfile and PostgreSQL image digest. `pnpm verify` runs hidden Electron windows; a graphical session is still required. The [verified baseline](testing.md#verified-baseline) covers macOS automated and manual checks. Linux/Windows remain unverified.

Schema verification uses `@dbml/core` directly, avoiding unused database connectors. The root `pnpm.overrides` pins Prisma 6's merge dependency to patched `deepmerge-ts` 8.0.2 for [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx); recheck this override when upgrading Prisma.

```sh
pnpm dev:setup
pnpm dev
```

Use Codex's checked-in `.codex/environments/environment.toml` for automatic worktree setup and the [preview and test actions](#commands). In the current Codex layout, hide the sidebar to reveal Actions. The same commands work from a terminal. Setup uses `node scripts/dev/setup.mjs` so installation works before dependencies exist. Setup and automated tests require no credentials; the normal preview requires the checkout's [OpenAI key](features/threads.md#openai-mode). Use `pnpm dev --deterministic` only for an explicit offline demo.

The launcher requires process inspection, loopback sockets and Docker access. A coding-agent sandbox may need permission to run it; denial of process inspection fails closed. Logs live in the instance's `logs/` directory, and `pnpm dev:status --json` reports safe endpoints and errors. After changing launcher code or dependencies, stop and start again; app source changes reload automatically. Startup reuses the verified healthy database container unless its identity or Compose configuration changes. After restarting Docker, Run Preview restores the development service and reconnects the preview without reseeding, including when Docker assigns a different database port.

## Everyday flow

Read-only tools require an explicit [filesystem configuration](features/filesystem.md#configure-filesystem-access). Configure only this workspace's selected source or synthetic fixtures; returned content is saved and may reach the configured model.

1. Start a Codex chat in a new worktree for a feature. Automatic setup installs pinned dependencies, registers the workspace and prepares its preview data.
2. Choose **Run Preview**. Open that feature's chat preview with hot reload. Other feature previews keep running.
3. Iterate in the same preview; restarts preserve its database, file and client preference. Reset explicitly when a clean fixture is useful. Product fixtures will replace the scratchpad as features land.
4. Follow the [testing workflow](testing.md): run automated checks and let the coding agent exercise a separate verification instance. Testing does not interrupt or rewrite the preview being inspected.
5. The coding agent reviews the diff and evidence, then demonstrates the feature and presents any targeted manual checks. Follow the [delivery agreement](../specs/product.md#confirmed-engineering-agreement) for review and integration.
6. Preserve source changes in a Git checkpoint or saved patch, including relevant untracked files. Dispose of development resources before archiving the checkout; retain verification evidence.

## Git integration

Each feature worktree must contribute exactly one commit to `master`, including its fixes and documentation. Keep recoverable checkpoint commits while developing, then squash them before integration. For multiple worktrees, retain one commit per worktree in dependency order; fold conflict resolutions and integration fixes into the corresponding feature commit.

Keep `master` linear: squash-merge pull requests, or squash and rebase local work onto current `master`, verify the resulting revision, then fast-forward. Do not fast-forward an unsquashed feature branch or create merge commits. Rebase active feature branches when they need trunk updates.

Remove completed branches after integration; preserve preview data and local configuration before retiring worktrees. Published history rewrites require explicit user approval and a recovery backup.

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

Versioned `empty` and `scratchpad` fixtures both seed the base response instructions; they start with no threads. Seeding a new instance is automatic; starting an existing preview never reseeds it. Add `thread` and failure/interruption scenarios with product features, seeded through application commands or validated synthetic data. Freeze clock/ID sources where assertions require repeatability.

Personal snapshots remain outside the initial workflow under [G06 and G09](../specs/open-questions.md). A later import must be explicit, sanitize sensitive content, exclude credentials, mark unfinished runs interrupted, and leave external actions disabled. Copy database state and referenced files at a consistent boundary. Use a non-disruptive export, not a template clone that terminates the source's sessions. Import never overwrites a preview implicitly.

## One launcher and configuration contract

`scripts/dev/` is the TypeScript lifecycle library and CLI; its launcher supervises child processes. Package scripts and Codex actions call it; a later Ash/MCP adapter can do the same. A bootstrap entry uses only Node built-ins until pinned dependencies are installed. Workspace lifecycle logic stays outside product feature modules; the application consumes validated runtime configuration.

Resolve checked-in defaults, local development options and explicit command arguments in that order. The launcher generates instance identity, storage roots, database access, service addresses and an authentication token. Reject conflicting inherited `DATABASE_URL`, application-home or port settings instead of silently mixing configurations. Keep generated runtime secrets in protected instance files; the developer's OpenAI key uses [`.env.local`](features/threads.md#openai-mode). Status output exposes only safe metadata.

A versioned manifest records workspace/instance IDs, checkout and source fingerprint, profile, fixture version, schema version, service addresses, storage paths and lifecycle state. Backend, desktop launcher and test driver consume that resolved configuration or a safe subset. None independently hashes a name, appends a database suffix or adds a port offset.

### Startup and process ownership

1. Lock the instance; prepare its directories, database and migrations. A second start attaches to or opens the existing healthy instance. An incompatible database stops startup with a migration/reset diagnostic; it never triggers an automatic reset.
2. Start only the declared backend, frontend and desktop processes. Experimental packages have separate commands rather than joining a recursive `dev` invocation.
3. Bind the backend on loopback with an OS-assigned port. On first launch, Vite retries actual binds for a random frontend port, then stores it in the instance's `frontend.json`. Reuse that port across restarts so browser drafts and preferences keep their origin; an occupied saved port fails startup instead of moving storage. Existing desktops adopt the URL from `client.json`. Stop the conflicting listener before retrying. Disposal removes the port record; reset clears client state. Never probe availability before binding. [Node server listen](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)
4. Require an authenticated readiness response matching the expected instance and schema before launching the client. A listening socket alone is insufficient. UI verification also waits for a connected thread.
5. Record owned process groups and process start identity. Stop by ownership, never by port number or a bare remembered PID. On normal stop, startup failure or cancellation, close owned clients/workers and terminate their process groups with a bounded graceful period and forced fallback.

Unexpected supervisor loss must leave recoverable ownership records; the next status/start reconciles surviving processes before replacing them. Hot reload preserves the instance's data. If a service restart changes its address, republish configuration and reconnect or relaunch the client. Foreign listeners are never killed.

A persistent 44px accent bar identifies the current branch, worktree path and instance type, including in fullscreen and with the sidebar hidden. Hover the worktree for its full path and workspace/instance IDs; disposable instances also show their short ID. Branch changes refresh within about six seconds without changing resource ownership. Detached HEAD shows the revision; unavailable Git metadata is labeled explicitly. The native window title includes the branch, and the Dock retains the workspace badge. Human previews default to fullscreen; `--windowed` keeps a normal window. Automated tests use `--background`: windows stay hidden and non-focusable, omit the macOS Dock icon, and keep rendering for interaction and screenshot checks. This takes precedence over fullscreen. `--headless` omits Electron entirely; `pnpm dev:verify` without `--background` opens a visible disposable window for manual checks. Native Spaces/focus changes follow the [manual verification policy](testing.md#evidence-and-handoff). DevTools are available through Electron's menu. Closing the client leaves the backend available for reconnect testing; **Stop Preview** ends the entire instance.

## Commands

Run from the target checkout; cleanup commands accept registered instance identities, not arbitrary database URLs or deletion paths. Commands show concise summaries by default; add `--json` for structured output. Use `pnpm --silent dev` to omit pnpm's script banner too; Codex actions already do this. Normal starts remain attached to the terminal; Ctrl-C stops the instance. `--detach` leaves it running until explicit Stop.

| Codex action | Command | Contract |
| --- | --- | --- |
| Automatic setup | `pnpm dev:setup` | Install from the lockfile; ensure the pinned development database service is healthy; register workspace; create, migrate and seed its preview once. Idempotent and safe when workspaces set up concurrently. |
| Run Preview | `pnpm dev` | Start/open the persistent preview with hot reload; default fixture is `scratchpad`. |
| Status | `pnpm dev:status` | Report identity, source, profile, readiness, safe endpoints and owned-resource state; include actionable startup errors. |
| Stop Preview | `pnpm dev:stop` | Stop the preview and its children; retain application data. Never stop the shared database container. |
| Reset Preview | `pnpm dev:reset` | Stop the preview, replace all mutable application state with `scratchpad`, and leave it stopped. Add `--fixture empty` for blank state. |
| Quick Checks | `pnpm verify --profile quick` | Types and fast boundary checks; partial verification. |
| — | `pnpm test:workflow` | Run isolated PostgreSQL, real-worktree and Electron integration checks. |
| Run Tests | `pnpm verify` | Full automated verification. Selection, suite commands and evidence: [testing](testing.md#commands). |
| Run Ephemeral Preview | `pnpm dev:verify --fixture scratchpad --live-calls 20 --live-minutes 10` | Start a fresh live instance for exploration; return its ID and endpoints. Ctrl-C stops and disposes it. A detached session requires explicit disposal. |
| — | `pnpm dev:dispose` | Stop and delete this workspace's preview, verification/test resources and generated runtime credentials; retain source, developer configuration and exported evidence. |

`--instance <id>` targets a registered instance for start/status/stop/reset/disposal; it cannot target a sibling workspace. `--headless` starts backend/frontend without Electron. `pnpm build` writes a local build to `dist/`; verification uses separate build output under its evidence directory.

### Reset and cleanup

Reset removes the target's database, files, settings, client state, pending jobs, logs and runtime credentials, then migrates and seeds fresh state. Preserve workspace identity, source changes, developer configuration and exported verification evidence. Rotate instance authentication so old clients cannot reconnect to reset state. Restarting is a separate operation.

Before destructive operations, verify the registered development-cluster identity, database ownership metadata and canonical instance directory; reject roots, symlink escapes, personal stores and mismatched IDs. A database-name suffix alone is insufficient. Disconnect only the target instance's sessions. Failed reset/disposal remains visibly incomplete and can be retried; never report ready after partial cleanup.

The integration test releases its owned resources in final cleanup, retaining evidence. A force-killed test can leave temporary resources for manual recovery; automatic orphan recovery and a shared-infrastructure teardown command are deferred. Ordinary Stop and Dispose leave the shared development PostgreSQL container running. Codex archive is not assumed to run a cleanup hook.

## Verification and evidence

The [testing approach](testing.md), [chat test plan](plans/persisted-chat-tests.md) and [image test plan](features/images.md) own coverage policy, scenario selection, evidence, visual expectations and manual procedures. `pnpm verify` runs the full automated gate; quick and selected runs are explicitly partial. Use `pnpm dev:verify` for agent exploration or targeted human checks without changing the persistent preview.

## Codex now and Ash later

Codex's local environment setup and [actions](#commands) call repository commands. Keep generated `.codex` configuration in Git. The root [`.worktreeinclude`](../.worktreeinclude) copies the ignored root `.env.local` when Codex creates a local managed worktree. Codex skips symlinks and existing destination files. Keep the source file owner-only (`chmod 600 .env.local`); credentials remain outside Git. This does not apply to manual `git worktree add` or the synthetic test-worktree helper. Do not include `.ash-dev/`, runtime databases, instance credentials or a general personal `.env`. [Local environments](https://learn.chatgpt.com/docs/environments/local-environment), [worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)

Use Codex's chat/worktree tools for feature routing and status instead of reproducing Asha's private Conductor-database and Accessibility integration. Recorded feedback should remain attached to its destination chat with the reproduction scenario and evidence.

Later, Ash can attach a workspace ID and verification report to a Run and use the same lifecycle adapter. Workspace creation and testing do not authorize publishing or replacing the running product. Decisions, promotion and rollback follow G08/G10; a Git rollback alone cannot reverse a database migration. Keep development resource records outside the core Artifact Log so provisioning/reset never depends on the instance being tested.

## Workflow acceptance

The storage/lifecycle suite and deterministic chat checks cover the implemented slice. Thread/PITR recovery (DEV-10), full worker parallelism, foreground-focus guarantees, exhaustive startup cancellation and orphan tooling remain deferred or unverified.

| ID | Scenario and required result |
| --- | --- |
| DEV-01 | Set up two worktrees simultaneously: each gets distinct identities/data; the shared database service is created once and neither setup clears existing state. |
| DEV-02 | Run two previews plus verification: change threads, instructions, settings and files in one; all others remain unchanged, and its runtime database credentials cannot connect to a sibling. |
| DEV-03 | Occupy a candidate port with an unrelated process: startup selects another valid address or fails clearly; the unrelated process remains alive and no client connects to it. |
| DEV-04 | Start the same preview twice: one backend remains; both commands identify the same instance. Restart/reconnect preserves its data. |
| DEV-05 | Run tests in parallel across and within worktrees: no shared mutable database, file directory or build output; one worker's cleanup cannot affect another. |
| DEV-06 | Stop, cancel startup or crash the supervisor: owned processes are cleaned up or identified for recovery; another workspace stays running. A reused PID is never treated as proof of ownership. |
| DEV-07 | Reset a populated preview: all mutable application state returns to the fixture, old client credentials fail, and source/evidence/sibling state is unchanged. A forged target or symlink escape is rejected. |
| DEV-08 | Run with inherited personal connection/path/key settings: launcher rejects conflicts and synthetic children receive no personal credentials. Inspect written paths and captured external actions. |
| DEV-09 | Rename a branch or start from detached HEAD: resource ownership remains stable. A copied workspace marker cannot take ownership of the original instance. |
| DEV-10 | Restore thread data under C10 in an isolated PostgreSQL instance: state matches the selected recovery point, external-call count is zero, and startup does not redispatch restored work. |
| DEV-11 | Verify while a human uses the preview: preview state/focus is preserved, evidence identifies the tested source, and changing source invalidates the result. |
| DEV-12 | Dispose resources and remove the checkout: no owned processes/databases remain; reports survive. Unexpected checkout removal exposes orphaned resources without deleting them automatically. |

Restore checks remain pending. Ongoing spending and personal-data decisions remain in G09; stronger execution isolation and rollout belong to G10.
