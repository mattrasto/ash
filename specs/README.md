# Product specs

[Principles and terminology](product.md) · [Open questions](open-questions.md) · [Architecture](../docs/architecture.md) · [Data model](../docs/data-model.md) · [DBML](data/model.dbml) · [File structure](../docs/repository-structure.md)

Requirements come from [HUMAN_SPEC.md](HUMAN_SPEC.md) and subsequent user decisions. Accepted refinements supersede the corresponding original requirement. Label additions as proposed or assumed; keep unresolved conflicts explicit.

Frontend work: [design requirements](design-system.md) distinguish hard requirements, experiential principles and optional refinements. [Integration and verification](../docs/features/design-system.md).

## Feature index

Sequencing is proposed. Source names refer to overview headings.

| Feature | Scope from the source | Proposed placement | Source / unresolved issues |
| --- | --- | --- | --- |
| [Threads](features/threads.md) | Text input, visible artifacts, follow-up within a continuing matter | First | Interaction Model; G03, G05, G07 |
| [Topics and organization](features/topics-context.md) | Zero or more topics per thread; instructions; suggestions for linking, splitting, merging, moving, and references | Manual Topics and bounded context implemented; intelligent organization later | Topics, Threads, and Artifacts; G04 |
| [Artifact processing and inspection](features/artifacts.md) | Listen → Input → Filter → Route → Act → Surface; trace results to inputs; inspect processing | Autonomous incoming Filter/Route and independent action/presentation implemented; synthetic checks passing | Artifact Engine; Open Questions / Notes; remaining G03, G09 |
| Backup recovery and history | PITR for database recovery; retained Artifacts and model requests for inspection | Replaces application-event replay under ART-R08; restore verification in first journey | Replayable State superseded; G03, G06 |
| Runs and background work | Durable execution, waiting, cancellation, retries, related entities and results | One response run first; general background execution later | Artifact Engine, Act; G02, G07 |
| [Context and retrieval](features/topics-context.md#what-enters-an-answer) | Instructions, thread history, topic context, memories, tools, observed events, tasks and decisions | Applicable instructions and bounded Topic retrieval implemented; explicit references deferred | Context Engine; G05, G09 |
| [Instructions](features/instructions.md), agent configuration and skills | Personality, reproducible skills, user-visible and editable instructions | Owned instruction editor and captured requests implemented; broader skills later | Agent / Basics; Instructions; G05, G08, G09 |
| [Model routing](features/model-routing.md) | Model selection and upgrade-only reassessment, editable Instruction and Jev assessments without routine composer controls | Initial naive policy implemented; calibration later | Agent / Basics; user direction, 2026-10-22; G09 |
| Semantic memory | Durable facts/preferences, freshness and forgetting | Later; design unresolved | Memory Engine; G06 |
| [Thread visibility](features/thread-visibility.md) | Intelligent archive timing, revival, naming, activity indicators and manual controls | Model-first assessments and application history implemented | Visibility; G04, G06 |
| Live Mode | Continuous voice/video; separate Live Threads; focus on other threads; pause, resume and device handoff | Later | Live Mode; G02, G09 |
| [Images](features/images.md) and other input | Images and descriptions; later dictation, files and continuous streams | Images implemented; other formats later | Artifact Engine; Agent / Basics; Data Primitives; G06, G09 |
| [Screen recording and video understanding](features/recording-feedback.md) | Video attachments, recording, captions and understanding tools; visual feedback for Adapt; eventual Live Mode | Recording and Flash understanding implemented; Adapt visual feedback implemented | Revised user direction, 2026-10-23; feature-level decisions |
| [Tool execution and inspection](features/tools.md) | Common tool lifecycle, concurrency, progress and inspection; read-only filesystem tools | Implemented | Agent / Basics; Artifact Engine; G08, G09 |
| Tasks | User/Ash ownership, unassigned work, snooze/complete/archive/delete; independent of threads with links | Later | Built-In Features / Tasks; G06, G07 |
| [Decisions](features/decisions.md) | Required questions, choices and permission requests; independent page, snooze/respond and linked work | Implemented for current tool workflows | Built-In Features / Decisions; G08 |
| [Permissions](features/permissions.md) | One explicit matcher or semantic condition per Permission, reviewed overrides, formalization and authorization; UI-only categories | Single-condition storage/editor, reviewed overrides and current-tool integration implemented | Permissions system; G08 |
| Notifications | Ash-originated notifications; snooze/dismiss/comment; device-aware delivery | Later | Notifications; Interfaces; G02, G09 |
| Built-in apps | Canvas, drawing and file viewer; versioning, search/citation, links from threads | Later | Built-In Features / Apps; G06, G10 |
| Desktop | Topics/threads, chat, feature/app panels, companion, shortcuts, context and artifact inspectors | Thread and minimal inspection first | Desktop App; G02 |
| [Living scenes](features/scenes.md) | Quiet illustrated panoramas, automatic effects, scene/location settings and Debug Mode controls | Cached playback implemented; [generation and other follow-up deferred](features/scenes.md#deferred-work) | Accepted integration spec and refinements, 2026-10-22–23 |
| Mobile and wearables | Mobile viewing/chat/features; quick capture; microphone and audio devices; device-aware responses | Later | Mobile App; Wearables; G02, G09 |
| Computer and browser use | Control personal or separate environments, including away-from-computer use | Later; execution environment unresolved | Computer / Browser Use; G02, G08 |
| Custom apps | User/Ash collaboration, versioned apps, isolated data/files/runtime and separate version control | Later | Self-Modding / Custom Apps; G10 |
| [Adapt Threads](features/adapt.md) | Automatic Thread mode entry, isolated coding Workspaces, replaceable adapters, parallel renderer changes, previews and verified local UI application | Implemented; source integration/distribution deferred | Self-Modding; G08, G10 |
| Self-modification | Instruction edits through Decisions; isolated code workspaces, testing and rollback; future sharing/upgrades | Later | Instructions; Self-Modding; G08, G10 |
| Observation, timeline and dreamtime | Observe activity, summarize daily history, review during spare capacity | Later; privacy/cost boundaries first | Other Features; G09 |
| Recurring and long-running workflows | Recurring jobs, decomposed work, periodic summaries and apartment alerts | Later | Use-Cases; G07, G09 |
| Domain apps and extensions | Notes/Obsidian, CRM, finance/assets, use-case planner, drinks app, people research, social media assistance, spreadsheets, homepage, meeting notes, flashcards, autofill, crypto experiments | Exploratory; select individual journeys later | Use-Cases; G08–G10 |
| Personalization ideas | Proactive questions, changing personality glyph, talents/achievements, sharing adaptation concepts | Exploratory | Other Features; Use-Cases; Version Control + Sharing |

## First journey

Current delivery: [persisted chat and Artifact inspection](features/threads.md#scope), extended with [images and descriptions](features/images.md). [Topics and working context](features/topics-context.md) add manual membership, owned instruction editing and inspectable retrieval. [Implementation and verification](../docs/features/topics-context.md). [Implementation](../docs/features/threads.md) · [Test plan](../docs/plans/persisted-chat-tests.md).

Next direction, accepted 2026-10-12: usable self-modification through images, tools and Topics/context. [Inspectable tools and read-only filesystem access](features/tools.md) are implemented under the approved [test plan](../docs/plans/inspectable-tools-tests.md). The [delivery plan](../docs/plans/self-modification.md) records the sequence and acceptance targets, superseding the broad placement above for that path.
