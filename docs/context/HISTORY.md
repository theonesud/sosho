# Sosho Milestone History

This file records major completed milestones from repository history so every agent understands past work.

## Completed Milestones

1. **Core Local-First Harness and Six-Tier Model Stack:** Built Docker Compose stack for `llama-cpp` (`:8080`), `llama-decision` (`:8081`), `llama-embed` (`:8082`), and memory-capped Langfuse v4 (`:3001`), plus `bin/pi-launcher.sh` for external Git repositories.
2. **Two-Tier Hybrid Memory Engine (`packages/memory`):** Implemented atomic Markdown storage, race-free inbox drain, secret redaction across both scopes, SQLite FTS5, `embeddinggemma` dense vectors, and single-hop entity graph recall.
3. **Durable SQLite WAL Workflow Engine (`packages/workflow-engine`):** Implemented Zod graph validation, seven node types, resource queue semaphores, checkpoint pause and resume, crash recovery, and edge middleware policy stages.
4. **Hardened YuE2 Local Music Gateway (`yue2/gateway`):** Removed Docker socket usage in favor of HTTP model unload, moved `ffmpeg` off the event loop, added constant-time bearer authentication, and added pytest coverage.
5. **Next.js App Router Studio Migration (`apps/studio`):** Migrated Studio frontend from Vite to Next.js 15 App Router with React 19, Tailwind CSS v4, Radix UI, Zustand, TanStack Query, and Biome.
6. **Impeccable Design System and Studio Workbench:** Added [DESIGN.md](../../DESIGN.md), [PRODUCT.md](../../PRODUCT.md), `.agents/skills/impeccable`, Playground API routes, and workspace hooks for memory, music, and playground.
7. **Obsidian Graph Stage and Patch Cable Canvas:** Built `ObsidianGraphStage`, `GraphInspectorDrawer`, waterfall stage visualization, anchored node popover, source drawer, edge routing validation, and auto-layout controls.
8. **Cross-Agent Governance Standard:** Established root [AGENTS.md](../../AGENTS.md), adapters for Pi, Claude Code, Antigravity, and OpenCode, `docs/context/` ledgers, Claude governance hooks, and automated verification in `bin/check-agent-docs.sh`.
