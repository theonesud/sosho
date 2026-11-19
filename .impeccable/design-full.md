---
name: Sosho Studio
description: Local-first AI developer workbench in Operate mode with restrained obsidian surfaces and semantic state precision.
colors:
  accent-primary: "#10b981"
  state-info: "#38bdf8"
  state-warning: "#f59e0b"
  state-error: "#ef4444"
  bg-canvas: "#09090b"
  bg-surface: "#111114"
  bg-elevated: "#18181c"
  border-subtle: "#27272a"
  border-strong: "#3f3f46"
  text-primary: "#fafafa"
  text-secondary: "#a1a1aa"
  text-muted: "#71717a"
typography:
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.bg-canvas}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "28px"
  button-secondary:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "28px"
  button-ghost:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "28px"
  badge-neutral:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  input-default:
    backgroundColor: "{colors.bg-canvas}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
    height: "32px"
---

# Design System: Sosho Studio

## Overview

**Creative North Star: "The Precision Workbench"**

Sosho Studio operates as a desktop-first local developer workbench where scanability, speed, and consistency outrank visual ornament. The interface uses a restrained obsidian palette with three distinct neutral surface layers so dense workflow graphs, model streams, memory records, and audio controls remain clear during long sessions.

Familiar developer patterns from code editors and node orchestrators anchor every screen. Primary controls stay visible while secondary engine parameters tuck inside collapsed accordions. Motion is brief and strictly communicates state changes, active execution, or focus.

**Key Characteristics:**
- **Tonal neutral hierarchy**: Obsidian canvas, surface rail, and elevated card layers separate work zones without heavy shadows.
- **Semantic state discipline**: Emerald, sky, amber, and red accents appear only on primary actions, active selections, and live status indicators.
- **Progressive disclosure**: Three primary controls lead each inspector or form, with advanced parameters collapsed by default.

## Colors

The palette pairs three dark neutral layers with one emerald primary accent and three semantic state colors.

### Primary
- **Signal Emerald** (`accent-primary`): Used for primary submit actions, active navigation selection, completed node borders, and focus rings.

### Neutral
- **Obsidian Canvas** (`bg-canvas`): Main workspace backdrop behind the Directed Acyclic Graph, or DAG, canvas and input fields.
- **Graphite Surface** (`bg-surface`): Top status bar, left activity rail, sidebars, and inspector drawers.
- **Slate Elevated** (`bg-elevated`): Cards, workflow nodes, popovers, and secondary buttons.
- **Hairline Zinc** (`border-subtle`): Default 1px borders and section dividers across all panels.
- **Active Zinc** (`border-strong`): Hover borders and active divider states.
- **Chalk White** (`text-primary`): Primary labels, headings, and code values.
- **Mist Zinc** (`text-secondary`): Supporting descriptions and inactive navigation labels.
- **Muted Zinc** (`text-muted`): Timestamps, placeholders, and micro metadata.

### Named Rules
**The State-Only Accent Rule.** Never apply `accent-primary`, `state-info`, `state-warning`, or `state-error` as static background decoration; reserve them for interactive actions and live status.

## Typography

**Display Font:** Inter (with system sans fallback)
**Body Font:** Inter (with system sans fallback)
**Label/Mono Font:** JetBrains Mono (with system mono fallback)

**Character:** One clean sans family handles all UI chrome, headings, and labels at a tight fixed rem scale, paired with JetBrains Mono for identifiers, JSON payloads, prompts, and tabular timings.

### Hierarchy
- **Headline** (600, `1.25rem`, `1.3`): Page titles across `/playground`, `/memory`, `/music`, and `/system`.
- **Title** (600, `1rem`, `1.35`): Section headings and drawer headers.
- **Body** (400, `0.8125rem`, `1.45`): Standard interface copy, descriptions, and form text, kept to 65 to 75 characters in prose.
- **Label** (500, `0.75rem`, `1.25`): Button text, inspector field labels, and badge metadata.
- **Mono** (400, `0.75rem`, `1.45`): Node IDs, JSON state diffs, scores, and `tabular-nums` latency readouts.

### Named Rules
**The Fixed Scale Rule.** Use fixed rem sizes rather than fluid `clamp()` headings so sidebars and inspectors maintain uniform density across desktop monitors.

## Layout

The shell uses a 44px top status bar and a 52px collapsed left activity rail framing full-height workspaces. Resizable sidebars and drawers flank the main stage on desktop viewports of 1280px and wider, collapsing cleanly on narrower screens.

## Elevation & Depth

Surfaces rely on tonal layering between `bg-canvas`, `bg-surface`, and `bg-elevated` separated by 1px `border-subtle` hairlines rather than drop shadows. Shadows appear only on floating canvas controls and elevated popovers.

### Named Rules
**The Flat-By-Default Rule.** Keep panels, cards, and nodes flat at rest; express hierarchy through surface step and border contrast.

## Shapes

Controls use crisp 4px (`rounded-sm`) badges, 6px (`rounded-md`) buttons and inputs, and 8px (`rounded-lg`) cards and floating React Flow controls. Borders remain 1px solid with sharp alignment across dense grids.

## Components

Every interactive component implements default, hover, focus-visible, active, disabled, loading, and error states with 150ms color transitions.

### Buttons
- **Shape:** Gently rounded (6px radius) with 12px medium text.
- **Primary:** `accent-primary` fill with dark `bg-canvas` text (`font-semibold`) and `h-7` (`28px`) or `h-8` (`32px`) height.
- **Hover / Focus:** Emerald-400 hover shift and 1.5px `accent-primary` focus-visible ring.
- **Secondary / Ghost:** `bg-elevated` with `border-subtle` for secondary actions; transparent hover-elevated fill for ghost triggers.

### Chips
- **Style:** 4px radius, 1px border, `11px` tabular-nums text (`2px 6px` padding).
- **State:** Neutral uses `bg-elevated`; semantic variants (`accent`, `info`, `warning`, `error`) tint at 15% opacity with 30% border opacity.

### Cards / Containers
- **Corner Style:** 8px radius (`rounded-lg`) for panels and React Flow node cards.
- **Background:** `bg-surface` for static panels; `bg-elevated` for interactive cards and nodes.
- **Shadow Strategy:** Flat at rest; floating overlays use subtle dark elevation (`0 4px 16px rgba(0, 0, 0, 0.45)`).
- **Border:** 1px solid `border-subtle`, shifting to `border-strong` or semantic state color when selected or active.
- **Internal Padding:** 12px (`md`) to 16px (`lg`) depending on density.

### Inputs / Fields
- **Style:** `bg-canvas` background, 1px `border-subtle`, 6px radius, `32px` height (`h-8`), `12px` text.
- **Focus:** Transitions border to `accent-primary` with emerald caret.
- **Error / Disabled:** Reduced opacity (`0.5`) and disabled cursor when inactive.

### Navigation
- **Top Status Bar:** 44px height with brand mark, live GPU owner pill, queue depth pills, service health popover, HITL alert pill, auth trigger, and `Ctrl+K` button.
- **Left Activity Rail:** 52px icon rail with Radix tooltips and `accent-primary` active indicator.

## Do's and Don'ts

### Do:
- **Do** use skeleton placeholders for loading states instead of centered spinners.
- **Do** render overlays, dropdowns, and tooltips in Radix portals so scroll containers never clip them.
- **Do** show three primary controls first and place secondary knobs inside a collapsed Radix Accordion.

### Don't:
- **Don't** open modal dialogs when an inline bar, accordion, or drawer solves the task.
- **Don't** invent custom button shapes or mismatched form controls across screens.
- **Don't** add decorative page-load animations or saturated accents on inactive elements.
