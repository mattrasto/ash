# Thread visibility merge plan

Integration authorized, 2026-10-21. Candidate rebased onto `master` / `origin/master` at `c74fa0d`; the gates below are required before fast-forward. Feature: `codex/thread-visibility`; original merge base: `d0549ad`. Recheck refs before integration.

## Prepare the candidate

1. Finish the review fixes and regression checks in this worktree, review the diff, and save a recoverable checkpoint. Preserve the current preview database, files, local configuration and live-session identity.
2. After integration is requested, create a local recovery ref for the feature tip. Squash the feature commits since the merge base into one commit, then rebase that commit onto current `master`, following [Git integration](../development.md#git-integration). The feature currently has no remote tracking ref; recheck before rewriting anything published.
3. Resolve the combined behavior below and fold integration fixes into the single feature commit. Keep `master` unchanged until the candidate passes its gates.

The primary checkout has an unrelated `.npmrc` newline change. Its exact bytes are backed up and must remain unchanged; it does not overlap this feature.

## Conflict resolution

Resolved text conflicts in `Chat.svelte`, `Sidebar.svelte`, server `main.ts`, Thread service, shared Thread contracts, `model.dbml`, instruction specs, schema-test helpers and the scenario inventory. Both chat screenshot baselines were regenerated and visually reviewed. The combined DBML rendered in dbdiagram.io without parser errors.

| Area | Required resolution |
| --- | --- |
| Chat and sidebar | Retain Decision cards/page/actions and permission editing alongside lifecycle notices, visibility controls, durable read cursors and draft holds. Opening Decisions must not acknowledge obscured conversation content or clear drafts/scroll. |
| Execution and startup | Retain master’s Decisions/Permissions constructor dependencies, recovery, cancellation and `resumeWaiting`. Visibility reads their saved state; it never answers, approves, resumes or cancels work. Start visibility recovery after execution/intake recovery. Its own interrupted assessments still make no provider calls on restart. |
| Visibility holds | Include `waiting` Runs and Thread-linked unanswered Decisions, including snoozed Decisions, as archive holds. Keep the existing queued/running execution-slot predicate unchanged so waiting still permits another message. Expose waiting distinctly from active execution. |
| Activity and counting | A transition to `waiting` is not terminal. Count settled responses once on actual completion/failure/cancellation/interruption, including transitions from waiting. Resumption/progress must not duplicate Fibonacci counts or unread markers. Preserve meaningful-result revival and manual Archive behavior. |
| Schema and migrations | Retain both features’ tables, grants, immutability checks and status constraints in Prisma/DBML. Keep already-applied migration files intact; append any waiting-aware activity/backfill correction. Test the combined migration history in both upgrade directions because the Permissions migration predates the visibility migrations. |
| Specs and inspection | Replace future waiting references with the implemented ownership boundary; reconcile index, terminology, instructions and open-question statuses. Keep lifecycle assessments/history outside Artifacts and ordinary answer/retrieval context. Preserve Decision and tool inspection. |
| Tests and visuals | Combine both scenario inventories and schema expectations. Regenerate the two chat baselines only after inspecting the combined UI at both supported sizes; do not choose one branch’s screenshot wholesale. |

## Gates before fast-forward

- Run isolated upgrades from populated master data, this visibility preview’s schema, and a fresh database. Verify manual titles/pins/archive state, explicit controls on migrated history, Decisions and immutable captures; migrations make no model calls.
- Exercise overdue Threads with waiting permission/question work: waiting and snoozing hold archive; another message remains possible; answering resumes the same Run through its existing owner; rejection/cancellation releases the hold after terminal settlement. Manual Archive remains immediate, and later substantive activity can revive it.
- Restart before/after Decision answer and continuation claim. Preserve master’s continuation guarantees while proving visibility/naming does not replay assessments, lose draft holds or double-count messages.
- Run quick checks during conflict resolution and full `pnpm verify` on the final unchanged candidate. Include the migrated-control, delayed-recording-recovery and switched-panel regressions, plus both existing feature suites.
- Review the combined diff separately and explore a disposable background app: Decision navigation, archive/revival, title history, saved drafts, inspection and both window sizes. Retain the [manual visibility plan](thread-visibility-retest.md) for model-judgment checks.

## Integrate and retire

Once authorized and verified, confirm the primary checkout has only the preserved unrelated `.npmrc` edit and `master` has not moved, then fast-forward to the single feature commit. Recheck the integrated revision and run a preserved-data preview smoke check. If master moves, rebase and repeat affected verification before advancing it.

Keep the recovery ref and preview resources until the integrated preview is accepted. Retire the feature branch/worktree through the managed cleanup workflow only after preserving needed data/configuration. Follow [development cleanup](../development.md#reset-and-cleanup); do not reset either preview. A Git rollback does not reverse database migrations: preserve a database/file backup before applying the combined schema, and use a forward fix or restore that backup if rollback is required.

## Recovery points

Pre-integration feature: `434251b`, retained as `codex/thread-visibility-recovery`. Private database dumps, preview files, Electron storage, checkout configuration and live-session state for both previews: `~/.ash-dev/backups/thread-visibility-20261021/{feature,master}`. Both previews were stopped before capture.
