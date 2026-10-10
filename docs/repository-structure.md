# Repository structure

Proposed product layout. The three-package desktop bootstrap exists; product feature folders and Prisma are planned.

```text
ash/
├── README.md
├── AGENTS.md
├── specs/
│   ├── HUMAN_SPEC.md                 # User-owned source spec
│   ├── README.md                     # Feature index
│   ├── product.md                    # Principles and terminology
│   ├── open-questions.md
│   ├── features/<feature>.md         # Behavior and acceptance examples
│   └── data/model.dbml
├── docs/
│   ├── architecture.md
│   ├── data-model.md                # Ownership, context capture, Run state and recovery
│   ├── repository-structure.md
│   ├── development.md               # Workspace lifecycle, isolation and verification
│   ├── decisions/<id>-<name>.md      # Choice, reason, consequences
│   ├── features/<feature>.md         # Design, code map, test references
│   └── plans/<milestone>.md          # Build sequence
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .codex/                           # Codex setup/actions invoking repository commands
├── .ash-dev/                         # Ignored checkout identity; runtime state is external
├── compose.yaml                      # Shared development-only PostgreSQL
├── packages/
│   ├── client/
│   │   ├── package.json
│   │   └── src/
│   │       ├── main/                 # Electron lifecycle, native integration
│   │       ├── preload/              # Native bridge
│   │       └── renderer/
│   │           ├── app/              # Shell, navigation, connection
│   │           ├── features/         # Feature UI and local state
│   │           └── ui/               # Reused visual components
│   ├── server/
│   │   ├── package.json
│   │   ├── prisma/                   # Planned schema/migrations; layout follows the pinned Prisma version
│   │   ├── src/
│   │   │   ├── main.ts               # Process startup/shutdown
│   │   │   ├── app.ts                # App assembly
│   │   │   ├── modules/
│   │   │   │   ├── conversations/    # Threads and conversation operations
│   │   │   │   ├── organization/     # Topics and membership
│   │   │   │   ├── artifacts/        # Engine records, lineage and Surface content
│   │   │   │   ├── runs/             # Execution and linked retries
│   │   │   │   ├── context/          # Selection and inspection
│   │   │   │   └── instructions/     # Editable documents owned by scopes
│   │   │   └── platform/
│   │   │       ├── config.ts
│   │   │       ├── db/               # Connection, transactions, schema aggregation
│   │   │       └── models/           # Provider adapters and test model
│   │   └── test/integration/
│   └── shared/
│       ├── package.json
│       └── src/contracts/            # Cross-process requests, responses, events
├── scripts/
│   ├── dev/                          # Workspace launcher, provisioning, reset and verification
│   └── ...                           # DBML export and other repository tooling
├── tests/
│   ├── e2e/
│   └── fixtures/                     # Synthetic data
└── .github/workflows/                # CI, if hosted on GitHub
```

## Boundaries

- Client and server import shared contracts; shared imports neither. Client cannot import server code.
- Features own their operations, schema definitions and tests. Cross-feature calls use explicit interfaces; database schemas aggregate centrally.
- Shared contains cross-process contracts and validation, not database tables, provider SDKs or runtime prompts.
- Runtime instruction defaults live in their server feature; editable documents and owner references live in the database.
- Unit tests sit beside implementation. Integration tests span server modules; end-to-end tests exercise the app.
- Start features with a file and a test. Split routes, services and persistence when useful.
- Keep secrets, runtime data and generated output out of Git. Custom apps have separate stores and repositories.

Database consistency and migration rules: [architecture](architecture.md). Development commands and resource ownership: [development workflow](development.md). Product and delivery constraints: [product](../specs/product.md).
