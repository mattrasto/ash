# Permissions and Decisions delivery

Permissions, reviewed overrides and UI implemented, 2026-10-14 · Full verification required before integration

[Permissions spec](../../specs/features/permissions.md) · [Decisions spec](../../specs/features/decisions.md) · [Execution design](../features/decisions.md)

## Authoring changes

Implemented, 2026-10-21; verification required before integration. [PERM-R06 and P49–P50](../../specs/features/permissions.md#permission-behavior) own reconciliation and selection defaults.

The transient authoring batch proposes additions, changes and removals against current saved permissions. Review rejects equal-scope overrides, stale state and incoherent selected operations; atomic saving includes override rewiring. The registered authoring scenarios cover unchanged baselines, paraphrased equivalents, duplicate consolidation, reversible selection, failed saves and concurrent edits. Synthetic live checks require separate bounded authorization.

## Permission model

[Product spec](../../specs/features/permissions.md#permission-behavior) owns behavior; the [policy contract and migration](../features/permissions.md#persistence) own representation and compatibility. Current production adapters cover read-only filesystem access, Topic retrieval and attached-video analysis; controlled adapters verify future effect boundaries without enabling those effects.

| Verification boundary | Required checks | Acceptance |
| --- | --- | --- |
| Exact specificity | Canonical parent/child Ask and Never overridden by a narrower Allow; sibling paths, other verbs, equal-specificity conflicts and symlinks. | P06, P31 |
| Reviewed semantic authority | Linked and unlinked John permissions; independent external-work Never; a narrower permission overriding only its named restriction; multi-recipient and multiple-consequence actions. Exercise all remaining effects and uncertainty. | P32–P37 |
| Relationship writes | Missing/retired/self/equal/unrelated/cyclic references; incoming/outgoing impact on scope/effect edits; retirement cleanup and stale concurrent review. Use real PostgreSQL and prove failed writes activate no partial policy. | P38–P40 |
| Authoring quality | Natural language proposes explicit/semantic permissions without broadening conjunctions; represent exceptions as broad permissions plus linked narrower permissions instead of exclusion-heavy partitions; verify three-level outcomes, named exceptions over unknown group membership, baseline reuse and idempotent authoring; distinguish namesakes and missing company membership. Evaluate real authoring proposals as well as controlled transport errors; valid JSON alone is insufficient. | P01, P07, P22, P36, P38, P47 |
| Migration and history | Edited/retired defaults, partial operation grants, combined legacy conditions and retained exclusions; historical Decision/evaluation readers and a waiting approval spanning conversion. Confirm no additional capability becomes available. | P26, P42 |
| Complete UI meaning | Full qualified conditions and paths at 1400/1040/740 px and short windows; generously sized viewport-bounded Settings; per-suggestion top-right Access without Category; aligned override-table cells; keyboard/touch edit controls, both creation modes, linked-permission navigation, relationship impact review, failed Save and draft retention. | P39–P41; PERM-R15 |
| Execution regression | Existing Ask controls, immutable responses, sensitivity discovery, same-Run resumption, stop/cancel, current-policy checks and known/unknown retry outcomes. Use current filesystem tools and controlled future-effect adapters. | P04, P09, P18–P30; D01–D21 |

The registered scenarios below cover the new policy model and existing Decision continuation. Controlled authoring/evaluator transports establish boundary behavior; live semantic quality remains separate from these deterministic passes. No new connection/computer execution adapters are included.

## Implemented UI and defaults

Accepted, 2026-10-14: Decisions replaces the chat content area; Permissions lives in Settings. Keep the selected Thread, drafts and scroll position when navigating. Settings has Instructions and Permissions tabs; Permission categories are tabs, not standalone navigation buttons.

Composition: retain Ash's calm typography and colors, with a full main workspace and understated tab navigation. Content: Decisions header, Pending/Snoozed/History and requests; Settings header, feature tabs and the selected editor. Interaction: brief page entry, clear tab/hover states and keyboard focus; respect reduced motion.

Permissions uses a headerless list with inline access pickers, an add icon at the category tabs and a pencil revealed beside each name on hover/focus; the explicit form places Resource Type / Resource / Action on one row and Access below, with no separate Scope, Name pattern or interpretation step; authoring shows human-readable scope and conditions without a policy JSON editor. Decision requests keep concrete targets and arguments visible, with comments and snooze controls disclosed on demand. Follow Asha’s simple settings rows and restrained actions.

Defaults are recorded in [defaults.ts](../../packages/server/src/modules/permissions/defaults.ts): drafts and Computer use Allow; Send messages and Publish public content Ask. Seed once, preserve edits and removals, and rename only untouched previous send/publish defaults. Global filename globs and a semantic secret-value permission default to Never. Internal/generated folders are not permission blocks. Computer tools remain deferred.

Seed editable read-only access to the current Ash code checkout (`list`, `read`, `glob`, `search`). Explicit filesystem configuration can narrow it; editing or retiring its Permission must survive restart. Other directories require configured access.

## Stretch checks

| Boundary | Test |
| --- | --- |
| Navigation and drafts | Open full-page Decisions while a Thread waits; chat is hidden. Return by button, Escape and linked Thread; retain its draft and scroll. Settings remains reachable. Repeat at 1040 and 740 px and with keyboard-only tab navigation. |
| Settings ownership | Switch Instructions/Permissions with a dirty instruction or permission draft; Save/Discard/Keep editing affect only that editor. Require fresh suggestions after natural-language changes and a fresh relationship review after override changes; direct explicit Save validates without an interpretation step. Keep failed drafts intact. Describe has no shared Access input; test per-suggestion Access and selection, including one result. Access sits at the top right with no visible label; Category is absent. Override names, access and remove controls occupy distinct table cells, with no explanatory boilerplate. Unchecking keeps the draft and removes it from the save batch; removing an override does not discard the permission. Save chosen permissions atomically and reject invalid relationships without partial writes. Category views use tab semantics. Add stays outside the tablist; edit icons remain discoverable by keyboard and touch. Long paths wrap without widening the form. |
| Default permission persistence | Change Computer use through Allow/Ask/Never and reload. Rename untouched legacy defaults, preserving edited or retired permissions. Access changes report success or failure without displaying unsaved values. |
| Default code access | Read a known source file without `.ash-tools.json`; outside paths and mutation operations remain unavailable. Most-specific configured denial still wins. Changing the default to Ask/Never or retiring it persists through restart without reseeding. |
| Overlapping restrictions | Combine applicable Allow/Ask/Never and semantic false/unknown conditions. A named exception addresses only its listed restrictions; a newly added Never after approval still holds the action. |
| Action changes | Change the canonical target or parsed payload while waiting; preserve the old answer, cancel misleading unanswered requests and require fresh input for the new action. |
| Responses and attention | Race conflicting answers from two clients; retain one immutable answer. Ambiguous chat addresses neither question; Ask cannot be resolved by chat. Wake an elapsed snooze without approval. |
| Continuation and cancellation | Answer only one of two held steps; preserve completed siblings. Cancel before/after answer and during dispatch; no cancelled work revives. Restart around saved answers and first consumption. |
| Retry and evaluation | Reuse approval after confirmed no effect; hold unknown outcomes. Low-confidence, missing, malformed and failed Jev responses cannot grant permission. Oversized evaluation packets do not silently drop conditions. |

The `decisions-navigation-desktop` and `permissions-decisions-desktop` scenarios cover navigation and Settings. `permissions-defaults` covers the default catalog, legacy labels, computer access precedence and preservation of edits/removals; `permissions-default-code` covers default access and restart persistence; `permissions-decisions-stretch` covers overlapping restrictions, response races, expired snooze, ambiguous chat, changed targets and evaluator faults. Use controlled transports for faults; live classifier quality and new side-effect adapters remain separate evaluation work.

## Varied authoring cases

[Fixtures](../../tests/fixtures/permission-authoring.ts) own the complete prompts and expected outcomes, including the exact John/Amy prompt. Exercise controlled transport/enforcement plus bounded live authoring; JSON validity alone is insufficient.

| Case | Distinction to verify |
| --- | --- |
| CRM contacts | Keep saved Send Never; friends Ask; combined John/Amy Allow overrides both. Friend status true/false/unknown, unresolved identity, mixed recipients and independent work-file restrictions. |
| Calendar edits | Personal-calendar Allow replaces general Ask; recurring-event Never remains effective, including Personal. Unknown recurrence still holds. |
| Supplier purchases | A named supplier's small-purchase Allow overrides approved-supplier Ask without assuming membership; amount thresholds and other suppliers retain their limits. |
| Filesystem content | A deeper reference-folder Allow replaces parent Ask; independent personnel-content Never still blocks inside that folder. Uninspected content stays unresolved. |
| Publishing | A named release Allow overrides editorial Ask and general Never; independent customer-data Never survives. Other releases still require review or remain prohibited. |

Repeat the CRM live case to catch inconsistent clarifications or duplicate baselines. Review proposals without activating them, using only these synthetic fixtures in an isolated capped session. In integration, deliberately repeat baselines, remap proposed links, save atomically, evaluate outcomes and reauthor to confirm no duplicate writes. Accept combined or individual John/Amy permissions when effects and links are equivalent.

## Boundary integration

Use real PostgreSQL, filesystem handlers and Run execution with controlled model/evaluator transports. Register scenarios in `tests/scenarios.ts`.

| Scenario | Acceptance |
| --- | --- |
| `permissions-policy` | Explicit/semantic alternatives, default allowance, category exclusion, current-policy checks, Decision authority and evaluator failure handling; P01–P30. |
| `permissions-reviewed-overrides` | Path/app specificity, linked/unlinked recipient permissions, independent Never/Ask, multiple recipients, ambiguity, graph validation, stale review, effect/meaning impact and retirement cleanup; P31–P41. |
| `permissions-policy-migration` | Partial operations, qualified legacy policies, visible exclusions, retired boundaries, historical requests/evaluations and representation-only approval reuse; P26, P42. |
| `permissions-filesystem-authoring` | File/folder inference, missing paths, direct/recursive globs, global secret filenames, independent semantic secret restrictions, and prior default cleanup preserving edits; P44–P45. |
| `permissions-suggestions-desktop` | Per-entry Access, reversible selection, suggested override add/remove lists, omission of unchecked new targets, inactive proposals, atomic single/multiple selection saves and concurrent broader-permission impact; P46. |
| `permissions-form-desktop` | Two known resource types, one-row layout at 1040/740 px, wildcard round trip, direct Save and inferred file/folder scope without interpretation controls; P44. |
| `permissions-change-sets` | Existing-ID updates, universal paraphrase reconciliation, semantic equivalence rejection, unchanged baseline reuse, inactive proposals, duplicate consolidation with incoming/outgoing links, qualified nonduplicates and rejection of incomplete selected sets; P49–P50. |
| `permissions-changes-desktop` | Add/Change/Remove presentation, before/after access, removals checked by default, reversible selection, failed-save retention, removal-only batches, atomic consolidation, 1040/740 px layout and hidden non-focusable windows; P49–P50. |
| `permissions-authoring-priorities` | Varied fixture batches, baseline reuse across representations, unchanged saved timestamps, reference remapping, reviewed overlap priority, unknown memberships, independent restrictions, mixed recipients and idempotent reauthoring; P48. |
| `permissions-crm-desktop` | Exact CRM prompt, one combined named permission, linked friends/general overrides, unchanged baseline, no wording block, Permission terminology and already-saved empty results; P48. |
| `permissions-review-authoring` | Multiple inactive proposals, explicit/semantic discrimination, identity clarification, proposed-key hierarchy links, three-level Never/Ask/Allow outcomes and reviewed activation boundaries; PERM-R06, P47. |
| `permissions-traversal-boundaries` | Real filesystem search omits Never descendants; direct reads require named exceptions; P43. |
| `decisions-scheduling-wake` | A new waiting Run is answered while a prior scheduler snapshot is blocked by another Thread; the saved answer resumes automatically without another event; DEC-R10. |
| `decisions-chat-race` | An ordinary chat answer or Skip races with controls or cancellation; retain the winning resolution, dispatch the accepted Run once, deduplicate delivery and accept follow-up work. Unexpected interpretation failures remain observable without stranding committed Runs; DEC-R05, DEC-R11–12. |
| `decisions-response-retry-desktop` | Failed approval requests followed by Decline send Decline; unchanged retries retain their submission ID, changed text/comment and Skip send the current response with a new ID; DEC-R03, DEC-R12. |
| `permissions-save-navigation-desktop` | Delayed review and commit block close, Escape, tab changes and discard; failed Save-and-continue preserves the draft and restores controls, and subsequent discard creates no Permission; PERM-R15. |
| `engine-permission-decisions` | Incoming content retains external provenance, cannot answer an ordinary Decision or bypass Ask; explicit controls resume the same internal Run once while unrelated conversation remains usable. |
| `decisions-lifecycle` | Independent identity, duplicate/conflicting responses, immutable requests/answers, snooze/wake, chat addressing, Ask-control enforcement, cancellation and obsolete requests; D01–D12, D15–D21. |
| `decisions-resumption` | Ask holds real filesystem action, Thread accepts unrelated work, answer resumes automatically, backend restart before/after resolution, completed siblings retained, changed policy/action rechecked, no expiry, safe retries and unknown outcomes held; D06–D10, D13–D14, P26–P30. |
| `permissions-decisions-desktop`, `permissions-overrides-desktop` | Full-page navigation and Settings, ordinary/permission responses, both authoring modes, linked override review/navigation, invalid and stale reviews, complete long conditions, keyboard interaction, removal and reload. |

Mocked Jev transport checks the selected request/response contract and failure handling without external calls. Real evaluator quality remains established by the isolated experiments; these integration checks verify enforcement and continuation.

## Verification and demonstration

Run quick checks while iterating, then full `pnpm verify` on unchanged source. Review the diff separately and explore a disposable background app. The demonstration creates an ordinary question and an Ask-protected filesystem read, continues unrelated chat, restarts, answers and resumes after current checks. Include cancellation and a changed-permission case. Keep self-modification, new connector adapters and new side-effect tools in their existing deferred scope.
