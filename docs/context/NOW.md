# Sosho Present State

Last verified: 2026-11-21.
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

- None currently recorded. Phase 1 reconciled Studio UI (`3000`), Langfuse (`3001`), and test suite count (`10`) across `PRODUCT.md`, `readme.md`, `packages/llm/src/index.ts`, and `apps/studio/server/index.ts`.

## Immediate Next Priorities

1. All 6 phases of `REFACTOR_PLAN.md` are implemented. Verify live Docker services (`litellm`, `langgraph`, `langflow`, `playwright`) and run `pnpm install` for workspace package resolution and E2E tests.
2. Expand automated verification for Studio Phase 2 Playground and Phase 3 Memory, Audio, and System screens.
3. Keep `docs/context/NOW.md` and `docs/context/DECISIONS.md` current in every feature commit.

## Rebuild Stage 1

Date: 2026-11-20.

- Rewrote `AGENTS.md` as a short index. It is the single standard for all four agents.
- Moved the Claude adapter to `.claude/CLAUDE.md`. Removed root `CLAUDE.md` and `GEMINI.md`. Linked `.claude/skills` to `.agents/skills`.
- Replaced the hook scripts with one guard in `bin/agent-guard.sh`. Rewrote `bin/check-agent-docs.sh` and `opencode.json`.
- Deferred: coding standards, documentation, architecture, and structure stages. The port table and Studio security rules remain in `docs/context/DECISIONS.md`.
- Deferred: git pre-commit hook in stage 2.


## Rebuild Stage 2

Date: 2026-11-20.

- Added coding standards in `docs/standards/`: `code.md`, `typescript.md`, `python.md`, `testing.md`, and `git.md`.
- Added path-scoped rules in `.claude/rules/` and `.agents/rules/`. Each rule file points to one standard and `code.md`.
- Updated `AGENTS.md` sections 4, 5, and 6 with the command contract, the hook rule, the legacy rule, and five index rows.
- Extended `bin/check-agent-docs.sh` to check standards files, links, rule file length, and Antigravity frontmatter.
- Stage 2A toolchain configuration is a separate change. Folder structure remains for stage 5.
