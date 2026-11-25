# Workflow Engine Scoped Agent Guide

Read root [AGENTS.md](../../AGENTS.md) and [docs/context/DECISIONS.md](../../docs/context/DECISIONS.md) before you edit `packages/workflow-engine/`.

## Architecture and Invariants

- **Schema (`src/schema.ts`):** Define strict Zod schemas for all seven node types (`agent`, `subagent`, `decision`, `tool`, `skill`, `checkpoint`, `memory`), typed node ports, edge middleware stages (`validate`, `map`, `cast`, `redact`, `trace`, `deliver`), and `GraphPolicySchema`.
- **Engine (`src/engine.ts`, `src/store.ts`):** Persist runs, step logs, state, and checkpoints in `.pi/workflows/runs.sqlite` in SQLite Write-Ahead Log, or WAL, mode.
- **Safety Limits:** Execute unconditional branches concurrently, synchronize join nodes, recover interrupted runs at startup, and fail cyclic graphs with `max_steps_exceeded`.
- **Resource Semaphores:** Preserve concurrency caps: `cloud-io` (`8`), `local-gpu` (`1`), and `host-browser` (`2`).
- **Activities (`src/activities.ts`):** Call `@sosho/llm` for pure Large Language Model, or LLM, nodes. Invoke `pi --print --no-session` for tool-capable skill or subagent nodes. Enforce per-node retry limits and `AbortSignal.timeout`.

## Mandatory Verification

Run typecheck and all four unit suites after any change:

```bash
(cd packages/workflow-engine && npm run typecheck && npx tsx test/schema.test.ts && npx tsx test/max-steps.test.ts && npx tsx test/activities.test.ts && npx tsx test/engine.test.ts)
```
