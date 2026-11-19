# Design System: Sosho Studio

## Mode

Operate mode. Familiarity is a feature. The interface disappears into the task and puts scanability, speed, and consistency first.

## Typography

- **UI sans**: `Inter` with system sans fallback for headings, labels, buttons, and body text.
- **Monospace**: `JetBrains Mono` with system mono fallback for code, identifiers, JSON, prompts, latencies, and logs.
- **Scale**: Fixed rem scale with tight 1.15 ratio (`11px` micro, `12px` caption, `13px` body, `14px` label, `16px` section, `20px` page title).
- **Line length**: Keep prose blocks between 65 and 75 characters. Allow dense tables and JSON inspectors to span wider.

## Color System

Restrained dark obsidian palette with distinct surface elevation and semantic state accents.

- `--bg-canvas`: `#09090b` (main canvas and backdrop)
- `--bg-surface`: `#111114` (sidebars, rails, toolbars)
- `--bg-elevated`: `#18181c` (cards, nodes, popovers)
- `--border-subtle`: `#27272a` (default dividers and node outlines)
- `--border-strong`: `#3f3f46` (hover and active outlines)
- `--text-primary`: `#fafafa`
- `--text-secondary`: `#a1a1aa`
- `--text-muted`: `#71717a`
- `--accent-primary`: `#10b981` (emerald for primary actions, active selection, and success)
- `--state-info`: `#38bdf8` (active execution and info)
- `--state-warning`: `#f59e0b` (paused HITL checkpoint and warnings)
- `--state-error`: `#ef4444` (failed nodes and destructive actions)

Use accent colors only for primary actions, current selection, and live state indicators.

## Layout and Shell

- **Top status bar**: 44px height. Contains brand mark, GPU owner pill, queue depth pills, service health trigger, active HITL alert pill, Auth trigger, and `Ctrl+K` button.
- **Left activity rail**: 52px collapsed icon rail with tooltips for Workflows (`/`), Playground (`/playground`), Memory (`/memory`), Audio (`/music`), and System (`/system`).
- **Workspace panes**: Resizable left sidebar, main stage, and right inspector drawer. Collapse side panels cleanly on narrower viewports.

## Component Rules

- Every interactive element defines default, hover, focus-visible, active, disabled, load, and error states.
- Use skeleton placeholders for load states instead of centered spinners.
- Write empty states that explain the next action.
- Place overlays, popovers, and dropdowns in Radix portals so containers never clip them.
- Avoid modal dialogs when an inline bar, accordion, or drawer solves the task.

## Motion and Shortcuts

- Use 150 to 200 millisecond transitions strictly to communicate state change or reveal.
- Avoid page-load entrance animations.
- Support `Ctrl+K` for Command Palette, `Cmd+S` or `Ctrl+S` to save the active graph, and `Escape` to close overlays.
