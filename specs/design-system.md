# Ash design system

Accepted 2026-10-22 · Implemented · [Verification coverage](../docs/features/design-system.md#verification-coverage); subjective acceptance pending.

Reference: Fieldnotes **Final**, inspected at `5ee14fd`. Later decisions in this document supersede the lab draft. Engineering: [integration and code map](../docs/features/design-system.md).

The interface is an airy, readable work surface over a vivid natural scene. Frost separates content from the landscape; restrained blue identifies actions and selection. Panels float lightly, while controls sit within their plane. Motion explains what appeared, disappeared, or changed without disturbing reading or editing.

Ash uses one design system based on Final, with the accepted opacity, radius, and timing consolidations below. Fieldnotes remains the place to test new ideas. The [captured parameters](../docs/design/reference/final-parameters.json) preserve the original reference, including inactive experiments; they are historical inputs rather than Ash's production configuration. Ash uses Flat controls with Frost shift and Glass sheen on user messages. [Ash integration](../docs/features/design-system.md) maps the system onto the application.

## Requirement classes

- **Hard requirements:** the numbered DS-R groups below and their detailed recipes. Acceptance checks may be automated or manual; requiring visual judgment does not make a rule optional.
- **Experiential principles:** the Experience section guides judgment where exact values cannot establish quality. Review these in the real app against Final.
- **Nice to have:** only the explicitly optional grain and deferred extensions. These do not block this integration. Do not move accepted requirements into this class without a product decision.

## Experience

- Keep content crisp and stable. Put blur, tint, grain, and reveal effects on material layers; settled text and icons remain sharp.
- Separate surfaces with frosting, spacing, and a slight shadow. Avoid dark outlines, bevels, raised control textures, and refractive distortion.
- Use blue selectively. Fields engage through a neutral change in frost; navigation, primary actions, choice marks, sliders, and scrollbars retain an accent.
- Give feedback to the target being used. Hovering a child must not illuminate its whole panel or replay panel formation.
- Make presses steady. A quick click must not flash brighter than hover or focus. Retain the relevant state through pointer release.
- Use concise labels, explicit status, and familiar controls. The visual atmosphere must support complex work and long reading sessions.

## Hard requirements

| ID | Canonical detail |
| --- | --- |
| DS-R01 | [Palette and derivation](#color) |
| DS-R02 | [Status semantics and contrast](#status-colors) |
| DS-R03 | [Typography, icons and local assets](#typography-and-icons) |
| DS-R04 | [Geometry](#geometry) |
| DS-R05 | [Panel glass](#panel-glass) |
| DS-R06 | [Popup glass](#popup-glass) |
| DS-R07 | [Messages and landscape](#user-messages-and-landscape) |
| DS-R08 | [Interaction states and precedence](#interaction-states) |
| DS-R09 | [Motion lifecycle, timing and replacement](#motion) |
| DS-R10 | [Components, focus and popup ownership](#components-and-composition) |
| DS-R11 | [Scrolling](#scrolling) |
| DS-R12 | [Integration scope and continuity](#integration-scope) |
| DS-R13 | [Reduced motion and resilient presentation](#resilient-presentation) |

## Foundations

### Color

The shared palette comes from Final's fine-tuned Sky colors resolved in Condensed mode. Store opaque base colors and apply transparency in materials or states. Ash exposes no palette modes or alternative style families. Token names below are semantic names for integration.

| Base role | Value | Use |
| --- | --- | --- |
| Primary text | `#34464d` | Text, icons, strong labels |
| Secondary text | `#6e7e80` | Supporting labels, captions, placeholders |
| Accent | `#72aeee` | Actions and interactive marks |
| Panel tint | `#f6f7e6` | Shared panel and navigation glass |
| Message tint | `#6c98c1` | User-message material |
| Control fill | `#fffff8` | Fields, secondary actions, neutral feedback, popup glass |
| Panel shadow | `#405a68` | Panel and popup separation |

Derive the following in sRGB, rounding channels to the nearest integer. This keeps related shades coherent when a base color changes.

| Derived role | Rule | Final result |
| --- | --- | --- |
| Accent feedback | 80% accent + 20% control fill | `#8ebef0` |
| Selection | 35% accent + 65% control fill | `#cee3f5` |
| Caret | Accent | `#72aeee` |
| Divider | Primary text, usually at 16% opacity | `#34464d` |

Link text uses primary text with an accent underline, including Markdown and source citations. Primary buttons use primary text. Choice dots and switch knobs use a 50/50 accent–control blend. Nested feedback uses a slate blend of 25% accent and 75% primary text at the opacity specified under [states](#interaction-states). Inactive border and opaque-action color settings remain only in the reference capture.

### Status colors

Warning and danger extend the reference palette with two semantic foregrounds:

| Role | Value | Use |
| --- | --- | --- |
| Warning | `#80612c` · warm bronze | A caution or condition that needs attention before proceeding |
| Danger | `#9b4f55` · muted rose | Failed actions, invalid values, and destructive action labels/icons |

Use the color at full opacity on the status icon and short label; explanatory text stays primary text. Pair it with explicit language and an appropriate Lucide icon. Destructive actions retain the shared neutral frost feedback rather than gaining a solid red fill or colored border. Routine completion, cancellation, and permission requests use existing neutral/blue roles; a permission request uses warning only when it contains an actual caution.

Use the existing panel backings for status content. Validate status text at 4.5:1 or better and meaningful icons/state indicators at 3:1 against their rendered adjacent background. These targets follow W3C's [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) guidance. Thin glyphs also need visual inspection. Over a difficult backdrop, use the dense backing or a localized neutral backing; token contrast against an opaque swatch does not establish contrast over glass.

### Typography and icons

| Property | Rule |
| --- | --- |
| Family | Albert Sans, with a sans-serif fallback |
| Body and control text | 14px, weight 375, line height 1.6, zero letter spacing |
| Supporting labels | 0.9× body size |
| Captions and metadata | 0.8× body size |
| Main headings | 1.4× body size, weight 525, line height 1.25 |
| Compact panel headings | 1.2× body size, weight 525 |
| Strong text | Weight 525 |
| Icons | Lucide outline, Thin: stroke capped at 1 unit in a 24-unit viewbox, round caps and joins |
| Normal icon box | 16px square; align by the box, with the glyph's built-in whitespace preserved |

Light type and thin outlines keep the UI open without making it playful or ornamental. Use the same font and icon family across navigation, overlays, forms, and dynamically added content. Icons inherit text color and do not supply accessible names: label the owning action. Bundle font and SVG assets locally and retain the [license notices and source manifest](../packages/client/src/renderer/ui/assets/manifest.json). The reference font files cover a Latin character subset; other scripts fall back. Code retains `ui-monospace, SFMono-Regular, monospace` initially; review code blocks, tables and inspector output together before changing that family.

### Geometry

Use two general radius tokens: **control 6px** and **surface 10px**. Circular glyph containers and pill tracks retain their geometric shapes. Scrollbar clearance follows the enclosing surface radius.

| Element | Geometry |
| --- | --- |
| Ordinary panel | Surface radius; general content padding 24px |
| Popup / expanded surface | Surface radius |
| Text field / select trigger | Control radius; minimum height 42px; padding 9px 12px |
| Action button | Control radius; vertical padding 8px, inline padding 0.85em |
| Icon and label within a sample action | Gap 0.3em; reduce the icon-side padding by 0.125× icon size to account for viewbox whitespace |
| Icon-only action | Minimum 30px square, centered glyph; glyph size and pointer target are independent |
| Menu row / option | Control radius; 7px 10px padding; minimum height 36px / 37px respectively |
| Choice / radio | 19px square; checkbox uses control radius, radio circular |
| Switch | 36px × 22px; circular 14px knob, 3px inset, 14px travel |
| Range | 30px-high target; 5px track, 18px Chromium thumb |
| Field group | 7px label-to-control gap; helper text follows below |

Use spacing and alignment to group related work before adding another panel. Keep labels and glyphs aligned when text wraps. Touch density requires an Ash review.

## Materials

### Panel glass

Panels use **frost after content** with 10px maximum backdrop blur and no remaining frost at the bottom. Full blur continues through content and its padding; a mask fades it through unused space below. Tint remains across the whole panel. If content fills or overflows the panel, it remains fully frosted.

Use two shared tint opacities directly, removing the prototype's per-component alpha and hidden frosted-material multiplier:

| Backing | Tint opacity | Context |
| --- | --- | --- |
| Standard | 34% | Default for panels, navigation, composer, and in-place content |
| Dense | 44% | A panel overlays other readable content, or the backdrop requires stronger separation |

Both use panel tint and the same frost behavior. Choose by context rather than assigning another value to each component. This consolidates Final's ordinary surfaces around its default backing while retaining its stronger settings/overlay backing. Popup and message recipes remain distinct below.

The ordinary edge has no border and a soft shadow: `0 1px 6px 1px`, shadow color at 5% opacity. Keep the container physically borderless; a transparent border can expose a thin seam between glass and shadow.

Use separate tint, backdrop-blur, and live-content layers, all clipped to the surface radius. Intersect the blur mask with the reveal mask; mask tint and content separately. Masking or filtering the whole ancestor can change which backdrop the glass samples. Measure content extent in panel coordinates and update it after resize or font loading without replaying formation. Scroll content inside a stationary surface.

### Popup glass

Popup glass uses control fill at 60% opacity and uniform 24px backdrop blur. It uses uniform frost, independently of the panel's content falloff, to obscure background text consistently. The open trigger adopts the same backing and blur; closed triggers return to ordinary control states. Keep a 6px gap from trigger to popup, fit the popup within the viewport, and scroll long lists internally.

The popup shadow is `0 5px 18px`, shadow color at 10% opacity when fully formed. Its visibility follows formation progress and disappears before the last revealed fragments. Render popups above clipping ancestors and within the active dialog's interaction context.

### User messages and landscape

**Glass sheen** adds a 1px control-colored top highlight at 33% opacity and a 155° gradient from control fill at 18% to message tint at 21%. These rounded values approximate Final's sheen without its multiplier chain. Apply the treatment to the skin so sheen, frost, and content share the spatial reveal.

The landscape is the visual anchor. The reference uses [landscape.png](../packages/client/src/renderer/ui/assets/landscape.png), centered and covering the viewport, under a light warm wash. Its optional procedural grain is set to 1px with 5% density; keep grain out of the UI. The [living-scene feature](features/scenes.md) replaces the static workspace background independently of these materials; scene-driven palette adaptation remains [deferred](#deferred-extensions).

## Interaction states

Frost shift changes material density while text color, layout, and scale remain stable. Let `R` be a control's resting fill. Ordinary hover blends 84% `R` with 16% control fill at 90% opacity; ordinary keyboard focus blends 68% `R` with 32% control fill at 92% opacity. Hover blur is 2px; focus blur is 4px. Rest has no additional control blur. There is no white edge or control shadow.

| Control context | Rest | Engagement and persistent state |
| --- | --- | --- |
| Text, search, textarea, select, number | Control fill at 48% | Hover opacity ≈55%; focus/press opacity ≈72%, using 48% `R` + 52% control fill at 94% |
| Secondary button | Control fill at 35% | Ordinary hover/focus rule |
| Ghost action | Transparent | Ordinary hover/focus rule localized to its target |
| Primary action | Accent at 39% opacity | Ordinary hover/focus rule; text remains primary text |
| Checkbox, radio, switch track | Control fill at 66% | Ordinary feedback; checked state changes the mark or knob position, without a separate bright backing |
| Navigation | Transparent; current item uses selection color at 50% | Accent-feedback wash; selected text uses strong weight; no blur |
| Nested stepper/search button, menu row, option | Transparent | Slate at 12% for hover/focus/press; selected option uses 6% plus checkmark; no extra blur |

**State precedence:** disabled and read-only rules override transient feedback; editing focus or an open popup overrides hover; persistent selection remains identifiable underneath temporary feedback. Fields use their focus state on mousedown. Buttons and choices retain hover when pointer-pressed and focus when keyboard-pressed. None adds a brighter press flash.

Radio dots and switch knobs use the same light accent blend. Checkbox checks use the accent directly. The range track uses accent at 75% opacity and divider at 17%; its thumb starts at 70% accent + 30% control fill, lightening to the common choice blend on hover, keyboard focus, or press. The switch indicates selection by position, not by changing into a raised or shaded object.

Read-only fields retain control fill at 16%, secondary text, and zero added blur in all pointer states. They remain selectable, hide the caret, and gain only a restrained bottom focus indicator for keyboard use. Disabled controls use 40% opacity and have no hover response, including their marks and slider thumbs; disabled text-field backing drops to 15% control fill.

Invalid fields use the danger marker and a linked explanation, with stronger helper text and a restrained neutral backing. Forms own validation timing and messages; the visual component must not infer validity. Apply the shared [status-color rules](#status-colors).

Background, blur, opacity, and related feedback transition over 120ms using `ease`, in both directions. Marks, slider thumb color, switch travel, and option-row shading use 100ms. Fade auxiliary clear/check icons rather than abruptly adding/removing them. These small feedback timings are independent of surface motion.

## Motion

Choose motion by continuity, measured size, and responsiveness needs:

| What changes | Behavior |
| --- | --- |
| A surface arrives or leaves, with no surviving frame | Form or dissolve the material using its spatial mask; choose a short interval for immediate interactions and more time for a larger surface |
| A frame survives and its replacement content measures the same size | Keep the glass stationary and crossfade content |
| A frame survives but replacement content changes its size | Crossfade content and ease the frame's measured width/height concurrently |
| Content is expanded, collapsed, edited, or streamed within the same view | Update layout in place; do not replay the parent entrance |
| A composition of several separate surfaces is replaced | Complete outgoing exits before changing the composition, then reveal arriving surfaces |

Sidebars slide their occupied layout space over 190ms with cubic ease-in-out, alongside material formation/dissolve. Keep the material at full size during that movement. Fixed overlay sidebars slide from their edge without changing workspace width. Reduced motion resolves both immediately.

### Timing and reveal

Ash uses the fixed durations below, approximating Final's approved tempo with durations and delays rounded to 10ms steps. There is no speed multiplier, design settings UI, palette picker or persisted design configuration. Content-delay fractions stay fixed; control feedback and scrolling retain their own response times.

| Context | Duration | Curve / content coordination |
| --- | --- | --- |
| Large new or departing surface | 390ms each way | 70% cubic ease-out blended with 30% linear; entrance content delay 50% of reveal progress |
| Compact new or departing surface | 170ms each way | Same reveal curve; entrance content delay 8% |
| Anchored menu / dropdown | 120ms each way | Linear reveal, zero content delay, no text blur |
| Content replacement, including carousel | 190ms | Linear opacity from the first frame; outgoing and incoming overlap for the whole interval |
| Changed frame bounds during replacement | 190ms | `ease-in-out`, concurrent with content |
| In-place expansion / collapse | 170ms / 110ms | `cubic-bezier(.2,.7,.2,1)` |
| Expansion content / opening delay | 90ms / 20ms | Content opacity; no delay on close |
| Dialog backdrop | 140ms | `ease` |

In Final's **Mist**, two separated random origins lie within the centered 30% of panel width and height. Use physical panel distance to each cell's nearest origin, normalize across the surface, and perturb the advancing edge locally. The grid is 3px and edge irregularity is 100%; reveal should spread outward rather than producing isolated specks ahead of the front. Each fresh appearance gets a new seed; closing and rapid reversal reuse the existing seed and spatial pattern.

For large and compact entrances, content opacity resolves after its delay threshold and its temporary text blur falls from at most 3px to zero. The spatial mask clips content throughout. Exit reverses the reveal and its timing curve, keeping the content's current opacity instead of substituting a whole-panel fade. Fade the shadow with the edge reveal as well. Stop animation work and remove masks after settling.

Capture timing when a transition starts. Interrupt from the current visible state; use proportionally less time for the remaining distance rather than restarting. A close is noninteractive immediately. Remove or hide the surface only after its exit finishes; a stale completion callback must never hide a reopened surface.

For replacement, outgoing text must keep its exact rendered position, wrapping, form values, and nested scroll offsets. Measure before and after updates; animate only changed bounds. Any temporary visual copy is inert and hidden from accessibility, without duplicate IDs, form names, focus targets, or announcements. Rapid navigation must continue from the current composite and clean up obsolete content. Linear opacity prevents a long hesitation followed by a rushed switch.

The two-origin radial mist currently serves every aspect ratio. Shape-aware reveal for unusually narrow or tall surfaces remains deferred within this context model.

## Components and composition

Apply the shared [geometry](#geometry), [materials](#materials), and [state rules](#interaction-states) to every component.

| Component | Behavior |
| --- | --- |
| Action / icon button | Primary, secondary, or ghost hierarchy; stable label and glyph alignment; accessible name on icon-only actions |
| Text / textarea | Native editing, selection, labels, and descriptions; textarea may grow or resize without replaying its panel |
| Search | Same field material; clear action appears only with a value; Escape clears before an enclosing surface handles dismissal |
| Select | Native form value with a shared popup; arrows/Home/End/typeahead highlight enabled options; Enter/Space commits, Escape cancels, Tab/outside interaction dismisses |
| Action menu | Same popup material; keyboard navigation and typeahead, skipped disabled actions, focus return on Escape; track trigger position and viewport edges |
| Number stepper | Native min/max/step; separate named decrease/increase actions; unavailable direction disables at its bound and focus remains reachable |
| Checkbox / radio / switch | Native checked state and keyboard behavior; labels activate the control; radio groups preserve group semantics |
| Range | Native value/min/max/step and keyboard behavior; fill follows value continuously; disabled state includes the thumb |
| Expandable content | Explicit expanded state and controlled region; hide collapsed content from interaction; return focus before closing over a focused child |
| Navigation / replacement frame | Current destination remains identifiable; width stays fixed while views change; preserve state belonging to the destination |

Close and attachment-remove actions use the same 16px close glyph, centered in a 30px square ghost target.

Use one active popup chain and dismiss it before a view change. Outside gestures dismiss menus and dialogs; dialog dismissal follows the same save/busy guards as its close action. A gesture starting inside and ending outside does not dismiss. Dismiss an open popup before its containing dialog. A popup follows its trigger during scrolling and closes when the trigger leaves its scrollport. Modal focus containment, outside dismissal, and unsaved-edit protections must remain intact.

### Scrolling

Show a scrollbar only when content overflows its scrollport. Transcript breathing room must not create empty overflow when the conversation fits.

Scroll content inside the panel's stationary material and radius. Use a transparent track, 6px visible rounded thumb, 12px pointer track, and minimum thumb length 28px. Keep the visible thumb about 5px inside the outer edge and its endpoints beyond each corner radius plus 3px. The thumb is divider color at 28% opacity, accent feedback at 50% on hover/focus, and 70% while dragging; cursor changes from grab to grabbing.

Smooth thumb dragging and discrete mouse-wheel steps with a short catch-up toward the pointer/target, reversing promptly. The reference uses an exponential response with a 45ms time constant. Fine trackpad input, touch, selection, and zoom remain native. New pointer, focus, or keyboard intent interrupts queued movement. Keyboard option navigation scrolls the active row into view immediately; smooth scrolling must never fight it. Scrollbars follow the owning panel's reveal and clipping, and are noninteractive during exit. Provide keyboard scrollbar operation and native fallbacks for coarse pointers, forced colors, or unsupported overlay APIs.

## Integration scope

Keep Ash's existing layout, navigation and message grouping. Start with separate user and assistant message surfaces over the landscape; do not turn the transcript into one shared panel. Fieldnotes supplies material and interaction references, not application layout. Small UX fixes may simplify use; document any change that affects an existing feature requirement.

Preserve drafts, selection, IME input, streaming nodes, attachment progress, reading position, sidebar width, native media actions, keyboard alternatives, permission consequences and unsaved-edit protections. Feature specs remain canonical for those behaviors. Do not remount editors for visual changes or replay formation on token updates, completion, restoration or content resize.

Use the supplied static landscape for this integration. Keep the scene layer independent of UI materials so subsequent scene work can replace it. Scene generation, adaptation and schedules are outside this delivery.

## Resilient presentation

Reduced motion resolves material, content and bounds changes immediately and removes feedback and streaming animation. Forced colors restore system colors, borders and visible keyboard focus. Unsupported masks/backdrop filters keep content legible with neutral backing; native controls and scrollbars remain usable when custom presentation is unavailable. Narrow windows, zoom and font fallback must not hide controls or cause accidental page overflow. Validate contrast on the rendered scene and stacked surfaces under [status colors](#status-colors).

## Verification

The following are acceptance targets for integration, not a claim of production accessibility or performance certification.

| ID | Scenario | Required result |
| --- | --- | --- |
| DS-V01 | Comparison with Final | Match its typography, color identity, frosting, and feel; review the approved opacity/radius consolidation and status-color additions against it |
| DS-V02 | Pointer and keyboard use | Shared states across every feature; verify light-blue choice marks and neutral-frost focus over pale and detailed backdrops; no bright mousedown flash or disabled hover |
| DS-V03 | Read-only and invalid inputs | Selection works without editable frosting; errors have associated explanations and markers |
| DS-V04 | Popup over text / stacked surfaces | Underlying text does not compete with choices; trigger and popup material agree; Escape, Tab, outside dismissal, and focus return work |
| DS-V05 | Repeated open/close and rapid reversal | Spatial exit remains visible; no leftover shadow, border, stale popup, or invisible interactive content |
| DS-V06 | Same-size / resized replacement | Overlapping fades start immediately; outgoing content does not bounce; scroll, form state, and focus follow their owners |
| DS-V07 | Long content and expansion | Stationary glass and corners; no scrollbar clipping, scroll-anchor fight, replay on resize, or unreadable text during ordinary edits |
| DS-V08 | Reduced motion | Resolve material and layout changes immediately; remove feedback and streaming motion; preserve all information and interaction |
| DS-V09 | Forced colors / unsupported features | Legible system borders and focus indicators; native choices and scrollbars remain operable |
| DS-V10 | Narrow window, zoom, font fallback | No lost controls or accidental page overflow; labels wrap and keyboard targets stay reachable |
| DS-V11 | Varied scenes and stacked glass | Verify text, marks, focus, and actions on the rendered composite, including the [status-color contrast targets](#status-colors) |
| DS-V12 | Idle and streaming | Settled surfaces schedule no reveal frames; typing, scrolling, and token updates remain responsive |

## Deferred extensions

Scene/daylight/weather adaptation should derive displayed colors and surface backing from the base palette intent, preserving action identity and local readability. It must not overwrite the reference colors. No UI adaptation algorithm or night palette is approved here. Scene lighting follows the separate [living-scene contract](features/scenes.md).

Shape-aware creation/removal, a new code font, and touch density remain deferred. The [Ash integration](../docs/features/design-system.md) also needs rendered validation of the approved consolidations and the new status colors.
