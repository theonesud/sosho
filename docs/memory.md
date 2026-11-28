# Memory Guide

Purpose: Architecture, operations guide, implementation state, and cutover plan for `sosho-memory` in `packages/memory-graph`.

Read when: You edit `packages/memory-graph` or memory bridge code.

## 1 Current State

- Date of this state: 2026-11-28. Branch: `refactor`.
- Package: `packages/memory-graph` with version `sosho-memory==0.1.0`, and engine adapter `packages/engine/src/sosho_engine/memory_bridge.py`.
- All eight implementation groups and all 20 Layer 1 offline unit tests in `packages/memory-graph/tests/` are complete. They pass `make test-fast` with zero model calls.
- Seven live Layer 2 and Layer 3 integration tests in `tests/integration/test_memory_*.py` wait for a live stack run with owner approval.
- Legacy `packages/memory` and its `.mcp.json` and `.pi/mcp.json` entries stay intact until the live integration tests pass and the owner approves cutover.

## 2 Two-Graph Architecture

`sosho-memory` stores graph memory on SurrealDB 4.0 with SurrealKV in `surrealdb[embedded]==3.0.0`.

- `MemorySettings` isolates one global `user_memory` database and one `project_<id>` database per project.
- Node tables store `entity`, `concept`, `preference`, `error`, `fix`, and `episode` records.
- Approved ConceptNet edge tables: `IsA`, `PartOf`, `UsedFor`, `Causes`, `HasPrerequisite`, and `Antonym`.
- Approved workflow edge tables: `PrefersOver`, `FixedBy`, `ViolatesRule`, `Supersedes`, and `DependsOn`.
- Every node and edge carries `valid_from`, `valid_to`, `confidence`, `agent_id`, `agent_role`, `session_id`, and `timestamp`.
- If a `project_<id>` rule conflicts with a `user_memory` preference, the `project_<id>` rule wins inside that project.
- Pre-loaded ontology: English `/c/en/` ConceptNet filter, noun filter, degree pruning, abstractness scoring, strict Directed Acyclic Graph reduction with `nx.transitive_reduction`, and canonical single-parent spine loader.

## 3 LiteLLM Model Calls and Invariants

`LiteLLMClient` sends every `embed` and `decision` request through the LiteLLM proxy.

- Keep `embed` and `decision` on the central processing unit.
- Never wake the graphics processing unit for memory operations.
- Never call a provider or `llama.cpp` directly.
- Never add a second chat call path beside `pi`.

## 4 Safety Gates, Retrieval, and Maintenance

- Write gates validate every mutation before storage or vector index updates:
  - `assert_no_secrets` rejects secret patterns in node keys, labels, content, and edge keys.
  - `validate_relation_name` allows only approved ConceptNet and workflow relations.
  - `validate_write_provenance` requires `agent_id`, `agent_role`, `session_id`, and timezone-aware `timestamp` fields.
  - Each write appends one `audit_log` entry inside the same Surreal Query Language transaction.
  - Atomic rollback restores prior graph state by `transaction_id` or by `session_id`.
- Hybrid retrieval combines HNSW vector search, BM25 full-text search, and multi-hop `RELATE` traversal in one transaction. SurrealDB 4.0 rejects HNSW `<|k, ef|>` operators inside `OR` clauses, so `surreal_queries.py` runs separate HNSW and BM25 subqueries in one transaction.
- Subgraph compression decomposes retrievals into shortest paths within a hard token budget. Active user preferences rank highest. The retriever queries linked `error` and `FixedBy` nodes before edits.
- `GraphMaintenanceService` detects duplicate candidates with `embed` similarity and `decision` verification, merges duplicates with edge rewiring, consolidates repeated episodes into `fix` rules, and applies exponential decay to unused edges.

## 5 MCP Server, Engine Bridge, and CLI Commands

Run `python -m sosho_memory.mcp_server` over standard input and output to expose tools for `pi`.

| Tool | Purpose |
| :--- | :--- |
| `memory_context` | Retrieve ranked user and project context within a token budget. |
| `memory_expand` | Expand a subgraph around one node and return compressed paths. |
| `memory_write_node` | Write an audited memory node after secret and provenance checks. |
| `memory_write_edge` | Write an audited memory edge with an approved relation name. |
| `memory_audit` | Export `audit_log` entries for a session or a transaction. |
| `memory_rollback` | Undo mutations for one `transaction_id` or `session_id`. |

`sosho_engine.memory_bridge` connects `MemoryBridge` to `packages/engine` workflows with `inject_engine_memory_context` and `register_memory_tools`.

Local operations commands in `Makefile`:

| Command | Purpose |
| :--- | :--- |
| `make memory-init` | Initialize the SurrealKV store and graph scopes. |
| `make memory-preload` | Load the filtered English ConceptNet spine and lateral edges with `INPUT=<path>`. |
| `make memory-audit` | Export recent `audit_log` entries for inspection. |
| `make memory-rollback` | Undo mutations for one `transaction_id` or `session_id`. |
| `make memory-health` | Print node counts, edge counts, and orphan counts. |

## 6 Verification Layers and Cutover Checklist

| Layer | Command | Models Used | Scope |
| :--- | :--- | :--- | :--- |
| Layer 1 | `make test-fast` | None | Schema, ConceptNet filters, spine reduction, isolation, write gate, tags, rollback, token budget, decay math in `packages/memory-graph/tests/` |
| Layer 2 | `LIVE_STRICT=1 uv run pytest tests/integration/test_memory_*.py` | Local `embed` and `decision` | Real vectors, contradiction closure, ontology growth, hybrid recall, maintenance |
| Layer 3 | `LIVE_STRICT=1 uv run pytest tests/integration/test_memory_*_bridge.py` | Local models and real `pi` | End-to-end engine and multi-session `pi` recall and rollback |

Cutover steps when the owner approves live verification:

1. Run `make up` so local LiteLLM `embed` and `decision` roles are active.
2. Run `LIVE_STRICT=1 uv run pytest tests/integration/test_memory_*.py` to verify all seven Layer 2 and Layer 3 integration tests.
3. Run `make memory-init` and `make memory-preload INPUT=<path-to-conceptnet.tsv>` to seed the live SurrealKV store.
4. Update `memory` in `.pi/mcp.json`, `.mcp.json`, `.agents/mcp_config.json`, and `opencode.json` to `uv run python -m sosho_memory.mcp_server`.
5. Remove legacy `packages/memory/` and its legacy `tsx` test entries in `Makefile`.
