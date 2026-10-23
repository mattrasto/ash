# Decisions

Product rules and table structure accepted · Implemented for current tool workflows, 2026-10-14 · [Verification](../../docs/plans/permissions-decisions-tests.md)

[Source](../HUMAN_SPEC.md#decisions) · [Permissions](permissions.md) · [Engineering design](../../docs/features/decisions.md)

## Goal

Give the user one durable place for input Ash needs: permission, a choice, clarification or a response to a proposal. A Decision exists independently of a Thread and may link to the conversation or work that needs its answer.

## Responsibilities

Decisions owns requests, presentation, responses, snooze and resolution. [Permissions](permissions.md) owns rules and whether an action is authorized. The requesting feature owns the meaning of an answer and any work that follows. A Decision can request permission, but ordinary questions do not require permission evaluation just to collect an answer.

The first design covers these general responsibilities and their shared handoff. Instruction edits, code changes and other particular workflows are later consumers. Notifications may draw attention to a Decision; notification delivery is a separate feature.

## Flow

1. Ash needs input, such as “Which of these two folders should I use?” It creates a Decision with the question, relevant context and supported responses. Work that depends on the answer identifies that dependency.
2. The Decision appears in the independent page and, when linked, in its Thread. Both views show the same request and response state.
3. The user answers, chooses an option, declines a proposal or snoozes it. Optional comments travel with the response.
4. Save a valid response before reporting it as received. The requesting feature checks whether it still addresses the current need and continues eligible work. Show the answer separately from any resulting execution outcome.
5. Reopening or restarting restores the saved request and answer. Continuing dependent work follows the [continuation contract](#continuation); displaying a Decision does not itself start work.

## Rules

- **DEC-R01 — Independent identity:** each Decision has a stable identity and can exist without a Thread or active Run. Linked list and Thread views refer to that record. Every required user question appears here; an optional conversational invitation need not create an item.
- **DEC-R02 — Reviewable request:** show what input is needed, why, relevant context and what answering will do. Preserve the request and options the user saw. Permission requests include the concrete action, scope and findings supplied through the [Permissions handoff](permissions.md#decision-handoff).
- **DEC-R03 — Responses:** support a choice, a text answer, and approval/decline as response forms. Options have stable meanings even if their display labels differ. Permission confirmation must use the Decision's approval controls under [PERM-R11](permissions.md#permission-behavior); text answers and comments cannot substitute for that response. Validate a response against its request; duplicate delivery returns the saved result, while a conflicting second answer is rejected under DEC-R12.
- **DEC-R04 — Persistence:** requests, snooze deadlines and responses survive client disconnection and backend restart. Saving a response does not depend on the requesting worker remaining connected. Restart and elapsed time never answer a Decision on the user's behalf.
- **DEC-R05 — Dependent work:** record which work needs the answer, without making execution part of the Decision's own lifecycle. Only dependent work pauses; the same Thread remains usable for unrelated conversation and work. Unrelated messages do not answer or cancel the pending Decision. Prevent duplicate consumption of the same response by the same dependent step. Execution and retry safety remain the requesting feature's responsibility.
- **DEC-R06 — Inspection:** retain the question, options, relevant source links, response/comment, timestamps and resolution reason. Link to dependent work and its current outcome when present. Permission evidence follows [PERM-R13](permissions.md#permission-behavior). Do not retain credentials or private model reasoning.
- **DEC-R07 — Snooze and dismissal:** snooze postpones attention until a saved time; it supplies no answer or authorization. Snoozed items remain accessible. Closing a view or dismissing a notification does not resolve the Decision. At the deadline an unanswered, relevant item becomes pending again; it does not automatically execute work.
- **DEC-R08 — Page and Thread presentation:** revised 2026-10-22. The **Decisions page**, opened by the button at the top left above Topics, replaces the chat content area. Keep the sidebar available and preserve the selected Thread, chat draft and scroll position when returning. Settings remains reachable from this page. It works independently of the selected Thread and contains Pending, Snoozed and History tabs, with question, reason, age and linked work where relevant. Keep comments and snooze controls in optional disclosures. Show permission targets and material arguments with readable labels; keep technical action JSON out of the request UI. A Thread shows a compact linked request and its saved response at the request's creation time in the transcript; answering does not pin or move it below newer messages. Distinguish “Answered” or “Approved” from “Work completed,” “Blocked” or “Failed.” Time-sensitive requests can carry a deadline; the consequence of missing it must be explicit rather than inferred.
- **DEC-R09 — Changed or unnecessary requests:** preserve answered requests. If a material change makes an unanswered request misleading, cancel it with an explanation and create a new independent Decision only if input is still needed. Reject responses to the cancelled request; they cannot answer a new one. Also cancel unanswered requests whose input is no longer needed. Cancellation does not mean the user declined, and there is no replacement relationship between Decisions.
- **DEC-R10 — Automatic resumption:** after saving a valid response, automatically resume eligible dependent work once current checks pass; no separate Resume action is required. Continue according to the response from saved progress under the continuation contract below.
- **DEC-R11 — Chat answers:** a clear chat reply resolves an ordinary Decision when both the intended Decision and the answer are unambiguous. Save the answer with its source message. If meaning or target is ambiguous, clarify before resolution. Permission approvals remain restricted to explicit Decision controls under PERM-R11; chat cannot supply that confirmation.
- **DEC-R12 — Immutable answers:** once saved, an answer and its comment cannot be edited, withdrawn or overridden, even before dependent work uses it. Treat corrections as new instructions; create a new Decision only if those instructions require new input. Do not reset an answered Decision to Pending, replace its answer or imply that prior effects were undone. This applies to ordinary answers and permission approvals alike and supersedes the earlier amendment and approval-withdrawal behavior.
- **DEC-R13 — Cancelled dependent work:** cancelling work stops further dispatch; for execution already underway, attempt cancellation where supported and report whether it succeeded, was too late or remains unknown. Cancellation does not rewrite a saved answer. Automatically cancel pending or snoozed Decisions if that work was their only remaining purpose, retaining them in History. Keep a Decision open if other work or an independent question still needs its answer. Answering a retained Decision never revives cancelled work.

## Lifecycle

| State | Meaning | Exit |
| --- | --- | --- |
| Pending | Relevant input is still needed. | Respond, snooze or cancel. |
| Snoozed | Unanswered, with attention deferred. | Respond, wake manually/at the deadline or cancel. |
| Resolved | A valid response was saved, including declining a proposal. | Terminal; retain the immutable request and answer. |
| Cancelled | The unanswered request is no longer relevant, including because its substance changed. | Terminal; create a new independent request if input is needed. |

“Approved” and “Declined” describe responses to permission/proposal requests, not states imposed on every kind of Decision. Execution outcomes belong to the linked work. The request's supported responses determine how a user declines to answer an ordinary question; that is distinct from cancelling an unnecessary request.

## Continuation

Execution contract under DEC-R04–05 and R10:

- Persist the dependency before suspending work. Human waiting is not an active model call or a tool timeout.
- After an answer, validate the saved request and current work before continuation. For permission, follow [PERM-R11–12](permissions.md#permission-behavior): reevaluate the current concrete action using the response; the Decision service never dispatches it directly.
- Resume from a known checkpoint, preserving completed steps. Do not regenerate the original proposal merely to recover its answer, or blindly repeat an action whose outcome is unknown.
- Apply DEC-R13 when cancelling dependent work; coordinate cancellation with response saving and continuation.
- Database restore follows [CONV-R13](threads.md#requirements), including no automatic dispatch of restored work. Ordinary restart support does not change that rule.

Scheduling resumed work alongside newer work remains part of the [execution design](../../docs/features/decisions.md#existing-run-changes). Approval lifetime and retries follow [PERM-R23 and R25](permissions.md#permission-behavior); current Run consumption follows the [execution contract](../../docs/features/permissions.md#approval-data-on-decisions). Known Decision waits resume from their checkpoints; interrupted active calls follow the execution design.

## Acceptance examples

Acceptance targets for the rules above; automated coverage is mapped in the [test plan](../../docs/plans/permissions-decisions-tests.md#boundary-integration). Tool examples describe the integration contract, not new tool capabilities.

| ID | Example | Expected result |
| --- | --- | --- |
| D01 | Ash needs the user to choose between two folders. | Create a choice Decision without an approval requirement. The answer selects a target; accessing it still follows Permissions. |
| D02 | Restart with unanswered and snoozed Decisions, including one without a Thread. | Restore their identities, context and deadlines without answering them or creating duplicates. |
| D03 | Approve a concrete action that needs permission. | Save approval, reevaluate through Permissions and show subsequent work separately. No standing rule is created implicitly. |
| D04 | Decline a permission request, then redeliver the response. | Retain one declined response and do not execute the declined action. |
| D05 | Change the requested target or available options before the answer arrives. | Cancel the old request with the reason, retain it in History and create a new independent Decision only if input is still needed. Reject a stale answer to the cancelled request. |
| D06 | Two clients answer, or a crash occurs after saving a response but before its consumer sees it. | Save one resolution; duplicate delivery does not repeat consumption. Recover the answer without blind replay of downstream effects. |
| D07 | Approve an action, but its permissions or material facts change before dispatch. | The response remains visible; current evaluation determines whether work may proceed. Approval does not guarantee execution. |
| D08 | Ask a required free-text question with no pending tool action. | Accept and retain an answer; no permission rule or fictitious approval is needed. |
| D09 | Snooze a permission request or close its view. | Keep the action held. Waking or reopening shows the same request without granting authority. |
| D10 | Cancel dependent work, then answer an earlier Decision. | Do not restart the cancelled work; explain the response's current relevance. |
| D11 | Open Decisions using the button above Topics, then switch Threads. | The dedicated page remains a view of the same independent Decisions; linked Thread views do not create copies. |
| D12 | An Ask permission is pending and the user writes “yes, do it” in chat. | Keep it pending until the user confirms through its approval controls. A qualification that materially changes the action follows DEC-R09; it cannot approve the existing action. |
| D13 | Answer a Decision while dependent work is waiting and current checks pass. | Automatically continue eligible work according to the saved response, without a Resume click. Preserve completed steps and show the resulting work separately from the answer. |
| D14 | Work in a Thread waits on a pending or snoozed Decision, then the user submits an unrelated request in that Thread. | Accept the request and allow unrelated conversation and work to continue. Keep dependent work paused and preserve the existing Decision without answering or cancelling it. |
| D15 | A pending ordinary Decision asks which folder to use; the user clearly replies “Use folder B” in chat. | Save the choice against that Decision with the source message and resume eligible work under DEC-R10. |
| D16 | A chat reply could answer more than one pending Decision, or its meaning is unclear. | Ask for clarification and leave the affected Decisions unresolved until the intended answer and target are clear. |
| D17 | The user answers folder A, then says “Use folder B instead” before dependent work uses the answer. | Keep A as the saved answer and handle the correction as a new instruction. Any change to pending work belongs to that instruction, not an answer edit. |
| D18 | The user corrects an ordinary answer after dependent work has started using it. | Keep the saved answer intact and treat the correction as a new instruction. Do not imply that earlier effects were undone. |
| D19 | A stale client submits a different answer to an already resolved Decision. | Reject the conflicting submission and show the saved answer. Identical delivery retries return that answer without starting work again. |
| D20 | Cancel the only work that needs an unanswered Decision. | Cancel the Decision automatically, retain it in History and reject stale attempts to answer it. |
| D21 | Cancel one workflow while another workflow or an independent question still needs the same Decision. | Keep the Decision open. Its later answer can resume eligible remaining work but never the cancelled workflow. |

## Open decisions

The routine defaults below are adopted for this implementation; voice and notifications remain future scope. Private-data handling and retention/erasure policy belong to the separate security/privacy design under G06/G09.

- **DEC-Q01 — Response addressing:** chat answers and ambiguity are settled by DEC-R11; response forms and permission confirmation follow DEC-R03. **Default:** when voice input is added, apply the same ordinary-answer rules to an unambiguous transcript. A qualified reply that materially changes the request follows DEC-R09; do not discard its qualifications to fit an existing choice. A button's text cannot define arbitrary executable behavior.
- **DEC-Q02 — Continuation (resolved):** settled by DEC-R10. Current Run consumption follows the [execution contract](../../docs/features/permissions.md#approval-data-on-decisions).
- **DEC-Q03 — Conversation while waiting (resolved):** settled by DEC-R05.
- **DEC-Q04 — Resolution and cancellation:** immutable answers and cancelled work follow DEC-R12–13. **Default:** offer “Skip” for ordinary questions; record it as a response, explain which dependent work cannot continue, and do not repeatedly recreate the same skipped question without a changed need.
- **DEC-Q05 — Attention and history:** page placement is accepted under DEC-R08. **Defaults:** show the unsnoozed pending count at the Decisions button; order pending items by explicit approaching deadline, then oldest first; order History newest first. Offer snooze for one hour, tomorrow or a chosen time. Deadlines follow the request's stated consequences and never imply approval. Keep resolved/cancelled items in History; storage duration and erasure belong to the separate security/privacy design under G06/G09. Device notifications remain deferred.
