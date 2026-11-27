# Memory System Handoff

Purpose: Complete handoff record of the `sosho-memory` design, research findings, implemented files, verification results, and cutover tasks.

Read when: You continue work on `packages/memory-graph`, run live memory tests, or complete legacy `packages/memory` cutover.

## 1 Current Status

Groups 1 through 8 code, operations commands, and documentation are complete. All 20 Layer 1 offline tests pass every static and unit check with exit code 0.

Two items remain open by owner decision:
- Live Layer 2 and Layer 3 integration tests did not run because the owner requested no live model calls during this session.
- Legacy `packages/memory` and its `.mcp.json` and `.pi/mcp.json` entries stay intact until live integration tests pass and the owner approves cutover.

## 2 Key Research Findings

### 2.1 Graph Engine Selection

- **Kuzu**: Apple acquired Kuzu Inc., and `kuzudb/kuzu` became read-only on October 10, 2025. Upstream receives no patches. **LadybugDB** is the active community fork, launched in November 2025 and at v0.15 to v0.18 in 2026.
- **SurrealDB 4.0 with SurrealKV**: Selected as the primary engine. Python package `surrealdb[embedded]==3.0.0` embeds `surrealdb-4.0.0` in-process with zero background daemon, low memory use, and single-transaction HNSW vector search, BM25 full-text search, and native `RELATE` edges.
- **SurrealDB 4.0 query constraint**: SurrealDB 4.0 rejects HNSW `<|k, ef|>` operators inside `OR` clauses. `surreal_queries.py` avoids this by execution of separate HNSW and BM25 subqueries inside one transaction.

### 2.2 Patterns Ported From `tree-of-life`

- English `/c/en/` extraction and max-weight deduplication from `tree-of-life/.backup/scripts/filter_conceptnet.py` and `tree-of-life/scripts/prepare_neo4j_csvs.py`.
- Clean-term and noun filters from `tree-of-life/backend/process_concepts.py` and `tree-of-life/.backup/scripts/filter_nouns.py`, implemented offline without NLTK runtime downloads.
- Low-degree node removal and objective `IsA` versus lateral relation split from `tree-of-life/scripts/compute_ontology.py`.
- Abstractness score `PageRank * (out_degree + 1)`, strict Directed Acyclic Graph creation, `nx.transitive_reduction`, canonical single-parent spine, and root merge from `tree-of-life/.backup/scripts/create_spine_tree.py`.
- Middle-out unknown-concept parent attachment from `tree-of-life/.backup/middle-out-ontology-builder.py`, with Ollama calls replaced by LiteLLM `embed` and `decision` calls on the Central Processing Unit.
- Shortest-path subgraph decomposition from `tree-of-life/backend/graph_engine.py` and `tree-of-life/backend/agent.py` to prevent bloated context windows.

### 2.3 Workspace and Hook Findings

- Antigravity runs hook commands with `.agents/` as the working directory per `agy-customizations/docs/hooks.md:131`. Relative paths in `.agents/hooks.json` must use `../bin/agent-hook-antigravity.sh` instead of `bin/agent-hook-antigravity.sh`.
- The untracked `tree-of-life/` directory at the repository root causes `biome` and `ruff` errors during full `make test-fast` because those tools scan it.
- `tests/unit/test_configs.py:193` fails when `.env` lacks `LITELLM_MASTER_KEY`. Run `make setup` to create missing local secrets.
- This host does not have the standalone `surreal` CLI binary. The Python environment installs only the embedded `surrealdb[embedded]==3.0.0` wheel.

## 3 Architecture and File Inventory

All new code lives in `packages/memory-graph` as `sosho-memory==0.1.0`, with a thin engine adapter in `packages/engine`.

### 3.1 Core Package `packages/memory-graph/src/sosho_memory/`

- `errors.py`: Typed exception hierarchy including `SecretRejectedError`, `UnapprovedRelationError`, and `MemoryModelError`.
- `config.py`: Frozen `MemorySettings` and `load_memory_settings` startup validator for SurrealKV and LiteLLM roles.
- `models.py`: Frozen Pydantic models for six node kinds, six ConceptNet relations, five workflow relations, provenance, `AuditLogEntry`, and `OntologyMetadata`.
- `schema.py`: Verified SurrealDB 4.0 DDL generator with `SCHEMAFULL` tables, HNSW cosine indexes, BM25 full-text indexes, `audit_log`, and `ontology_metadata`.
- `store.py`: Async `SurrealMemoryStore` managing `user_memory` and `project_<id>` scopes, CRUD, `ensure_edge`, and `run_query`.
- `conceptnet_filter.py`, `conceptnet_spine.py`, and `conceptnet_loader.py`: English ConceptNet filters, canonical spine reduction, and fingerprint-checked idempotent pre-loader.
- `write_gate.py`, `audit.py`, and `write_service.py`: Pre-write secret detector without secret leakage, relation allowlist, and per-database `asyncio.Lock`. Adds atomic SurrealQL transactions with append-only `audit_log`, transaction and session rollback, and Markdown audit export.
- `litellm_client.py`, `curation_models.py`, and `ontology_curator.py`: Typed LiteLLM client for `embed` and `decision`, middle-out parent attachment, contradiction closure with `Supersedes`, and post-task curation.
- `retrieval_models.py`, `surreal_queries.py`, `subgraph_compressor.py`, and `retriever.py`: Single-transaction hybrid retrieval, project-over-user precedence, active preference priority, proactive `FixedBy` lookup, path compression, hard token budget, and on-demand graph expansion.
- `maintenance_models.py` and `maintenance.py`: `GraphMaintenanceService` with duplicate candidate detection, verified merge with edge rewiring, episode consolidation, exponential edge decay, and `graph_health`.
- `bridge.py`, `mcp_server.py`, and `cli.py`: `MemoryBridge` for coordinator and subagent turn context, stdio JSON-RPC 2.0 MCP server via `python -m sosho_memory.mcp_server`, and operations CLI via `python -m sosho_memory.cli`.

### 3.2 Engine Bridge, Config, and Docs

- `packages/engine/src/sosho_engine/memory_bridge.py` and `packages/engine/pyproject.toml`: Role mapping, instruction injection, and `ToolRegistry` memory tool registration pinned to `sosho-memory==0.1.0`.
- `pyproject.toml`, `packages/memory-graph/pyproject.toml`, and `uv.lock`: Workspace registration and exact pins for `surrealdb[embedded]==3.0.0`, `networkx==3.7`, `types-networkx==3.6.1.20261126`, and `httpx==0.28.1`.
- `Makefile`: Added POSIX targets `memory-init`, `memory-preload`, `memory-audit`, `memory-rollback`, and `memory-health`.
- `docs/memory.md`, `docs/memory-plan.md`, and `AGENTS.md`: Operator guide, full eight-group task tracker, and section 6 reference entry.

### 3.3 Test Suites

- Layer 1 unit tests in `packages/memory-graph/tests/` with 20 tests passing on ephemeral `surrealkv://` stores and zero model calls:
  - `test_memory_schema_and_isolation.py`
  - `test_conceptnet_pipeline.py` with `tests/fixtures/conceptnet_sample.tsv`
  - `test_write_gate_and_rollback.py`
  - `test_litellm_client.py`
  - `test_retrieval_and_budget.py`
  - `test_maintenance_and_decay.py`
  - `test_bridge_and_mcp.py`
  - `test_memory_cli.py`
- Layer 2 and Layer 3 `@pytest.mark.integration` tests in `tests/integration/` with 7 tests collected and static checks passing, live execution skipped:
  - `test_memory_models.py`
  - `test_memory_retrieval_live.py`
  - `test_memory_maintenance_live.py`
  - `test_memory_engine_bridge.py`
  - `test_memory_pi_bridge.py`

## 4 Verification Summary

All checks below exited with code 0 on the final code:
- `./bin/check-agent-docs.sh`: `PASS: agent configuration is valid`
- `vale --config .config/vale/vale.ini docs/memory.md docs/memory-plan.md AGENTS.md`: `0 errors, 0 warnings and 0 suggestions`
- `taplo check --no-schema` and `taplo fmt --check`: passed on all three `pyproject.toml` files
- `bin/check-comments.py` and `bin/check-file-length.py`: passed on all memory and bridge files
- `ruff format --check` and `ruff check`: `38 files already formatted` and `All checks passed!`
- `pyright`: `0 errors, 0 warnings, 0 informations`
- `pytest --collect-only -q tests/integration/test_memory_*.py`: `7 tests collected in 0.94s`
- `pytest -q packages/memory-graph/tests`: `20 passed in 65.64s`

## 5 Cutover Checklist For Next Session

1. Update `.agents/hooks.json` to use `../bin/agent-hook-antigravity.sh` so the hook path stays portable across machines.
2. Move or exclude the untracked `tree-of-life/` directory before you run full `make test-fast` or push.
3. Run `make setup` and `make up` to ensure `.env` and local LiteLLM `embed` and `decision` roles are active.
4. Run `LIVE_STRICT=1 uv run pytest tests/integration/test_memory_*.py` to verify all seven live Layer 2 and Layer 3 tests.
5. Run `make memory-init` and `make memory-preload INPUT=<path-to-conceptnet.tsv>` to seed the live SurrealKV database.
6. After live tests pass and the owner approves cutover, update `memory` in `.pi/mcp.json` and `.mcp.json` to `uv run python -m sosho_memory.mcp_server`. Then remove legacy `packages/memory/` and its legacy `tsx` test entries in `Makefile`, and check off the remaining boxes in `docs/memory-plan.md`.
