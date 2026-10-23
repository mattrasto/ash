# Initial Jev router

Implementation authorized, 2026-10-22 · Calibration deferred by user; routing enabled initially · Functional verification performed

Behavior: [model-routing spec](../../specs/features/model-routing.md). Implement the proposed simple policy now; representative usage improves it later, not a launch gate.

## Execution

- Reuse the existing Jev credential and API contract with a separate one-second routing deadline. One validated Choice call for new/Luna conversation submissions; strong remains sticky. Special-purpose workflows retain their models.
- Accept input, normal context, tool capabilities and a routing Instruction snapshot before any provider call. Save an immutable `model_routing_request` Act. Worker selection appends an immutable inference request and atomically updates the Run pointer and Thread upgrade state before inference dispatch.
- Store upgrade/override state inside the existing Thread lifecycle JSON, with its own revision for override races. Lock Thread then Run while resolving selection; never hold either lock over the Jev call. Cancellation or stale override prevents an obsolete dispatch. An interrupted pending assessment can retry its frozen strong request explicitly without reclassifying.
- OpenAI adapter accepts only its configured default plus the two explicit routed configurations; specialists keep their existing validation. All calls share the session reservation. Tool rounds and retries retain captured settings.
- Add Model routing to the existing Instructions editor and an advanced Thread control, outside the composer. Inspection exposes the routing request and result. Private routing is a reserved override that fails clearly until a private endpoint exists; it never invokes Jev or silently uses OpenAI.

## Verification

Boundary integration with real PostgreSQL and controlled Jev/OpenAI transports: fast selection, upgrade/stickiness, edited Instruction capture, invalid/uncertain/timeout fallback, cancellation, concurrent override, retry/restart, deduplication, frozen captures, private bypass and multi-round tools. Verify actual OpenAI wire model/settings, not only local labels. Desktop: Instruction editing, advanced override and routing inspection. No paid API calls in default verification.

Run quick verification while iterating, then full verification for the final source. Review the diff separately and explore the actual app in a hidden disposable preview. Preserve main and the user's existing preview.
