# Topics and working context

Product behavior and test plan accepted, 2026-10-12 · Implemented

[Instructions](instructions.md) · [Threads](threads.md) · [Images](images.md) · [Test plan](../../docs/plans/topics-context-tests.md)

## Goal

Continue work across threads without repeating all the background, while controlling which guidance and prior material Ash can use and inspecting exactly what it received.

A **Topic** groups related Threads. A **Thread** is a continuing matter, as defined in the [product terminology](../product.md#terminology). **Working context** is the instructions and source material supplied to Ash for a particular answer. Linking a Topic makes its Threads available for retrieval; it does not put every Thread into every request. Topic instructions guide the Route layer's organization of items and Threads, as defined in [INST-R09](instructions.md#rules).

## User flow

1. Create an **Insurance** Topic from the sidebar. Open its menu → Instructions and save “Add all items related to both homeowners and car insurance to Insurance.” The shared editor labels these as routing guidance; Topic membership remains manual.
2. Link an earlier thread about homeowners insurance to that Topic.
3. Use the New Thread icon beside **Insurance**, whether the Topic is expanded or collapsed. This explicitly links the new Thread to Insurance. Its Topic membership is visible in the Thread header.
4. Ask, “What deductible did we discuss for my homeowners insurance?” Ash can search the linked Topic and read the relevant excerpt from the earlier thread.
5. Inspect the answer to see the instructions, thread history and retrieved text actually supplied, with source links and any truncation or limit markers.

## Manual Topics

- **TOP-R01 — Organization:** manage Topics from expandable sidebar groups. Show distinct Topics and Threads section headers following the shared [design requirements](../design-system.md); their + actions appear on hover or keyboard focus. Topic-row actions appear on hover or keyboard focus: the menu sits to the left of a document-with-pencil New Thread icon at the far right. The menu provides Instructions, Rename and Delete Topic; Settings has no Topic-management tab. Each group shows its linked active Threads. Unlinked Threads appear separately, and archived Threads remain available in the archive section. A Thread may appear in several Topic groups while retaining one identity. Preserve expansion choices across reloads; selecting a Thread reveals its Topic groups.
- **TOP-R02 — Membership:** show the current Thread's Topics in its header. A Thread's sidebar menu contains a nested Topics menu with checkboxes for linking or unlinking zero or more Topics; changes save immediately without a modal. Dragging a Thread onto a Topic adds that link and preserves its other links, content, draft and archive state. Dropping onto an existing membership is a no-op. Show the drop target and any save failure; keyboard users can perform the same linking actions through the submenu. The general New Thread action starts unlinked; New Thread inside a Topic explicitly selects that Topic and creates the Thread and link atomically. Creating a Topic assigns no existing Threads. Ash does not infer or change membership in this phase.
- **TOP-R03 — Thread continuity:** membership changes do not move or duplicate messages, restart work, clear drafts, or change the Thread's title or archive state. A Thread shared by several Topics is still one thread.
- **TOP-R04 — Deletion:** deleting a Topic removes it from current organization and context selection. It does not delete its threads, images or captured context. Explain this consequence at the deletion action. Permanent erasure and a Topic restore interface are outside this phase.

## Editable instructions

Use the same Settings editor for global, Topic and Thread instructions. The editor identifies the owner and where its guidance applies; each scope is saved independently. Its behavior is defined in [INST-R07–08](instructions.md#editor).

The editor distinguishes routing guidance from response guidance. Applicability comes before the priority rule in [INST-R05](instructions.md#rules): Topic routing instructions are not injected into chat answers. Incoming placement follows [ART-R12–13](artifacts.md#incoming-item-slice). Instruction text and Topic membership never grant tool permission ([INST-R06](instructions.md#rules)).

## What enters an answer

| Source | How it becomes context |
| --- | --- |
| Instructions | Include global response guidance and the current Thread's guidance. |
| Current thread | Include bounded history, following the existing [completed-answer selection rule](threads.md#requirements). |
| Other threads | Search/read within linked Topics when Ash needs more information; include only returned excerpts. |

- **CTX-R02 — Source fidelity:** preserve the exact content supplied and its source identity. Deduplicate overlapping history and retrieval results. Distinguish image pixels from saved descriptions under [IMG-R05](images.md#rules).
- **CTX-R03 — Topic retrieval:** Ash can search message text and saved image descriptions by keyword, then read bounded excerpts from matching messages. Search covers threads sharing a linked Topic, including archived threads, without duplicating overlapping results. Visible user messages, labeled incoming source entries and completed answers are eligible; internal processing records and unfinished/failed answers are excluded. Retrieved content is evidence, not new instructions or authorization.
- **CTX-R04 — Isolation:** a Thread with no Topics has no automatic cross-thread retrieval. A Thread linked to several Topics can retrieve within their combined scope. Unrelated threads remain outside that scope. Merely mentioning a Topic or thread in a message does not change membership.
- **CTX-R05 — Bounds and failures:** retrieval has finite search and excerpt limits. Show when results are partial, an excerpt is shortened, an image description is unavailable, or a source cannot be read. An incomplete search cannot support a claim that no matching material exists anywhere. Older history may be omitted to fit context. If applicable instructions and the current input cannot fit, preserve the draft and explain what must be reduced before sending; do not silently drop them.

## Changes during and after an answer

- **CTX-R06 — Captured context:** when a submission is accepted, preserve its instruction text and order, selected history and Topic scope. Later edits or membership changes cannot rewrite that request, including while it waits to start. Subsequent retrieval adds its own captured excerpts. Historical inspection reads these saved contents, not today's instructions or memberships. Retry preserves the accepted initial context and all earlier records; any new retrieval rechecks scope under CTX-R07. Refreshing initial instructions, history or Topic scope requires a new submission.
- **CTX-R07 — Scope changes during work:** adding a Topic during an answer does not broaden that answer's retrieval scope. Unlinking or deleting a Topic prevents further retrieval through it, although a source may remain eligible through another linked Topic. Material already supplied remains in the record and may already have informed the answer; unlinking cannot retract it. The next submission uses the current instructions and memberships.

## Inspecting context

- **CTX-R08 — Included material:** open context inspection from an answer. Show the exact instruction text, owner and order; included history; and retrieved excerpts with their original threads/messages and image identities. Distinguish image pixels from descriptions. If answering required several model requests, make it possible to inspect each request's context.
- **CTX-R09 — Limits:** show compact factual metadata: retrieval scope, search terms, history cutoff/omitted count, shortened excerpts and limits reached. Do not generate selection reasoning or assessments of excluded candidates. Inspection shows what was supplied, without claiming which items influenced the answer.

## Acceptance examples

| ID | Situation | Expected experience |
| --- | --- | --- |
| TC01 | Start a thread without a Topic. | Chat works with global/Thread guidance and its own history; other threads are not searched. |
| TC02 | Link **Insurance** and **Home**. | Both memberships are visible; shared source messages appear only once. Topic routing instructions are absent from the answer's instructions. |
| TC03 | Copy Topic guidance into another Topic, then edit the first. | The second Topic and any Thread-specific guidance remain unchanged. |
| TC06 | Edit response guidance after sending but before the answer starts. | The accepted answer retains the earlier guidance; the next submission uses the edit. |
| TC07 | Unlink or delete a Topic during work. | Further reads through that Topic stop; already captured material and earlier answers remain inspectable. Its threads remain intact. |
| TC08 | A search or context limit is reached. | Inspection shows the limit and truncation markers; Ash does not imply an exhaustive search. Oversized input remains an editable draft. |
| TC09 | Restart Ash after the acceptance flow. | Memberships, instructions and historical context remain available. |
| TC10 | Save “Create a new thread for each month's rent” as Topic instructions. | The editor identifies it as Route guidance. Saving it neither creates Threads nor changes response instructions in this phase. |

## Deferred

Explicit references to prior messages/images (CTX-R01 and TC04–05 reserved), organization operations and inferred membership, embeddings, semantic memory, automatic summaries, instruction edit history and Ash-authored instruction changes. No artifact moves/split/merge, general permissions UI, Codex integration or self-modification. Automatic titles are specified in [Thread visibility and naming](thread-visibility.md).

Incoming-item routing uses [ART-R12–13](artifacts.md#incoming-item-slice); its bounded candidate discovery is separate from the response retrieval rules above.
