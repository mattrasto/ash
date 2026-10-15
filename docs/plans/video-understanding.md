# Video understanding delivery

Implemented · Flash selected · Product rules: [recording feedback](../../specs/features/recording-feedback.md)

Use the existing attachment Summary Run for background caption/transcript, with explicit retries and immutable request/result Artifacts. Video-only imports remain stored without an unsolicited answer. Recorded clips generate actual action items during background analysis and insert them once into the editable draft before Send; behavior follows VID-R18.

Explicit video tools capture their analysis beneath the calling tool Artifact inside its existing chat Run. Completed results can be reused; simultaneous identical calls in the same Run share work. They do not create another initial Run on the upload Input.

Video analysis owns provider requests; the chat provider remains independently configured. Read only this checkout's owner-only Gemini key. Deterministic previews/tests make no external calls. Live video calls use Flash, structured outputs, no provider retries or stored interactions, and temporary provider files deleted after use (expiry is the interrupted-cleanup fallback).

Process 120-second segments at 1 FPS; detailed tools may inspect at 5 FPS over at most 30 seconds. Each tool call covers at most ten minutes. A background Run allows 30 segments and fifteen minutes of wall time; exceeding either limit retains explicit partial coverage. These are processing bounds, not attachment or recording limits. Retain original media and every supplied derivative/hash, source offset, prompt and sampling setting. Provider-selected frames are not exposed as individually verified evidence.

## Acceptance and verification

| Scenario | Boundary |
| --- | --- |
| Background context | Upload/Send stays usable; caption/transcript finishes independently, stays out of conversation messages, enters later frozen context; VID-A17. |
| Single-video tools | Describe/question, interval validation, deeper sampling, qualified no-match, immutable result references; VID-A02/18/19. |
| Authority and source | Recording narration remains feedback; on-screen/imported instructions stay evidence; requests and current visible state remain distinct; VID-A03/04/20. |
| Recovery | Pending shared jobs are reused; duplicate delivery/restart cannot redispatch; failures preserve playback, explicit Retry, partial coverage; VID-A06/07/21. |
| Evidence and credentials | Captured media hashes/offsets and playable citations; bounded provider upload/poll/delete, cancellation, sanitized failures, no secrets or private thoughts; VID-A01/05/18. |

Prefer real PostgreSQL/storage/Run/tool integration with controlled provider boundaries, then hidden Electron exploration. Use quick verification while iterating and full verification on frozen source before handoff. With the new Ash-local key, run a separate bounded synthetic live check; provider failure does not substitute for a quality result.
