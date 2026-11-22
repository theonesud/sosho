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

<!-- impeccable:design-map -->
Name: Sosho Studio
Colors: primary: accent-primary #10b981; secondary: state-info #38bdf8; tertiary: state-warning #f59e0b; neutral: bg-canvas #09090b; tertiary: state-error #ef4444; neutral: bg-surface #111114 (+1 more in the sidecar)
Fonts: Inter (headline, title, body, label); JetBrains Mono (mono)
Spacing: xs 4px, sm 8px, md 12px, lg 16px, xl 24px
Radius: sm 4px, md 6px, lg 8px
North Star: "The Precision Workbench"
Rules:
- The State-Only Accent Rule. Never apply `accent-primary`, `state-info`, `state-warning`, or `state-error` as static background decoration; reserve them for interactive actions and live status.
- The Fixed Scale Rule. Use fixed rem sizes rather than fluid `clamp()` headings so sidebars and inspectors maintain uniform density across desktop monitors.
- The Flat-By-Default Rule. Keep panels, cards, and nodes flat at rest; express hierarchy through surface step and border contrast.
Don't:
- Don't open modal dialogs when an inline bar, accordion, or drawer solves the task.
- Don't invent custom button shapes or mismatched form controls across screens.
- Don't add decorative page-load animations or saturated accents on inactive elements.
Do:
- Do use skeleton placeholders for loading states instead of centered spinners.
- Do render overlays, dropdowns, and tooltips in Radix portals so scroll containers never clip them.
- Do show three primary controls first and place secondary knobs inside a collapsed Radix Accordion.
Full: .impeccable/design-full.md (read a section when you need its detail)
