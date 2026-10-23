# Ash

Start with `specs/README.md`, `specs/product.md` and the relevant feature spec. For frontend work, also read [design requirements](specs/design-system.md) and [integration/code guidance](docs/features/design-system.md); verify the affected DS-R requirements and DS-V scenarios. Follow engineering links as needed.

## Documentation

- `specs/` owns product behavior; `docs/` owns engineering design and implementation context.
- Feature specs cover goal, flow, rules, acceptance examples and open questions. Keep stable IDs once referenced by designs or tests.
- Mark proposals and assumptions; record accepted decisions. Keep approval, implementation and verification status distinct, with one short status line where needed.
- Write each rule once and link to it. Add code paths and symbols when they explain implementation. Preserve detail that affects behavior, decisions or verification; cut repeated caveats and obvious explanations.
- Stubs are fine when useful; label them `TODO` or `Stub`.
- `specs/HUMAN_SPEC.md` is user-owned; do not edit without permission. This is the canonical project instruction file; personal preferences stay global.

## Engineering

- Follow the delivery agreement in `specs/product.md` and layout in `docs/repository-structure.md`.
- Proceed with routine reversible work. Surface consequential scope, behavior, privacy, cost and production-risk decisions.
- Use isolated development data, guarded reset commands and recoverable Git checkpoints.
- Follow the [Git integration requirements](docs/development.md#git-integration) before merging a feature worktree.
- With Docker running, `pnpm dev:setup` installs dependencies and prepares isolated data; `pnpm dev` opens the persistent desktop preview. Use `pnpm dev:stop` to stop it.
- Follow the [testing approach](docs/testing.md): no routine unit tests; prefer boundary integration and real-app scenarios. Use `pnpm verify --profile quick` while iterating and full `pnpm verify` before integration. Keep source unchanged during verification; review the diff and explore the actual app before handoff.
- Verification reports serve agent diagnostics. Give the user concise outcomes and targeted manual checks when needed, not a report-reading task. Commands, reset/disposal and prerequisites: [development workflow](docs/development.md).
