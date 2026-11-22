# Sosho Roadmap

This roadmap aligns with [PRODUCT.md](../../PRODUCT.md) and [DESIGN.md](../../DESIGN.md).
Build capabilities in sequence and verify each phase with automated tests.

## Phase 1: Architecture and Workflows (Current Polish)

- Keep `/` focused directly on the Workflows and Runs canvas.
- Complete polish on Obsidian graph stage, patch cable routing, auto-layout, waterfall run inspector, and Human-in-the-Loop, or HITL, checkpoint controls.
- Maintain strict edge middleware validation and Zod graph schema safety.

## Phase 2: Playground and Live Model Operations

- Complete Playground workbench UI connected to `apps/studio/server/routes/playground.ts`.
- Expose six-tier model role selection, streaming output inspection, and trace links to Langfuse (`:3001`).
- Add automated server and UI verification tests for Playground routes.

## Phase 3: Memory, Audio, and System Workbench

- Deliver full Memory Explorer UI for global and project scopes, hybrid search inspection, creation, and archival.
- Deliver YuE2 Audio workbench UI with live job queue visibility, VRAM handoff status, and FLAC or ABC score playback and download.
- Deliver System view that displays live service health, read-only `.pi/model-roles.json` and `.pi/models.json` inspection, and diagnostic status from `bin/doctor.sh`.

## Ongoing Governance and Quality

- Keep all ten verification suites in [tests/run_tests.sh](../../tests/run_tests.sh) green.
- Reconcile stale documentation whenever runtime ports, commands, or schemas change.
- Enforce ASD-STE100 and zero-trust verification across Pi, Claude Code, Antigravity, and OpenCode.
