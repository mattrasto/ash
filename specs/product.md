# Product principles and terminology

Source: [HUMAN_SPEC.md](HUMAN_SPEC.md) and the user’s development agreement.

## Confirmed product intent

Ash is a private personal agent: part companion, helper and second brain. It should be capable, concise, helpful and honest, with deep personal context and a carefully crafted, simple architecture.

- **Distinct identity:** Ash is not the user. The overview prohibits publishing writing or sending messages as the user; the scope of possible exceptions needs clarification before those capabilities exist (G08).
- **Cross-device presence:** desktop, mobile and suitable wearables; input/output and behavior adapt to the device. Desktop is described as voice-first and the main work surface.
- **Background capability:** Ash can continue work in the background. The overview also requests computer/browser work while the user's computer is off; deployment and local-device limitations remain open (G02).
- **User control:** topic/thread guidance is editable and organizational automation is suggested by default. Statements implying automatic initial organization conflict with this default (G04).
- **Traceability:** visible results lead back to inputs and recorded processing. Captured requests preserve what informed execution. Storage, recovery and deferred application history follow [ART-R08–10](features/artifacts.md#rules).
- **Private access:** others cannot interact with the user's Ash. This does not yet specify hosting, model-provider data handling, observation consent or retention (G02, G06, G09).
- **Adaptability:** Ash can improve instructions, build custom apps and eventually modify its code. Instruction changes by Ash require an explicit Decision. Other self-modification boundaries need definition (G10).

## Terminology

| Term | Meaning / boundary |
| --- | --- |
| Topic | A semantic category used for both organization and context. A thread may link to zero or more topics. |
| Thread | A continuing matter containing an ordered presentation of artifacts. Its UI sequence is not the processing history of a single input. |
| Artifact | An input or record produced by an Artifact Engine layer. See the accepted [artifact rules](features/artifacts.md); manual application edits do not require Artifacts. |
| Input Artifact | The recorded origin of an input, including a user message or an external event. |
| Act Artifact | A record of an action taken by Ash, such as generating a response or calling a tool. |
| Surface Artifact | An artifact representing content selected for user presentation. Internal records are not automatically visible messages. |
| Reference Artifact | An entry pointing to another artifact so it can be visible in a different thread without duplicating ownership. |
| Artifact Chain | Source relationships from an input through processing to resulting artifacts; see ART-R07 for the single-source rule. This is not thread order. |
| Artifact Log | Recorded Artifact Engine activity, stored as Artifacts. |
| Instruction | An editable document owned by one Topic, Thread or global engine slot, using a common shape for the editor; see the accepted [instruction rules](features/instructions.md). |
| Run | An Act workflow execution with inputs, status, a persisted checkpoint and resulting Artifacts; initially one response. See the [Run boundary](../docs/data-model.md#run-boundary). A retry is a new Run linked to the previous one. Durable waiting/resumption remains future scope. Not a task-list item. |
| Task | A user-visible item of work, assigned to the user, Ash or neither. Exists independently of threads and can link to them. |
| Decision | A request for user input, including but not limited to permission. The overview's candidate table “Approvals” does not establish a separate product concept. |
| Permission | A rule controlling access or action, with always/ask/never settings. A Decision can request permission; the two are not interchangeable. |
| Notification | An Ash-created item drawing attention to information or work; distinct from its eventual delivery on a device. |
| Live Thread | A special thread recording a Live Mode interaction; cannot be typed into or converted into a normal thread. Can be resumed and referenced from other threads. |
| Context | Information supplied to Ash for a particular action, from instructions, conversation and relevant other sources. |
| Memory | Durable semantic information about facts/preferences; distinguished from conversation history and explicit instructions. Details remain open. |
| Archive | Hide a thread from the ordinary view while retaining it for archive access and context. Not deletion or erasure. |
| App | A built-in or custom interactive surface with versioned content. Custom apps have separate data and version-control boundaries. |
| Ash / Asha | Ash is this product and a separate codebase. Asha is the adjacent reference project. The user confirmed separation on 2026-10-09; see [Decision 0001](../docs/decisions/0001-separate-codebase.md). |

Use “task” for product work items and “run” for execution. Use “Decision” for required user input; reserve “approval” for an affirmative permission response unless the product model is refined.

## Confirmed engineering agreement

The user owns intent, priorities, experience and consequential tradeoffs. Codex recommends technical choices and handles routine reversible implementation and testing. Surface changes to scope, behavior, privacy, recurring costs or production risk.

Deliver through acceptance criteria → small complete journey → automated checks and actual app interaction → a separate review pass → demonstration → documentation update. State what works, what was verified and what remains limited. Consider experienced human review before a consequential public launch.

Keep one initial backend and one core database, organized by feature. Share contracts only where actually shared. The bootstrap uses TypeScript, Svelte, Electron, Node/Fastify and PostgreSQL; Prisma owns the product schema and migrations.

Use DBML in Git and dbdiagram for table boxes showing all columns and foreign-key connections with minimal notation. Begin with ownership, relationships and deletion semantics. Follow the [Prisma/diagram synchronization workflow](../docs/architecture.md#schema-workflow). The accepted [data model](../docs/data-model.md) records initial scope and subsequent feature extensions.

Use plural snake_case table names and snake_case columns in SQL; camelCase properties and UpperCamelCase types in TypeScript.

Establish reproducible startup, synthetic but realistic sample data, a reset command restricted to isolated development data, automated checks and recoverable Git checkpoints early.

Testing centers on boundary integration, real-app functionality/UX/visual checks and targeted human acceptance. No routine unit-test requirement; retain focused invariants where useful. The accepted [testing approach](../docs/testing.md) defines execution, evidence and future self-modification verification. Reports are for agents; human handoff stays concise.
