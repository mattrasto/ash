# Visibility feedback retest

Synthetic content only · [Behavior](../../specs/features/thread-visibility.md) · Earlier naming, archive/revival, pin, Undo and restart checks passed human review except the corrections below.

## Temporary guidance

The current feature preview has this paragraph appended to **Settings → Thread visibility**. Remove just this paragraph after testing; preserve the rest of the instructions.

> For Threads containing VIS_TEST only: when the latest user message contains VIS_TEST_DUE, choose a deadline exactly ten seconds after the supplied current time. When it contains VIS_TEST_DONE, choose immediate archival. Otherwise follow the existing guidance. These markers are only for this manual test.

Use `VIS_TEST` for ordinary judgment, `VIS_TEST_DUE` for a ten-second deadline and `VIS_TEST_DONE` for immediate archival. Each cue is a single token. The offline adapter supports the latter two for deterministic checks too.

The ten seconds start at the assessment’s supplied current time. Debouncing, the existing once-per-minute assessment schedule and model latency still apply; enforcement checks run every five seconds. Read the latest response and close panels when a step requires clearing unread protection.

## Ordered checks

1. **Initial title and notice.** Create a Thread. It should show **Untitled**. Send:

   > VIS_TEST: Help me plan a garden party for 12 people. The date is undecided. Reply in one short sentence and do not use tools.

   It stays Untitled until named. The first notice shows only “Ash named this Thread ‘…’,” with no excerpt from the message. Later renames still show old and new names. Existing first automatic naming notices use the concise presentation too.

2. **Draft protection, then release.** Send:

   > VIS_TEST_DUE: The party planning is complete. Reply “Recorded.”

   Read the response, then type without sending:

   > Keep this Thread visible while I finish this draft.

   Once the ten-second deadline is applied, wait until at least five seconds after it. The Thread stays visible; the visibility panel explains that a saved draft holds it. Switch to another Thread, return, and reload: draft and protection remain. Add an image attachment, then clear the text; the attachment alone still holds it. Remove the attachment: the already-due Thread archives within the next enforcement check, without another assessment. Its open view stays selected.

3. **Unread protection.** From the archived Thread, send:

   > VIS_TEST_DONE: The party is over and nothing remains. Write a 12-item retrospective checklist, without tools.

   Immediately switch to another Thread. After the response and assessment settle, open **Visibility and naming** through the original Thread’s sidebar actions without opening its conversation. The panel shows a scheduled time reflecting unread protection and explains that reading removes that delay. Open the conversation, close panels and view the final response: the immediate target can now archive it.

4. **Later target clarity.** Revisit the existing dated-event test Thread whose assessed deadline is later than the unread minimum. The panel shows the later scheduled time and says unread protection adds no delay. Reading must not pull that later deadline forward.

5. **Cleanup preparation.** Remove the temporary guidance paragraph. The debugger redesign remains deferred. Keep this worktree and preview until integration and disposal are requested.
