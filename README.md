# Ash

A private personal agent. Separate from Asha. The desktop preview supports persisted chat, image input with descriptions, and Artifact inspection with a deterministic default and an opt-in [OpenAI adapter](docs/features/threads.md#openai-mode).

With Node 22.12+, pnpm 9 and Docker running: `pnpm dev:setup`, then `pnpm dev`. Run `pnpm verify` for the automated workflow checks. See [development workflow](docs/development.md) for commands and prerequisites.

- [Product specs](specs/README.md)
- [Design system](specs/design-system.md) · [Frontend implementation](docs/features/design-system.md)
- [Repository structure](docs/repository-structure.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md) · [DBML](specs/data/model.dbml)
- [Development workflow](docs/development.md)
- [Chat implementation](docs/features/threads.md) · [Test plan](docs/plans/persisted-chat-tests.md)
- [Images: implementation and test plan](docs/features/images.md)
- [Testing](docs/testing.md)
- [Project instructions](AGENTS.md)
