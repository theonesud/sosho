---
name: Sosho
description: A dark, flat, minimal console for a local workflow engine. Glass is for floating layers only.
colors:
  bg: "oklch(0.145 0.006 260)"
  surface-1: "oklch(0.18 0.007 260)"
  surface-2: "oklch(0.215 0.008 260)"
  surface-3: "oklch(0.265 0.009 260)"
  edge: "oklch(0.52 0.01 260)"
  text-1: "oklch(0.96 0.004 260)"
  text-2: "oklch(0.79 0.008 260)"
  text-3: "oklch(0.68 0.01 260)"
  text-disabled: "oklch(0.5 0.008 260)"
  primary: "oklch(0.96 0.004 260)"
  on-primary: "oklch(0.18 0.007 260)"
  accent: "oklch(0.72 0.13 265)"
  accent-text: "oklch(0.82 0.1 265)"
  focus-ring: "oklch(0.78 0.12 265)"
  kind-trigger: "oklch(0.8 0.1 170)"
  status-pending: "oklch(0.76 0.01 260)"
  status-running: "oklch(0.81 0.12 235)"
  status-waiting: "oklch(0.85 0.12 80)"
  status-succeeded: "oklch(0.82 0.13 155)"
  status-failed: "oklch(0.77 0.14 25)"
  status-cancelled: "oklch(0.77 0.04 300)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    lineHeight: 1.6
rounded:
  sm: "0.375rem"
  md: "0.625rem"
  round: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
  xxl: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: "2rem"
    padding: "0 0.75rem"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.sm}"
    height: "2rem"
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    padding: "1rem"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.sm}"
    height: "2rem"
  badge-status:
    textColor: "{colors.status-running}"
    rounded: "{rounded.sm}"
    padding: "0.1rem 0.5rem"
---

# Design System: Sosho

## Overview

North Star: "Graphite". Sosho is a quiet instrument for one technical owner. It is dense but calm. The graph and the run status carry the most visual weight. Everything else steps back.

- Flat graphite surfaces. Depth comes from small steps in lightness and from one hairline border.
- Color means state. Hue is used only for run status, the trigger node tint, edges, and the danger color. One indigo accent marks focus and selection.
- Glass is allowed only on layers that float over content.
- The page has no gradient and no texture. The graph canvas has a dot grid because it is a canvas.
- Motion confirms a change. Each state change and each interaction has a short transition. Nothing bounces.

## Colors

Color strategy: restrained. Neutrals have a cool tint (hue 260, chroma 0.004 to 0.01).

- `bg`, `surface-1`, `surface-2`, `surface-3`: ground, card, raised or hover, and selected. Step up one level for each layer.
- `text-1`, `text-2`, `text-3`: primary, secondary, and hint text. All three pass 4.5:1 on every surface.
- `edge`: the border of a field, a checkbox, a radio, and a switch. It passes 3:1 on `bg`.
- `primary`: the off-white fill of the main button, a checked box, a switch, and a progress bar.
- `accent`: focus ring, selected row, and token fill. Do not use it for status or for decoration.
- Status colors: pending, running, waiting, succeeded, failed, cancelled. Each pairs with an icon and a label. Never use color alone.
- Node kind has no color, with one exception. The trigger node has a green tint: `kind-trigger` on the icon chip, 14 percent as the chip fill, and a faint card tint and border. Run status colors and the error outline replace the tint border. Show other kinds with an icon and a label in neutral text.
- The tint behind a status badge is 10 percent of the status color. Do not raise it, because the contrast drops.

## Typography

- Use system font stacks. No font package is installed.
- Base size is 13 px. Use 12 px for labels and hints.
- Headings use weight 600 and letter spacing -0.02em. Do not use uppercase or wide tracking.
- Use tabular numbers everywhere. Use the mono stack only for ids, cron text, URLs, time stamps, and JSON.
- Decision for the owner: a UI face such as Inter would add polish. Do not install it without approval.

## Layout

- Spacing steps: 4, 8, 12, 16, 24, 40, 64 px. Use tight steps inside a group and 24 to 40 px between groups.
- The workspace left panel is 15 rem wide (`--panel-width`). It collapses to a 3 rem rail (`--panel-rail-width`). The width change uses `--duration-expand` and `--ease-out`, and it does not move for reduced motion.
- Control height is 2 rem.

## Elevation & Depth

- Declare depth once. A card has a fill and a hairline border. It has no shadow.
- Floating layers use `--float`: a 78 percent surface, a 20 px blur, a hairline, and one soft shadow. Floating layers are popovers, menus, dialogs, and the graph controls.
- Do not place one glass layer inside another.
- Under `prefers-reduced-transparency` the float fill becomes solid and the blur is off.

## Shapes

- Radius is 6 px for controls and badges. It is 10 px for cards and floating layers.
- Pills are not used. Round shape is only for dots, switches, and sliders.

## Components

- Button: primary is off-white. Secondary is a raised fill with a hairline. Ghost has no fill. Danger has a red outline and text.
- Status badge: icon and label in the status color on a 10 percent tint. Cancelled text has a line through it.
- Graph node: 176 by 52 px. A raised fill, a hairline, a neutral icon, a name, a kind label, and a status dot. A running, waiting, or failed node gets a status-colored border. The selected node gets the focus ring.
- Workspace node: HTML card on the canvas layer. Collapsed, it shows an icon, a name, and a status icon, and it is at least 11 rem wide. Expanded, it is 24 rem wide with the focus ring border and a `surface-1` fill. The body holds the schema form. The card grows in height to fit the form. It never scrolls. A wheel over the card pans the canvas up or down. Ctrl and wheel zoom. A list inside the card keeps its own scroll. On expand, the card keeps zoom 1. A card taller than the canvas puts its top 72 px below the canvas top. When the card changes height, its top edge stays fixed. The generic fields sit in a closed "Advanced" section. The trigger node has no Advanced section. A human node that waits shows its prompt and reply controls. Only in edit mode, an expanded node shows ghost Copy, Duplicate, and trash buttons in its head. Each tooltip shows its shortcut. A selected node has a 1 px focus ring border. Only a single selected node expands. The selection box has a 1 px `accent` outline and an `accent-soft` fill. The plus handle on the output edge sits at the vertical center of the node.
- Node status: a status icon in the status color at the end of the node head. A running, waiting, or failed collapsed node gets a border in the status color. A skipped or cancelled collapsed node is at 60 percent opacity.
- HUD: one floating bar, centered at the top of the canvas, with the `--float` layer. It holds the workflow name, three icon groups, Save, and Run. A thin separator divides the groups. The groups are: Undo and Redo; Copy, Paste, Duplicate, and Delete selection; Select all and the Select tool toggle. Each button has a tooltip with its shortcut. A button is visible only when the user can use it. A hidden button is inert and cannot get focus. Undo shows with a past. Redo shows with a future. Copy and Duplicate show with a selected node. Delete shows with a selected node or edge. Paste shows when the in-app clipboard holds nodes. Select all shows when the graph has nodes and not all are selected. The Select tool toggle always shows in edit mode. Run mode and a read-only view show no edit icon. A separator shows only between visible groups. A button enters and leaves with opacity, a scale from 0.8, and a width collapse, with `--duration-enter` and `--ease-out` to enter and `--duration-exit` and `--ease-in` to leave. Reduced motion removes the transition. While the Select tool is pressed, a plain drag draws a selection box. It has no select. The name is plain text. On hover it shows a pencil icon. A click on the name or the icon turns it into a text input with a tick button. A small dot in the waiting color marks unsaved edits. The Save label reads "Save as vN". The HUD has no Live switch, because triggers are always live. Each save binds the non-manual triggers of the new version.
  - The Run button is one button that changes in place with the run state. The new label and icon fade in and move 0.5 rem, with `--duration-enter` and `--ease-out`. The fill changes with `--duration-base`. Reduced motion keeps only the fade. The button has a fixed minimum width, so the bar does not move.
  - In edit mode it reads "Run" and uses the primary fill. A click starts the latest saved version. If edits are not saved, the tooltip says "Runs vN. Unsaved edits are not included." If no version is saved, the button is disabled and the tooltip says "Save first".
  - While a run is pending, running, or waiting, it reads "Cancel" and uses the danger fill. A click cancels the run.
  - When a run ended (succeeded, failed, or cancelled), or when the user views a finished run, it reads "Edit" and uses the secondary fill. A click returns to edit mode. There is no separate "Back to edit" button.
  - Resume and Fork are icon-only ghost buttons with a tooltip. They show only where they apply. Notices go in a callout at the bottom center. The HUD fills the canvas width minus 12 px on each side and centers its content. It never overflows the canvas. The canvas is a size container. When space is short, the HUD reduces in this order: first the gaps tighten (canvas below 58 rem); then the workflow name truncates with an ellipsis, and a tooltip shows the full name; then the low-priority labels hide (the version, canvas below 50 rem). Hidden labels keep their accessible name. Save and Run never hide. The label change uses `--duration-base` and `--ease-in-out`, with no jump.
- Left panel: two tabs, Workflows and Runs, at equal widths over the full panel width. The Runs tab label shows a count badge in the waiting color for the waiting runs. The panel collapses to a rail. It is open on first load, and local storage keeps the choice under a versioned key. The rail holds an expand button and a small waiting-color count when runs wait. The Workflows tab header holds the one New button. One group shows each workflow: the header shows the name, and the version rows follow, newest first, indented behind a thin guide line. The name does not repeat in a version row. A group has no collapse toggle. The open version row, and the open run row, have a 1 px accent outline on all sides with `--radius-1`. They have no fill. On hover or focus, a group header shows a three-dot button with Rename, Duplicate, and Delete. Rename is an input with a tick button in the header row. A version row shows a menu with "Duplicate from this version". Delete asks in an alert dialog. A run row shows the workflow name, a status badge, the version, and the start time. Waiting runs come first, newest first. The other runs follow, newest first. The sound toggle sits in the panel footer as a ghost button.
- Helper box: a small glass text button at the bottom left of the canvas, with the text "Shortcuts" and no icon. It is closed at each load, and the app does not keep the state. A click opens a popover that is anchored to the button, 17 rem wide. It lists each action and its keys in two columns, with `kbd` styling. It shows Cmd on macOS and Ctrl elsewhere. A click outside, or Esc, closes it. The popover uses the popup motion tokens. In run mode, it lists only the actions that apply. The zoom controls are at the bottom right, and the HUD is at the top, so the three never overlap.
- Webhook trigger: triggers are always live. The URL, the token, the schedule, and the follower line come from `GET /workflows/{id}/triggers` for the latest saved version. The token field is one text field. The masked token shows by default, for example "••••••••abcd". The eye button sits inside the field at the end, as an input end adornment, and reveals or hides the token. Copy and Regenerate sit outside the field. A terminal icon button beside the URL Copy copies a ready curl command. The buttons are icon-only ghost buttons with a 16 px icon and a tooltip that names the action ("Regenerate token", "Show token", "Copy curl command"). The gap between the buttons in a row is `--space-1`. Regenerate uses a key icon with a circular arrow and asks in an alert dialog: "The old token stops working at once." When the node is not in the saved version, a muted line says "Save to create this webhook." or "Save to schedule this trigger." A schedule trigger shows "Next run" in the schedule time zone. A trigger in the After workflow mode shows "Follows <source> when it <status>." A save is refused with 422 for a bad cron, a bad time zone, or a trigger cycle. The cycle issue shows on the source workflow field.
- Time zone typeahead: the time zone field is a Select with no search field. Its options come from `Intl.supportedValuesOf('timeZone')` with the current UTC offset, and the browser zone is preselected. When the list is open, typing moves the highlight to the first match. The field buffers the typed characters for 500 ms. It matches the start of the full name ("Asia/Cal"), or the start of any part after a slash ("Calc"). A space matches an underscore. Enter chooses the highlighted option. Focus follows the highlight, so a screen reader announces the option.
- Option highlight: every Select, Combobox, and Menu option shows the highlight as a row background change only, with no outline or border.
- Stale issues: when a user edits a node, the app drops at once the server issues of that node. It keeps them off until the next validation result arrives. The app drops issues of fields that the mode does not show. The required checks run at once, so the alert icon updates in the same frame as the edit.
- Quiet note: a small glass line at the bottom center of the canvas. It fades in and goes away after 4 seconds. It shows results such as "Copied 2 nodes.", "Trigger skipped: a workflow has one trigger.".
- Graph edge: a 1.25 px line. An edge into a running node is blue and dashed, and the dashes move. A loop edge is amber and dashed.
- Table: sentence-case column labels, hairline rows, and a raised row on hover.
- Stat strip: one card split into cells by hairlines. It is not a row of separate tiles.
- Callout: a full border and a 8 percent tint of the tone, with a tone icon.

## Motion

Every state change and every interaction has a short transition. Motion is calm. It confirms a change and it does not decorate.

Rules:
- Micro interactions take 110 ms. They are hover, press, focus, and color change.
- Overlays and disclosure take 200 to 220 ms. An exit is about 30 percent faster than an enter.
- An enter uses `--ease-out`. An exit uses `--ease-in`. A move between two places uses `--ease-in-out`.
- No motion bounces or overshoots.
- Animate only `transform`, `translate`, `scale`, `rotate`, `opacity`, color, `box-shadow`, `clip-path`, and filters.
- Exception: the height of an accordion, a collapsible, and a tree group. The ui-sdk measures the height.
- Do not animate the padding of a panel. The ui-sdk measures the height at the start state. Put the bottom space of a panel in a `::after` spacer.
- Exception: the segmented control indicator. The ui-sdk sets its box.
- Exception: the slider thumb and the slider fill. The ui-sdk sets `inset-inline` and `width`. They move only when the user does not drag. A drag stays direct.
- One file holds the transition rules: `src/styles/motion.css`. Component files hold no transition.
- Use only tokens for duration, ease, distance, and scale. Do not write a number in a rule.

Tokens:

| Token | Value | Use |
| :--- | :--- | :--- |
| `--duration-fast` | 110 ms | Hover, press, focus, icon swap |
| `--duration-base` | 180 ms | Color of a badge, rotation of a chevron, switch thumb |
| `--duration-enter` | 200 ms | Enter of a popup, dialog, tab panel, and list item |
| `--duration-exit` | 140 ms | Exit of the same layers |
| `--duration-expand` | 220 ms | Open of an accordion, a collapsible, and a tree group |
| `--duration-collapse` | 160 ms | Close of the same parts |
| `--duration-tween` | 240 ms | Graph viewport tween. The scripts read this token |
| `--duration-spin` | 700 ms | One turn of the spinner |
| `--duration-flow` | 900 ms | One cycle of the moving dashes on a running edge |
| `--duration-shimmer` | 1400 ms | One cycle of the skeleton shimmer |
| `--duration-pulse` | 1800 ms | One cycle of the running pulse |
| `--ease-out` | exponential out | Enter and hover |
| `--ease-in` | soft accelerate | Exit. The change is visible from the first frame |
| `--ease-in-out` | symmetric | Indicators that move |
| `--press-scale` | 0.97 | Press of a button, toggle, link, and nav item |
| `--enter-scale` | 0.96 | Start scale of a popup, dialog, and check mark |
| `--shift-popup` | 6 px | Offset of a popup from its side |
| `--shift-dialog` | 8 px | Offset of a dialog |
| `--shift-item` | 8 px | Offset of a list item that enters |
| `--grow-scale` | 1.12 | Scale of a slider thumb that the user presses |
| `--dot-scale` | 0.4 | Start scale of a radio dot |
| `--transition-interactive` | color set | Color, border, shadow, and focus ring in 110 ms |
| `--transition-press` | color set and scale | The same set plus the press scale |

What moves:
- Segmented control: item widths and text positions never change on click. The font weight is the same in every state. The item has no press scale. Only the indicator slides, with `--duration-base` and `--ease-out`.
- Controls: a button, toggle, toolbar, link, nav item, tab, and table row change color. A press scales the control, except a segmented item. The focus ring fades in.
- Form parts: the switch thumb slides. A check mark is drawn with a clip. A radio dot grows. A slider thumb grows on hover and press. A slider thumb and fill slide to a new value from the keyboard. Progress and meter fills move with a clip.
- Validation: an error message fades in and rises 8 px.
- Popups: a menu, select, combobox, popover, hover card, and tooltip fade and move 6 px from the side they open from. The origin of the scale is the trigger.
- Dialogs: the dialog and the alert dialog fade and scale. The backdrop fades.
- Disclosure: an accordion, a collapsible, and a tree group change height and fade. A chevron turns. The tab indicator slides. The tab panels cross-fade.
- State: a status badge changes color. The label fades in. The running dot pulses. A skeleton shimmers. The copy icon swaps to a check and back.
- Graph: a node fades its border. A status change fades the border color. An edge to the selected node turns to the accent. The edge into a running node keeps its moving dashes.
- Graph viewport: the zoom buttons and fit run a tween in a script. The wheel and the drag are direct.

Reduced motion (`prefers-reduced-motion: reduce`):
- Distance and scale tokens become zero. A layer only fades.
- The pulse, the shimmer, and the moving dashes stop. The state stays visible.
- Height changes become a fade. The graph tween takes 0 ms.
- Indicators, the switch thumb, the slider, and chevrons move at once. Their color still fades.
- The spinner keeps turning, because it shows that work is in progress.

## Do's and Don'ts

Do:
- Keep the graph the largest object on a screen.
- Use `edge` for any border that identifies a control.
- Keep text at 4.5:1 or better.
- Give each state change a transition. Write it in `src/styles/motion.css` with tokens.
- Animate an exit. Use `data-ending-style` so the layer stays until the exit ends.
- Test each new transition with `prefers-reduced-motion: reduce`.

Don't:
- Do not add a page gradient or a glow.
- Do not give each node kind its own hue.
- Do not use a one-sided colored border on a rounded box.
- Do not use gradient text.
- Do not put a kicker label above a heading.
- Do not add an animation library.
- Do not animate width, height, top, or left. The exceptions are in the Motion section.
- Do not use bounce, overshoot, or an effect that takes more than 240 ms.
- Do not write a duration or an ease in a component rule. Use a token.
- Do not add Tailwind, React Flow, an icon package, a font package, or a state library.
