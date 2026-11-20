# Sosho Studio Scoped Agent Guide

Read root [AGENTS.md](../../AGENTS.md), [PRODUCT.md](../../PRODUCT.md), and [DESIGN.md](../../DESIGN.md) before you edit `apps/studio/`.

## Stack and Ports

- **Frontend:** Next.js 15 App Router, React 19, strict TypeScript, Tailwind CSS v4, Radix UI, `@xyflow/react`, Zustand, TanStack Query, `cmdk`, and Biome. Runs on `http://127.0.0.1:3000`.
- **Backend API:** Hono TypeScript server in `server/index.ts` with Zod validation, OpenAPI docs, SQLite DAG engine, and Server-Sent Events, or SSE, with 15-second heartbeats. Runs on `http://127.0.0.1:4101`.

## Non-Negotiable UI Rules

Follow [DESIGN.md](../../DESIGN.md) strictly:
- Apply `accent-primary`, `state-info`, `state-warning`, and `state-error` only for interactive actions and live status.
- Use fixed `rem` typography sizes instead of fluid `clamp()` headings.
- Keep panels, cards, and nodes flat at rest. Use surface step and border contrast for hierarchy.
- Prefer inline controls, accordions, or drawers over modal dialogs.
- Render overlays, dropdowns, and tooltips in Radix portals.
- Use skeleton placeholders instead of centered spinners.
- Show three primary controls first and place advanced controls inside progressive disclosure drawers or accordions.

## Non-Negotiable API Security Rules

- Restrict `Access-Control-Allow-Origin` to loopback Studio origins (`127.0.0.1:3000`, `localhost:3000`, `127.0.0.1:4100`, `localhost:4100`).
- Require timing-safe `SOSHO_STUDIO_TOKEN` bearer authentication on all `POST`, `PUT`, and `DELETE` routes.
- Enforce the 1-megabyte body cap (`HTTP 413`) and `isSafeWorkflowId` path traversal checks.
- Keep `.env`, `.pi/model-roles.json`, and `.pi/models.json` strictly read-only in Studio.

## Mandatory Verification

Run all four checks before you claim any Studio change is complete:

```bash
npm --prefix apps/studio run typecheck
npm --prefix apps/studio run lint
npm --prefix apps/studio run build
(cd apps/studio && npx tsx server/server.test.ts)
```
