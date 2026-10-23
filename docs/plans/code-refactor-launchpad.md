# Code refactor launchpad

Deferred, 2026-10-22 · Overview from the development-cycle audit · No refactor design or implementation authorized

Goal: reduce unrelated features editing the same coordination code. Start after Adapt and background-scene integrations settle, using their final boundaries. Testing infrastructure work is tracked in the [testing improvement plan](testing-improvements.md).

## Starting points

| Area | Evidence at `d43a883` | Candidate boundary to investigate |
| --- | --- | --- |
| `packages/client/src/renderer/features/threads/Chat.svelte` | About 68 KB; changed in 8 of the preceding 18 commits; owns drafts, recording, uploads, navigation, inspectors and polling | Composer/draft/recording coordination; inspector/navigation coordination |
| `packages/server/src/modules/threads/service.ts` | Accepts, retries, executes and cancels Runs alongside thread, routing and inspection operations | Separate cohesive lifecycle responsibilities while retaining transaction and lock ordering |
| Shared integration files | Committed Adapt and scene branches overlapped in 12 files, including Chat, thread contracts/services, server assembly and database setup | Explicit feature integration points where they remove repeated edits; retain necessary central schema/assembly ownership |

File size and overlap identify candidates, not a mandate to split every file. Reassess against current source; avoid a broad rewrite, generic plugin framework or formatting-only sweep during active integrations.

## Launch request for another chat

Review the starting points above against current `master`, read the relevant feature and design-system guidance, and propose the smallest behavior-preserving extraction that reduces shared-file edits. Trace state ownership, persistence, cancellation and recovery before selecting a boundary. Identify affected acceptance scenarios and the focused verification group from the testing work. Present a short recommendation and first extraction scope before implementation.

Success: a representative feature adjustment can stay within a cohesive module; responsibilities and state ownership are clearer; behavior, recovery and interaction coverage remain intact. Do not use line count alone as the success metric.
