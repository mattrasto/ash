# Frontend design system

Direction accepted 2026-10-22 · Implemented · Verification coverage below; subjective acceptance pending.

[Design requirements](../../specs/design-system.md) own appearance, interaction recipes and requirement classes. Feature specs own data, validation, permissions and navigation consequences. This document owns implementation guidance; [testing](../testing.md) owns execution and evidence policy.

Renderer paths are relative to `packages/client/src/renderer/`.

## Code map

| Responsibility | Code |
| --- | --- |
| Opaque palette intent, rounded sRGB derivation | `ui/theme.ts`; applied once by `main.ts` |
| Typography, controls and interaction precedence | `ui/theme.css`; migrated layout adapters in `ui/features.css` |
| Glass layers, content extent, mist and composition lifecycle | `ui/surface.ts`, `ui/surface.css` |
| Content snapshots, crossfade and measured bounds | `ui/replacement.ts` |
| Guarded dialog outside dismissal | `ui/dismiss.ts` |
| Sidebar layout movement around full-size glass | `ui/Rail.svelte`, `ui/rail.ts` |
| Popup top layer, anchoring and one active chain | `ui/popup.ts`; nested actions in `features/threads/Menu.svelte` |
| Native select value and keyboard-controlled popup | `ui/select.ts` |
| Native scrollports and overlay thumb | `ui/scroll.ts`; transcript following/restoration stays in `features/threads/scroll.ts` |
| Native search, stepper, range and semantic status | `ui/Search.svelte`, `NumberField.svelte`, `range.ts`, `Status.svelte` |
| Semantic Lucide assets | `ui/Icon.svelte`, `ui/icons.json`; the old Thread icon path delegates here |
| Workspace scene; static specimen reference | `@ash/scenes/browser` → `WorkspaceScene`; specimen `ui/Scene.svelte`, `ui/assets/manifest.json`, `ui/assets/licenses/` |
| Development specimen | `ui/Specimen.svelte`; development URL `?specimen=design` |
| Primary workspace | `features/threads/Chat.svelte`, `Sidebar.svelte`, `Message.svelte` |
| Streaming DOM and Markdown | `features/threads/streaming.ts`, `Markdown.svelte`, `markdown.ts` |
| Settings, Permissions, Decisions, inspection and media | Their existing feature components; shared visuals do not own their close/save consequences |

No component library or design configuration UI is introduced. Historical Final inputs are in [the capture](../design/reference/final-parameters.json); they are not runtime configuration.

## Adding frontend UI

Use semantic variables from the theme and shared control classes: `ash-button` with `ash-primary`, `ash-ghost` or `ash-icon`; `ash-field`; `ash-choice`; `ash-menu-row`; `ash-nav`. Icon-only close/remove actions also use `ash-close` for a centered 16px glyph and 30px ghost target. Native elements retain labels, values, form ownership, disabled state and keyboard behavior. Feature CSS supplies layout. Add reusable visual changes to `ui/` rather than copying material or state recipes into another feature.

Use `selectField` on native selects; keep native options and optgroups. `Search` owns clear/Escape behavior. `NumberField` keeps the unavailable direction reachable through `aria-disabled`. Apply `rangeField` to a native range. Forms supply `aria-invalid`, associated explanations and validation timing. Use `Status` for an explicit warning/error label with primary-colored explanation; its localized neutral backing supports the semantic foreground over difficult scenes.

A surface has one explicit `.surface-content` child. `use:surface` adds only its owned tint and backdrop siblings; it does not wrap Svelte-owned markup or enhance the whole document. Choose a material/backing by the [canonical context rules](../../specs/design-system.md#materials). For stretched navigation or another special layout, `extent` can name the content endpoint in surface coordinates. Resize and font changes update that endpoint without replaying formation.

Add `transition:mist` with the appropriate context to surfaces that appear/disappear. Its deferred Svelte transition obtains the actual direction after actions install material layers. It reuses the threshold bitmap and changes an SVG alpha transfer during animation; it does not encode a new canvas URL every frame. Settling removes masks and definitions. Do not add an independent fade or movement entrance to the same surface.

`departComposition` owns Thread/Decisions navigation until outgoing surfaces finish. The navigation sequence rejects stale completions. Returning to an existing Thread primes its recorded content immediately; token updates and completion retain the streaming reconciler's nodes. `ThreadScroll` remains the owner of transcript anchoring, follow mode and saved position. Connect an overlay scroll area's `onIntent` to that owner so dragging cannot fight incoming output. Text fields retain native editing/scrolling. Floating Latest controls belong to the transcript frame so they cannot cover recording or composer actions.

Use `replaceContent(frame, update)` when a frame survives a destination/content change. Pass only the destination region, never the whole app or composer. The shared implementation fades live content while its glass stays stationary, animates only changed bounds and continues rapid changes from the current composite. Copies are inert, hidden from accessibility, stripped of IDs, form names and label associations and removed after completion. It copies form values and nested scroll offsets; video copies are still canvas frames and cannot start a second playback. Feature code still guards stale asynchronous data responses.

Popups use the browser's top layer and remain inside the active dialog's interaction context. Their roots explicitly use `-webkit-app-region:no-drag`; otherwise Electron's header drag region can block upper options even above it in the top layer. Keep one active root chain and dismiss it before navigation. A feature may resolve a logical anchor again when its item moves in the DOM: the Thread menu follows the surviving Thread row after Topic regrouping. Menu hover responds to pointer movement, so repositioning beneath a stationary pointer cannot switch submenus. Escape returns focus; outside dismissal leaves focus with the new target.

Use `dialogDismiss` with the feature’s existing guarded close callback. Popup outside listeners run in capture phase so child event handlers cannot suppress dismissal; one gesture dismisses the topmost layer.

Sidebars live in `Rail`: its wrapper animates occupied space and the adjacent gap while the full-size glass keeps its mask geometry. Responsive fixed rails move from the edge.

Native dialogs stay mounted through their visual exit. They become noninteractive immediately, and their backdrop fades independently. Tests and callers must await exit completion before operating on the containing workspace. Feature save/unsaved-edit guards decide whether closing starts.

## Scene handoff

`App.svelte` mounts `WorkspaceScene` behind the workspace; the design specimen retains its static reference. Scene pixels and effects remain independent of UI surfaces. `Chat` injects `selectField` into the scene lighting select. Settings → Appearance injects it into the single Scene dropdown; Settings → General injects shared `Search`, anchored `Popover`, content replacement and `Status` into location settings. Search supports an optional combobox contract while retaining native editing and clear/Escape ownership. Scene controls use the shared classes and feature-only layout. `ui/theme.ts` preserves opaque palette intent; future scene resolution must produce derived output without overwriting it. The shared design spec owns current scope and deferred adaptation. Development identity is confined to `app/PreviewBar.svelte` and does not change product colors or get normalized over them in screenshots.

## Verification coverage

Coverage identifies observable checks, not a claim that every clause or accessibility target is certified. Run outcomes belong to the retained verification report for the exact source revision.

| Check | Requirements / acceptance | Evidence |
| --- | --- | --- |
| `design-dismissal` | DS-R03, R04, R10; DS-V04–05 | Outside dismissal for Processing, Settings, Topics and media; popup-before-dialog ownership; unsaved edit guard; drag-out protection; centered close targets |
| `design-reading` | DS-R01, R03, R11–12; DS-V07, V10–11 | Primary-colored Markdown links with accent underlines; native editor wheel scrolling in both directions and boundary chaining at minimum window size |
| `design-rails` | DS-R09, R11–13; DS-V07–08 | Intermediate layout positions for both sides, fixed overlay movement/reversal, live draft identity, true overflow and reduced motion |
| `design-controls` | DS-R01, R03, R04, R06, R08, R10; DS-V02–04 | Font loading; disabled/press/read-only states; grouped select navigation/typeahead; search clearing; stepper bounds; popup-in-dialog and nested focus; outside dismissal |
| `design-presence` | DS-R05, R09, R13; DS-V05, V07–09, V12 | Surface and dropdown close/reopen reversal, draft continuity, settled mask cleanup, no replay on edits, immediate reduced motion and forced-color native select |
| `design-replacement` | DS-R09, R11, R12; DS-V06–07 | Inert copies without IDs/form names, rapid replacement, live draft and nested scroll preservation, keyboard scrollbar, track-to-drag continuity, thumb grab offset and reduced-motion replacement |
| `adapt-parallel-conflict-apply` | DS-R03–05, R08–13; DS-V02, V07–08, V10 | Minimum-size conflict review, shared status/buttons, preserved feedback draft and resolution handoff |
| `adapt-desktop` | DS-R03–05, R08–13; DS-V02, V07–08, V10 | Existing Thread editor/draft retained across mode changes; shared evidence inspector, preview controls and minimum-size layout |
| `adapt-local-apply`, `adapt-local-restore` | DS-R03–05, R08–13; DS-V02, V07–08, V10 | Existing Decision controls, optional version details, narrow application inspector, native restart and retained Thread drafts |
| `chat-layout` | DS-R03–05, R07, R12; DS-V10 | Reviewed fixed-phase scene screenshots at normal/minimum window sizes with reduced motion |
| Existing Thread, Topics, Permissions, Decisions and media scenarios | DS-R10, R12; relevant feature IDs | Editing, streaming, saved read positions, organization, save guards, retry/cancellation, inspection and native media consequences |
| Real-app design review | DS-R02; DS-V01, V11 and experiential principles | Compare Final identity, thin marks/focus, status contrast on rendered composites and responsiveness; screenshots alone do not establish these |

The specimen exercises all control families, popup-over-text and popup-in-dialog, nested chains, read-only/invalid fields, changed-height replacement and scrolling. It has no preset management or design settings. Use real chat scenarios for streaming and restored running Threads.

Agent visual check, 2026-10-22: sampled warning/danger label backgrounds in the rendered specimen over the reference scene and opaque white/black backdrops. The lowest sampled text contrast was 4.92:1 with the localized neutral backing. This covers those samples, not every glyph, focus mark or scene. Chat screenshots at both supported window sizes and a mid-dissolve surface were inspected.

Living scenes add no readability wash or UI backing overrides. The [scene verification notes](scenes.md#verification) own current verification limits. Human acceptance remains: compare the overall material/motion feel against Final and inspect thin choice/focus marks over the selected scenes. Shape-adaptive mist, new code typography and touch density remain deferred by the design spec.

## Documentation review

First pass completed before implementation, 2026-10-22: repository instructions, README, spec index/product, architecture/repository structure, development/testing, Thread UX and feature specs were reviewed for entry points and conflicting guidance. `AGENTS.md` makes the design spec and this code map required reading for frontend work; the other entry points link to that canonical guidance. The older instruction to retain Ash's appearance is superseded; the 2026-10-12 UX record is historical. TOP-R01 defers appearance to shared requirements.

The design spec distinguishes hard requirements, experiential principles and optional/deferred refinements. DS-R and DS-V IDs stay stable as coverage grows. Future changes update the canonical recipe and affected checks together; visual judgment does not make an accepted rule optional.
