# Memory System Task Plan

Purpose: Detailed implementation plan and test plan for the `sosho` memory layer.

Status: Groups 1 through 8 code and Layer 1 tests complete. The memory layer is deferred until the owner approves it. Live model tests and legacy `packages/memory` cutover remain open until live stack verification runs.

## 1 Architecture Summary

The memory system serves an orchestrator and subagent workflow engine controlled from `pi`.

- Primary store: SurrealDB 4.0 with SurrealKV in embedded or local server mode.
- Pre-loaded ontology: Filtered English ConceptNet spine and lateral edges uploaded directly into SurrealDB.
- Two memory planes: One global `user_memory` graph and one isolated `project_<id>` graph per project.
- Precedence rule: When a project rule conflicts with a general user preference, the project rule wins inside that project.
- Model routing: Send every `embed` and `decision` call directly through the LiteLLM proxy on the Central Processing Unit.
- Write model: Both the coordinator and subagents write directly with mandatory agent and session tags.
- Safety and control: Reject secrets before storage, and log every write for rollback by transaction or session.

## 2 Core Invariants

Every task group must preserve these invariants:

- Do not call a provider or `llama.cpp` directly. Route `embed` and `decision` through LiteLLM.
- Do not add a second chat call path beside `pi`.
- Do not wake the Graphics Processing Unit for memory operations.
- Do not weaken tests or use fake `embed`, fake `decision`, or fake `pi` doubles.
- Keep `make test-fast` free of model calls, network calls, and live services.
- Keep every file at 1000 lines or fewer and every function at 60 lines or fewer.
- Pin every new dependency to one exact stable version.

## 3 Task Groups

### Group 1: Package Scaffold and SurrealDB 4.0 Schema

Goal: Create the memory package, validated startup configuration, and temporal two-graph SurrealDB 4.0 schema.

Tasks:
- [x] Define the package layout and typed Pydantic configuration boundary.
- [x] Pin SurrealDB 4.0 client and SurrealKV runtime dependencies to exact versions.
- [x] Configure two isolated SurrealDB scopes: `user_memory` and `project_<id>`.
- [x] Define node tables: `entity`, `concept`, `preference`, `error`, `fix`, and `episode`.
- [x] Define approved ConceptNet edge tables: `IsA`, `PartOf`, `UsedFor`, `Causes`, `HasPrerequisite`, and `Antonym`.
- [x] Define approved workflow edge tables: `PrefersOver`, `FixedBy`, `ViolatesRule`, `Supersedes`, and `DependsOn`.
- [x] Add temporal and provenance fields to every node and edge: `valid_from`, `valid_to`, `confidence`, `agent_id`, `agent_role`, `session_id`, and `timestamp`.
- [x] Create HNSW vector indexes and BM25 full-text indexes on searchable content fields.
- [x] Create the append-only `audit_log` table with transaction and session indexes.
- [x] Fail fast at startup when configuration is invalid or SurrealKV fails to open.

Collective tests for Layer 1 in `make test-fast`:
- [x] `test_memory_schema_and_isolation.py`: Initialize an ephemeral SurrealKV store and verify node and edge round-trips. Verify `user_memory` and `project_<id>` isolation and startup failure on bad config.

### Group 2: Filtered English ConceptNet Pipeline and Graph Pre-Load

Goal: Port `tree-of-life` ConceptNet filters and spine logic, then pre-load the filtered ontology into SurrealDB.

Tasks:
- [x] Port English `/c/en/` extraction and maximum-weight deduplication ported from the external tree-of-life project.
- [x] Port noun filtering and clean-term rules ported from the external tree-of-life project.
- [x] Port degree pruning and objective versus lateral split ported from the external tree-of-life project.
- [x] Port abstractness scoring, strict Directed Acyclic Graph creation, `nx.transitive_reduction`, canonical parent selection, and root merge ported from the external tree-of-life project.
- [x] Build an idempotent bulk loader that uploads the filtered ConceptNet spine and lateral edges directly into SurrealDB.
- [x] Record dataset version and filter parameters in a graph metadata table so repeated loads skip unchanged data.

Collective tests for Layer 1 in `make test-fast`:
- [x] `test_conceptnet_pipeline.py`: Run the full pipeline on a committed small ConceptNet fixture with cycles and noisy nodes. Verify English-only output, cycle removal, `transitive_reduction`, canonical single-parent spine, and idempotent re-upload into SurrealKV.

### Group 3: Write Gate, Secret Redaction, Agent Tags, and Audit Rollback

Goal: Support safe direct writes from the coordinator and subagents with secret rejection and full rollback.

Tasks:
- [x] Build a pre-write secret gate that rejects tokens, private keys, and `.env` patterns before storage or vector index updates.
- [x] Require `agent_id`, `agent_role`, `session_id`, and `timestamp` on every write payload.
- [x] Enforce the approved relation allowlist at write time and return a typed error for unknown edge types.
- [x] Write an append-only `audit_log` entry inside the same SurrealQL transaction as each graph mutation.
- [x] Implement atomic rollback by `transaction_id` to undo one write.
- [x] Implement atomic rollback by `session_id` to undo all writes from one coordinator or subagent run.
- [x] Add a human-readable audit log export for inspection of recent automatic edits.
- [x] Verify concurrent coordinator and subagent writes on SurrealKV without lock corruption.

Collective tests for Layer 1 in `make test-fast`:
- [x] `test_write_gate_and_rollback.py`: Run concurrent coordinator and subagent writes. Verify secret rejection and mandatory agent tags on all records. Verify exact graph restoration after transaction rollback and session rollback.

### Group 4: LiteLLM Central Processing Unit Client and Automatic Ontology Growth

Goal: Connect real LiteLLM `embed` and `decision` roles and port middle-out automatic ontology growth.

Tasks:
- [x] Implement a typed LiteLLM client for `embed` and `decision` roles with strict timeout and error handling.
- [x] Port middle-out concept disambiguation and unknown-term parent attachment ported from the external tree-of-life project, with Ollama replaced by LiteLLM.
- [x] Implement temporal contradiction resolution with the `decision` role: close `valid_to` on the superseded edge, add the new edge, and link them with `Supersedes`.
- [x] Implement automatic post-task curation that extracts candidate facts, preferences, errors, and fixes from task outputs.
- [x] Reject automatic creation of new edge types outside the approved ConceptNet and workflow relation lists.

Collective tests for Layer 2 with `@pytest.mark.integration` in `make test`:
- [ ] `tests/integration/test_memory_models.py`: Run the memory package alone against live local LiteLLM `embed` and `decision` models. Verify vector dimensions match the SurrealDB index and verify real contradiction closure. Verify unknown technical terms attach to approved parents and verify the Graphics Processing Unit stays idle.

### Group 5: Hybrid Retrieval, Subgraph Compression, and Failure Defenses

Goal: Eliminate forgotten preferences, repeated past errors, and bloated context windows with bounded hybrid retrieval.

Tasks:
- [x] Implement single-transaction SurrealQL hybrid queries that combine HNSW vector search, BM25 full-text search, and multi-hop `RELATE` traversal.
- [x] Merge `user_memory` and `project_<id>` query results with project-over-user precedence on conflicts.
- [x] Rank active user preferences at highest priority so turn-start context always includes matched preferences.
- [x] Query linked `error` and `FixedBy` nodes before tool execution or module edits to block repeated past errors.
- [x] Port shortest-path subgraph decomposition ported from the external tree-of-life project.
- [x] Enforce a hard token budget per prompt block and render compact structured paths instead of raw transcripts.
- [x] Provide an on-demand graph-expand query so `pi` fetches deeper hops only when needed.

Collective tests for Layer 1 and Layer 2:
- [x] `test_retrieval_and_budget.py`: Run in Layer 1 under `make test-fast`. Verify two-graph precedence, path compression, and strict token budget limits on deterministic graph fixtures.
- [ ] `tests/integration/test_memory_retrieval_live.py`: Run in Layer 2 under `@pytest.mark.integration`. Verify live hybrid recall, preference ranking, and proactive `FixedBy` error retrieval with real local `embed` and `decision` models.

### Group 6: Background Maintenance, Consolidation, and Decay

Goal: Keep the user graph and project graphs compact, deduplicated, and accurate over long usage.

Tasks:
- [x] Detect near-duplicate nodes during idle maintenance with `embed` vector similarity and `decision` verification.
- [x] Merge confirmed duplicate nodes safely: rewire incident edges, preserve provenance, and log the merge in `audit_log`.
- [x] Promote repeated `episode` error-fix patterns into durable procedural `fix` rules.
- [x] Apply time-based rank decay to unused low-weight edges while preserving full audit history.
- [x] Expose a graph health summary with node counts, edge counts, and orphan stats.

Collective tests for Layer 1 and Layer 2:
- [x] `test_maintenance_and_decay.py`: Run in Layer 1 under `make test-fast`. Verify decay calculations, safe edge rewiring, and audit preservation on deterministic fixtures.
- [ ] `tests/integration/test_memory_maintenance_live.py`: Run in Layer 2 under `@pytest.mark.integration`. Verify duplicate node detection, merge, and episode consolidation with real local `embed` and `decision` models.

### Group 7: Engine and `pi` Bridge Integration

Goal: Connect the memory package to `packages/engine` workflows and real `pi` sessions without a second chat call path.

Tasks:
- [x] Expose turn-start context injection for `pi` sessions. Give the orchestrator user preferences and high-level project state. Give subagents one-hop or two-hop task subgraphs and linked `FixedBy` errors.
- [x] Expose explicit memory tools to `pi` for on-demand graph expansion, direct tagged writes, and audit inspection.
- [x] Wire coordinator and subagent post-task write hooks in `packages/engine` with `agent_id`, `agent_role`, and `session_id` tags.
- [ ] Retire legacy `packages/memory` code and legacy `tsx` test entries once the new memory package passes all gates.

Collective tests for Layer 3 with `@pytest.mark.integration` in `make test`:
- [ ] `tests/integration/test_memory_engine_bridge.py`: Run a real coordinator and subagent workflow in `packages/engine` against a temporary SurrealKV store. Verify tagged writes from both roles and verify a second subagent retrieves an error fix written by the first subagent.
- [ ] `tests/integration/test_memory_pi_bridge.py`: Run two sequential real `pi` sessions on the same project with local models only. Verify preference recall, past error avoidance, token budget compliance, and clean audit rollback.

### Group 8: Operations, Standards, and Final Cutover

Goal: Pass every repository gate and document local setup for macOS and Linux x86_64.

Tasks:
- [x] Add `Makefile` targets for SurrealKV store initialization, ConceptNet pre-load, and audit rollback commands.
- [x] Verify every script runs on macOS and Linux x86_64 with POSIX tools only.
- [x] Verify zero disallowed comments, file length limits, strict typing, and pinned lockfiles.
- [x] Update `AGENTS.md` section 6 and `docs/` links once the memory layer is active.
- [ ] Run full `make test-fast` and full `make test` with `LIVE_STRICT=1` on the local stack.

Collective tests for all layers:
- [ ] `make test-fast`: Exit code 0 with all Layer 1 unit tests, linters, type checks, and hook checks green.
- [ ] `LIVE_STRICT=1 make test`: Exit code 0 with all Layer 1, Layer 2, and Layer 3 tests green against local models only.

## 4 Verification Matrix

| Layer | Marker or Command | Models Used | Scope Tested |
| :--- | :--- | :--- | :--- |
| Layer 1 | `make test-fast` | None | Schema, ConceptNet filters, spine reduction, isolation, write gate, tags, rollback, token budget, decay math |
| Layer 2 | `@pytest.mark.integration` in `make test` | Real local LiteLLM `embed` and `decision` | Isolated memory package: real vectors, contradiction closure, ontology growth, hybrid recall, maintenance |
| Layer 3 | `@pytest.mark.integration` in `make test` | Real local models and real `pi` | End-to-end bridge: `packages/engine` coordinator and subagents, multi-session `pi` recall, rollback |
