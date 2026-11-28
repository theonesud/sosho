# Memory Guide

Purpose: Architecture and operations guide for sosho-memory.

Read when: You edit packages/memory-graph or memory bridge code.

## 1 Two Graph Architecture

`sosho-memory` stores graph memory on SurrealDB 4.0 with SurrealKV.

- `MemorySettings` isolates one global `user_memory` database and one `project_<id>` database per project.
- Node tables store `entity`, `concept`, `preference`, `error`, `fix`, and `episode` records.
- Edge tables store approved ConceptNet relations and workflow relations with `valid_from` and `valid_to` timestamps.
- If a `project_<id>` rule conflicts with a `user_memory` preference, the `project_<id>` rule wins.

## 2 LiteLLM Model Calls

`LiteLLMClient` sends every `embed` and `decision` request through the LiteLLM proxy.

- Keep `embed` and `decision` on the Central Processing Unit.
- Never wake the Graphics Processing Unit for memory operations.
- Never call a provider or `llama.cpp` directly.
- Never add a second chat call path beside `pi`.

## 3 Safety Gates and Audit

Write gates validate every mutation before storage or vector index updates.

- `assert_no_secrets` rejects secret patterns in node keys, labels, content, and edge keys.
- `validate_relation_name` allows only approved ConceptNet and workflow relations.
- `validate_write_provenance` requires `agent_id`, `agent_role`, `session_id`, and timezone aware `timestamp` fields.
- Each write appends one `audit_log` entry inside the same Surreal Query Language transaction.
- Rollback restores prior graph state by `transaction_id` or by `session_id`.

## 4 Model Context Protocol Server and Engine Bridge

Run `python -m sosho_memory.mcp_server` over standard input and output to expose tools for `pi`.

| Tool | Purpose |
| :--- | :--- |
| `memory_context` | Retrieve ranked user and project context within a token budget. |
| `memory_expand` | Expand a subgraph around one node and return compressed paths. |
| `memory_write_node` | Write an audited memory node after secret and provenance checks. |
| `memory_write_edge` | Write an audited memory edge with an approved relation name. |
| `memory_audit` | Export `audit_log` entries for a session or a transaction. |
| `memory_rollback` | Undo mutations for one `transaction_id` or `session_id`. |

`sosho_engine.memory_bridge` connects `MemoryBridge` to `packages/engine` workflows.

- `inject_engine_memory_context` adds `[MEMORY CONTEXT]` blocks to coordinator and subagent instructions.
- `register_memory_tools` registers `memory_context`, `memory_expand`, `memory_write_node`, `memory_write_edge`, and `memory_audit`.

## 5 Local Operations Commands

These targets exist in the Makefile for macOS and Linux x86_64 hosts.

| Command | Purpose |
| :--- | :--- |
| `make memory-init` | Initialize the SurrealKV store and graph scopes. |
| `make memory-preload` | Load the filtered English ConceptNet spine and lateral edges. |
| `make memory-audit` | Export recent `audit_log` entries for inspection. |
| `make memory-rollback` | Undo mutations for one `transaction_id` or `session_id`. |
| `make memory-health` | Print node counts, edge counts, and orphan counts. |

## 6 Test Layers

Memory tests follow three verification layers.

- Layer 1 unit tests run under `make test-fast` with no model, network, or live service calls.
- Layer 2 tests use `@pytest.mark.integration` to test `sosho-memory` against local `embed` and `decision` models.
- Layer 3 tests use `@pytest.mark.integration` to test `packages/engine` and `pi` workflows together.
- Run `LIVE_STRICT=1 make test` to fail when a required local service does not answer.
