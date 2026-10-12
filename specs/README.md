# Product specs

[Principles and terminology](product.md) · [Open questions](open-questions.md) · [Architecture](../docs/architecture.md) · [Data model](../docs/data-model.md) · [DBML](data/model.dbml) · [File structure](../docs/repository-structure.md)

Requirements come from [HUMAN_SPEC.md](HUMAN_SPEC.md) and subsequent user decisions. Accepted refinements supersede the corresponding original requirement. Label additions as proposed or assumed; keep unresolved conflicts explicit.

## Feature index

Sequencing is proposed. Source names refer to overview headings.

| Feature | Scope from the source | Proposed placement | Source / unresolved issues |
| --- | --- | --- | --- |
| [Conversations](features/conversations.md) | Text input, visible artifacts, follow-up within a continuing matter | First | Interaction Model; G03, G05, G07 |
| Topics and organization | Zero or more topics per thread; instructions; suggestions for linking, splitting, merging, moving, and references | Manual topic creation/linking first; intelligent organization later | Topics, Threads, and Artifacts; G04 |
| [Artifact processing and inspection](features/artifacts.md) | Listen → Input → Filter → Route → Act → Surface; trace results to inputs; inspect processing | Ownership and single-source chains accepted; application audit history deferred; direct text path first | Artifact Engine; Open Questions / Notes; remaining G03, G09 |
| Backup recovery and history | PITR for database recovery; retained Artifacts and model requests for inspection | Replaces application-event replay under ART-R08; restore verification in first journey | Replayable State superseded; G03, G06 |
| Runs and background work | Durable execution, waiting, cancellation, retries, related entities and results | One response run first; general background execution later | Artifact Engine, Act; G02, G07 |
| Context and retrieval | Instructions, thread history, topic context, memories, tools, observed events, tasks and decisions | Bounded current-thread context first; broader retrieval later | Context Engine; G05, G09 |
| [Instructions](features/instructions.md), agent configuration and skills | Personality, model routing, reproducible skills, user-visible and editable instructions | Owned editable documents and captured requests accepted; base editing first; broader routing and skills later | Agent / Basics; Instructions; G05, G08, G09 |
| Semantic memory | Durable facts/preferences, freshness and forgetting | Later; design unresolved | Memory Engine; G06 |
| Thread visibility | Intelligent archive timing, revival, activity indicators; consider overrides, pinning and undo | Manual archive/pin and Run status first; archive automation later | Visibility; G04, G06 |
| Live Mode | Continuous voice/video; separate Live Threads; focus on other threads; pause, resume and device handoff | Later | Live Mode; G02, G09 |
| [Images](features/images.md) and other input | Images and descriptions; later dictation, files, video and continuous streams | Images implemented; other formats later | Artifact Engine; Agent / Basics; Data Primitives; G06, G09 |
| Connectors and tools | API/MCP/filesystem access, external inputs, configurable listeners | Later; first integration to be chosen | Agent / Basics; Artifact Engine; G08, G09 |
| Tasks | User/Ash ownership, unassigned work, snooze/complete/archive/delete; independent of threads with links | Later | Built-In Features / Tasks; G06, G07 |
| Decisions | Collect required user input; snooze/respond; optional comments and urgent notification | Later, before gated agent actions | Built-In Features / Decisions; G08 |
| [Permissions](features/permissions.md) | Deterministic and semantic rules, formalization, resource boundaries and user authorization; UI-only categories | Starting implementation accepted; isolated experiments complete; app integration pending | Permissions system; G08 |
| Notifications | Ash-originated notifications; snooze/dismiss/comment; device-aware delivery | Later | Notifications; Interfaces; G02, G09 |
| Built-in apps | Canvas, drawing and file viewer; versioning, search/citation, links from threads | Later | Built-In Features / Apps; G06, G10 |
| Desktop | Topics/threads, chat, feature/app panels, companion, shortcuts, context and artifact inspectors | Conversation and minimal inspection first | Desktop App; G02 |
| Mobile and wearables | Mobile viewing/chat/features; quick capture; microphone and audio devices; device-aware responses | Later | Mobile App; Wearables; G02, G09 |
| Computer and browser use | Control personal or separate environments, including away-from-computer use | Later; execution environment unresolved | Computer / Browser Use; G02, G08 |
| Custom apps | User/Ash collaboration, versioned apps, isolated data/files/runtime and separate version control | Later | Self-Modding / Custom Apps; G10 |
| Self-modification | Instruction edits through Decisions; isolated code workspaces, testing and rollback; future sharing/upgrades | Later | Instructions; Self-Modding; G08, G10 |
| Observation, timeline and dreamtime | Observe activity, summarize daily history, review during spare capacity | Later; privacy/cost boundaries first | Other Features; G09 |
| Recurring and long-running workflows | Recurring jobs, decomposed work, periodic summaries and apartment alerts | Later | Use-Cases; G07, G09 |
| Domain apps and extensions | Notes/Obsidian, CRM, finance/assets, use-case planner, drinks app, people research, social media assistance, spreadsheets, homepage, meeting notes, flashcards, autofill, crypto experiments | Exploratory; select individual journeys later | Use-Cases; G08–G10 |
| Personalization ideas | Proactive questions, changing personality glyph, talents/achievements, sharing adaptation concepts | Exploratory | Other Features; Use-Cases; Version Control + Sharing |

## First journey

Current delivery: [persisted chat and Artifact inspection](features/conversations.md#scope), extended with [images and descriptions](features/images.md). Topic management and instruction editing follow separately. [Implementation](../docs/features/conversations.md) · [Test plan](../docs/plans/persisted-chat-tests.md).

Next direction, accepted 2026-10-12: usable self-modification through images, tools and Topics/context. The [delivery plan](../docs/plans/self-modification.md) proposes the sequence and acceptance targets, superseding the broad placement above for that path.
