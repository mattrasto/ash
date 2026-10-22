# Thread visibility and naming

Behavior accepted, 2026-10-21 · Artifact-free assessments and application history implemented · Synthetic scenarios and live-model judgment tracked separately

[Visibility source](../HUMAN_SPEC.md#visibility) (read-only) · [Threads](threads.md) · [Artifact rules](artifacts.md) · [Implementation](../../docs/features/thread-visibility.md)

## Goal

Keep relevant Threads available, archive matters when their usefulness passes, revive them when meaningful activity returns, and maintain recognizable names without undoing explicit user choices.

## Visibility recalculation flow

Accepted, 2026-10-14. Visibility and naming have independent schedules.

```text
Thread created?
  → Empty composer: indefinite visibility; no model call.
  → Has content: schedule assessment.

Meaningful new activity?
  • Accepted message or useful incoming item
  • Substantive work result or terminal outcome
  • Referenced image/video description becomes available
  → Invalidate the old deadline; schedule assessment.

Manual Unarchive (including Undo of Archive)?
  → Clear the old deadline; schedule assessment using the manual action as evidence.

Explicit “Recalculate”?
  → Schedule assessment.

Assessment scheduled?
  → Wait for active work to settle.
  → Combine changes: 10-second debounce,
    at most once per minute per Thread.
  → Assess relevant recent Thread items.
  → Choose immediate, a specific deadline, or indefinite.
  → Discard the result if newer activity made it stale;
    assess the pending activity on the same schedule.
```

Reading, pinning, renaming, polling, streaming chunks, duplicate delivery and deadline expiry do not trigger recalculation. Topic/instruction edits invalidate stale captures but apply at the next assessment without scheduling one themselves. Visibility's own writes never trigger another assessment. Draft edits do not trigger recalculation. Deadline enforcement checks drafts, pins, active/waiting work, unanswered Decisions and unread protection without model calls.

## Rules

- **VIS-R01 — Deadline:** each Thread has an assessed archive time, immediate archival, or an explicit indefinite result. Indefinite has no scheduled expiry; it is distinct from an assessment that has not run or failed. Deadlines are absolute instants, not durations restarted by polling or application restart. Archive retains the same identity, content, Topics, inspection, archive access and context eligibility under CONV-R14 and CTX-R03.
- **VIS-R02 — Assessment:** visibility and naming use separate assessments and schedules. Select context by Thread item count, not feature-specific token/character ceilings or hourly call quotas. Use current time/time zone, relevant Thread content, saved media descriptions, incoming provenance, work outcomes, current title and Topic names. Capture omissions. Apply dedicated global visibility and naming guidance; Topic routing and Thread response instructions retain their existing purposes. Source text and tool results are evidence, not authority. Assessments cannot call tools, change membership, authorize work or create Decisions.
- **VIS-R03 — Triggers:** follow the [visibility recalculation flow](#visibility-recalculation-flow). Work-in-progress guards apply immediately, independently of the delayed assessment.
- **VIS-R04 — Revival:** meaningful activity can revive either a manually or automatically archived Thread. Accepted user messages/retries, newly selected source entries and new response/work outcomes qualify; duplicates and routine progress do not. Internal-only substantive work also participates in reassessment and revival, but never fabricates a message or unread indicator. An event already reflected when Archive was clicked cannot undo that click; a later substantive outcome can. Reading an archived Thread alone does not revive it.
- **VIS-R05 — Manual controls:** Archive hides immediately without stopping work, clearing a pin or changing title ownership. Unarchive restores the Thread, clears the old deadline and schedules a fresh assessment. The model considers the manual action and its time as evidence of renewed interest, alongside the matter’s usefulness; there is no fixed manual grace period. The Thread stays visible until a current assessment succeeds. Undoing Archive follows the same rule; subsequent user Archive still acts immediately. New activity invalidates the old assessed deadline until a current assessment succeeds. Pinning supplies the manual indefinite-visibility override. These controls do not affect automatic naming.
- **VIS-R06 — Pinning:** pinning keeps an ordinarily visible Thread from automatically archiving. Pin/unpin never changes archive state by itself. Pinned Threads sort first within their existing Topic/unlinked/archive groups, then by activity and stable ID; no separate pin ordering interface. Unpinning uses the current assessed deadline and other guards. Manual Archive still works on a pinned Thread.
- **VIS-R07 — Work and unread:** automatic archival waits while the Thread has queued/running/waiting action work, unfinished routed intake or a linked pending/snoozed Decision. Waiting releases the execution slot so another message can be sent; it remains an archive hold. A quiescent waiting Thread may be assessed, but its deadline cannot archive it. Decisions and execution retain authorization, waiting, answer and resumption ownership. Waiting/resumption alone produces no settled-message count or unread marker; completion, failure, cancellation and interruption settle once. New selected source entries and settled visible response outcomes produce unread activity; internal-only work and naming/visibility assessments do not. Unseen activity has a 24-hour minimum visibility window from that activity. Afterward it may archive while retaining its unread marker and an unread count on the collapsed archive. Reading clears this minimum; it does not invoke a model. The effective archive time is the later of the assessed deadline and unread protection; reading removes only the unread minimum. The visibility panel shows that effective time and explains any delay. Immediate archival applies when these guards, drafts and pins are clear.
- **VIS-R08 — Reading and focus:** persist a monotonic seen-activity cursor for the single user. A client acknowledges only the visible activity actually rendered while its window and Thread are in view, not newer activity discovered by polling or content obscured by the Decisions page. A saved nonblank text draft, attachment, pending submission or recording prevents automatic archival until sent or cleared, including when another Thread is selected or the app restarts. Each client reports draft presence; any client’s draft holds the Thread. Draft contents remain local and do not enter assessment context. Editing a draft does not revive an archived Thread or change activity/read/message counters. Manual Archive still works and preserves the draft. Automatic archival never navigates away from an open Thread or clears its scroll position; show its archived state and keep archive access available. Manual archive retains UX02's existing selection behavior.
- **VIS-R09 — Names:** schedule automatic naming at Fibonacci message counts: 1, 2, 3, 5, 8, 13, 21 and so on, independently of visibility triggers. Count visible user/source messages on acceptance and Ash messages on settlement, once per Surface identity; internal Artifacts and streaming chunks do not count. Coalesce thresholds crossed during active work into one assessment of the latest state, and persist the threshold reached so restart does not repeat it. New manual composers remain “Untitled” until a name is assigned; message text and media filenames never become placeholder titles. A naming assessment may keep the current title; prefer a stable, concise name over wording churn. Manual Rename sets manual title ownership, even if its text matches the current title. Only an explicit Automatic name action restores model control and requests a fresh assessment. Naming never changes activity order, archive state or read state.
- **VIS-R10 — Failures and conflicts:** uncertain visibility, invalid output and unavailable providers do not establish an automatic archive deadline. A visible or newly revived Thread stays visible; a later manual Archive still takes precedence. Preserve the current title on naming failure. A stale deadline cannot hide newly active work. Apply results only against the captured activity, manual-control and context revisions; discard stale results and coalesce the latest pending work under the appropriate schedule. Persist request, public outcome, application/discard status and safe failure evidence for inspection. Do not automatically retry a failed/ambiguous provider attempt. A new qualifying trigger or explicit Recalculate can request a new assessment.
- **VIS-R11 — Restart:** resume enforcement of saved deadlines without provider calls. Interrupted assessments remain inspectable and require new activity or explicit Recalculate; startup and restoration never replay them. Settled names, overrides, pins, archive state and read cursors survive restart. Existing execution recovery remains authoritative for Run/intake outcomes.
- **VIS-R12 — Existing data and undo:** preserve existing titles as manual because their origin is unknown. Preserve existing archive/pin state; existing visible Threads start indefinite until new activity or explicit Recalculate. Migration does not mass-archive Threads or call a provider. Offer session Undo for manual title, archive, pin and automation changes using revision checks; a newer conflicting change rejects the reversal. Broader application-edit history remains deferred under ART-R10.
- **VIS-R13 — Application history and inspection:** visibility and naming create no Artifacts, including for model calls, controls, archive/revival or title changes. Retain exact model requests before dispatch and terminal output, usage, reason and application status in independent assessment records. Retain accepted manual commands and actual archive, title, pin and naming-mode changes in application history, atomically with current-state updates. Display archive/unarchive/rename transitions as quiet timestamped notices; pin and ownership changes remain inspectable history. Transport retries produce no duplicate records; unchanged values produce no transition notice. The initial naming notice displays only the new name; later rename notices include old and new names. Exact changes remain inspectable. Notices survive reload/restart and do not count toward Fibonacci naming, produce unread activity, reorder Threads, dispatch work or trigger assessments. Include recent application changes when assessing visibility; ordinary response/retrieval context excludes them. Existing conversation Artifacts may be read or referenced as evidence without extending their chains. Current rows remain authoritative. Migrate this slice's previously recorded captures/notices into independent storage without inference; do not invent older history. This refines the source's blanket rule that every visible Thread entry is a Surface Artifact.

## Acceptance criteria

| ID | Synthetic scenario | Required result |
| --- | --- | --- |
| VIS01 | Create an empty composer; complete a one-off answer; process a time-bound event and an ongoing project. | No empty-composer provider call. One-off/event assessments set useful finite deadlines; ongoing work can be indefinite. Due eligible Threads archive once. |
| VIS02 | Assess an internal-only matter as immediate; assess an unseen source entry as immediate. | Internal-only matter can archive as soon as work settles. Unseen entry receives VIS-R07's minimum; opening it clears that guard. Neither case loses archive access. |
| VIS03 | Send into manually and automatically archived Threads; deliver a useful source update; finish substantive internal work. | Each qualifying new activity can revive the same Thread. Read-only access, duplicate receipt and stream chunks do not. Internal work adds no unread marker. |
| VIS04 | Archive while work runs, then deliver old progress and a new terminal outcome. | Archive is immediate and work continues. Old progress cannot reverse Archive; the new substantive outcome can revive. Automatic archival never hides active/waiting work or unanswered/snoozed Decisions; waiting still allows another message. |
| VIS05 | Pin, archive, restart, unarchive and unpin. | Independent state persists, ordering is stable across Topic groups, manual Archive works, and automatic deadlines respect pins; Unarchive invalidates the old deadline and reassesses recent manual activity without a fixed hold. |
| VIS06 | Advance through Fibonacci and intervening message counts; trigger visibility through internal work; manually rename during a naming assessment, then enable Automatic name. | Naming runs only when due or explicitly restored, independently of visibility; it may keep a good title. Late assessment cannot overwrite the manual title. Explicit opt-in restores automatic naming. |
| VIS07 | Receive source-only, response-only, failed-visible and internal-only outcomes while another Thread is selected. | Correct work/unread indicators; no false unread from internal/metadata work. Seen acknowledgments cannot clear a later unseen event. Archived unread remains discoverable. |
| VIS08 | Burst inputs and tool results; poll and inspect repeatedly; exceed the selected context item count. | Coalesced visibility calls follow VIS-R03. Context uses the selected items with omissions recorded; no feature hourly/token cap. Idle/poll/inspection/deadline enforcement uses zero calls. |
| VIS09 | Change activity, title, pin, archive or relevant context while a delayed model result is in flight. | Stale result does not overwrite current state. Manual transport retries and Undo cannot overwrite later edits. New activity cannot be archived by an older deadline. |
| VIS10 | Fail assessment, stop before/after dispatch, restart after a deadline and deliver late output. | Failure/interruption evidence retained; no automatic provider replay or duplicate application. Current saved deadlines enforce safely; late output is rejected. |
| VIS11 | Archive a Topic-linked Thread, retrieve its content, then inspect old requests after editing visibility guidance. | Same retrieval eligibility and immutable historical captures; no new authorization, waits, Runs or messages created by inspection. |
| VIS12 | Migrate populated data and exercise archive/revival in the desktop with drafts, scrolling and multiple Topic appearances. | Conservative migration with zero provider calls; saved text/attachment drafts hold automatic archival across switches and restarts; clearing them releases an already-due deadline without inference; no stolen focus; keyboard controls and both supported window sizes remain usable. |
| VIS13 | Archive/unarchive, rename manually/automatically, Undo and retry commands; reload and inspect history. | One durable notice per actual archive/name transition with correct names/cause; pin/ownership history is inspectable. Assessments, controls, transitions and migration create zero Artifacts; captures and history remain immutable and inspection makes no provider calls. No message-count, unread, work or inference feedback loops. |

## Accepted starting choices

Use the generative model directly, with separate visibility and naming requests. Manual Unarchive uses dynamic assessment under VIS-R05; unread activity retains VIS-R07’s 24-hour protection. Start with 20 recent items, plus the triggering item and saved evidence behind a previous finite deadline; record omissions. Tune this window using observed quality and cost rather than adding feature call/token quotas.
