# Memory Engine Scoped Agent Guide

Read root [AGENTS.md](../../AGENTS.md) and [docs/context/DECISIONS.md](../../docs/context/DECISIONS.md) before you edit `packages/memory/`.

## Architecture and Invariants

- **Two-Tier Scopes:** Store personal preferences in `~/.sosho/memory/` (`global`) and repository architecture or session summaries in `<repo>/.pi/memory/` (`project`).
- **Atomic Persistence:** Write every Markdown record and profile through a temporary file, `fsync`, and atomic rename. Never write partial files in place.
- **Race-Free Inbox Drain:** Rename `inbox/events.jsonl` to a unique batch file before drain, deduplicate events by SHA-256 hash, and refresh `core/profile.md`.
- **Secret Redaction:** Redact API keys, tokens, JSON Web Tokens, private keys, bearer headers, and credential URLs in both `global` and `project` scopes. Never bypass redaction for project scope.
- **Rebuildable Index:** Treat `<memory-root>/index.sqlite` as disposable. Combine FTS5 BM25, local CPU `embeddinggemma` dense vectors (`127.0.0.1:8082`) with automatic FTS5 fallback, single-hop entity graph recall, time decay, and access rank tracking.

## Mandatory Verification

Run typecheck and both unit suites after any change:

```bash
(cd packages/memory && npm run typecheck && npx tsx test/memory.test.ts && npx tsx test/capture.test.ts)
```
