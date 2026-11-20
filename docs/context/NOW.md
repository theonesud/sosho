# Sosho Present State

Last verified: 2026-11-20.
Update this file whenever you complete a milestone, change a port or invariant, or discover documentation drift.

## Active Focus

- Cross-agent governance standard across Pi, Claude Code, Antigravity, and OpenCode.
- Sosho Studio workflow canvas refinement, patch cable architecture, edge validation, auto-layout, and source drawer.
- Sosho Studio Phase 2 Playground and workspace hooks for memory, music, and system operations.

## Current Phase Status

1. **Core Infrastructure (`packages/llm`, `packages/memory`, `packages/workflow-engine`, `yue2`):** Complete and covered by automated unit and pytest suites.
2. **Studio Phase 1 (Architecture and Workflows):** Active polish. Next.js App Router migration, Obsidian graph stage, waterfall stage, anchored node popover, source drawer, and edge middleware policy tests are in place.
3. **Studio Phase 2 (Playground):** Initial API routes and workbench User Interface, or UI, exist. Integration polish and end-to-end verification remain open.
4. **Studio Phase 3 (Memory, Audio, and System):** Initial workspace hooks exist. Full UI parity and operational polish remain ahead.

## Known Drift to Resolve

- [PRODUCT.md](../../PRODUCT.md) and [readme.md](../../readme.md) still mention port `4100` for Studio UI and port `3000` for Langfuse. Ground truth in [apps/studio/package.json](../../apps/studio/package.json), [Makefile](../../Makefile), and [docker/compose.langfuse.yaml](../../docker/compose.langfuse.yaml) uses port `3000` for Studio UI and port `3001` for Langfuse.
- [readme.md](../../readme.md) states seven test suites. Ground truth in [tests/run_tests.sh](../../tests/run_tests.sh) runs ten suites.

## Immediate Next Priorities

1. Reconcile port numbers in [PRODUCT.md](../../PRODUCT.md) and [readme.md](../../readme.md) with actual runtime ports.
2. Expand automated verification for Studio Phase 2 Playground and Phase 3 Memory, Audio, and System screens.
3. Keep `docs/context/NOW.md` and `docs/context/DECISIONS.md` current in every feature commit.
