---
name: graphify
description: Use whenever asked about codebase architecture, file/symbol relationships, dependency paths, or impact analysis. Interacts with the local knowledge graph at graphify-out/graph.json.
---

# Graphify Skill Guide

Graphify provides a structured AST & semantic knowledge graph of the codebase with community detection, god-node detection, call paths, and honesty tags (`EXTRACTED`, `INFERRED`, `AMBIGUOUS`).

Target runner:
```bash
PYTHON="$(pwd)/.pi/venv-graphify/bin/python"
```

---

## 1. When to Use (Agent Decision Rules)
- **Codebase Questions**: If `graphify-out/graph.json` exists, run a graph query **before** reading entire files or doing recursive greps.
- **Impact Analysis / Refactoring**: Use `path` or `explain` to find upstream callers and downstream dependents before modifying functions or contracts.
- **Architecture Overview**: Query community clusters, call-flows, and god-nodes (central symbols with high degree centrality).

---

## 2. CLI Workflows

### Fast-Path: Querying Existing Graph
- **Broad contextual exploration (BFS)**:
  ```bash
  $PYTHON -m graphify query "<question>" [--budget 1500]
  ```
- **Deep execution trace / data flow (DFS)**:
  ```bash
  $PYTHON -m graphify query "<question>" --dfs
  ```
- **Shortest relationship path between two concepts or files**:
  ```bash
  $PYTHON -m graphify path "<SymbolA>" "<SymbolB>" [--directed|--undirected]
  ```
- **Explain a node and its neighborhood (top connections & callers)**:
  ```bash
  $PYTHON -m graphify explain "<SymbolOrFile>" [--all]
  ```

### Building & Updating the Graph
- **Code-only AST extraction (Fast, no API key required)**:
  ```bash
  $PYTHON -m graphify extract . --code-only --no-cluster
  ```
- **Semantic / Deep extraction with local LLM (llama.cpp)**:
  ```bash
  OPENAI_BASE_URL=http://127.0.0.1:8080/v1 OPENAI_MODEL=Qwen3.6-35B-A3B \
  $PYTHON -m graphify extract . --backend openai --mode deep
  ```
- **Force full re-scan**:
  ```bash
  $PYTHON -m graphify extract . --code-only --force
  ```
- **Re-run community detection & clustering only**:
  ```bash
  $PYTHON -m graphify extract . --cluster-only
  ```

### Live Watch Mode & Web Additions
- **Continuous auto-rebuild on file changes (background task)**:
  ```bash
  $PYTHON -m graphify . --watch
  ```
- **Ingest external URL/documentation into corpus**:
  ```bash
  $PYTHON -m graphify add <url> [--author "AuthorName"]
  ```

---

## 3. Visualizations & Artifact Exports
All exports read from `graphify-out/graph.json`:
- **Interactive Force Graph UI**:
  ```bash
  $PYTHON -m graphify export html --graph graphify-out/graph.json --out graphify-out/graph.html
  ```
- **Collapsible Hierarchy Tree UI**:
  ```bash
  $PYTHON -m graphify tree --graph graphify-out/graph.json --output graphify-out/GRAPH_TREE.html
  ```
- **Mermaid Call-Flow Architecture Diagrams**:
  ```bash
  $PYTHON -m graphify export callflow-html --graph graphify-out/graph.json
  ```
- **Obsidian Markdown Vault with Canvas**:
  ```bash
  $PYTHON -m graphify export obsidian --dir ~/vaults/project-graph
  ```
- **Knowledge Wiki (one article per detected community)**:
  ```bash
  $PYTHON -m graphify export wiki
  ```
- **Standard Graph Formats (Gephi, Neo4j, FalkorDB)**:
  ```bash
  $PYTHON -m graphify export graphml
  $PYTHON -m graphify export neo4j-push bolt://localhost:7687
  $PYTHON -m graphify export falkordb-push falkordb://localhost:6379
  ```

---

## 4. MCP Tools Reference (`.pi/mcp.json`)
When Pi connects through MCP (`graphify_*`), prefer structured tool calls:

| Tool | Purpose | Key Arguments |
| :--- | :--- | :--- |
| `query_graph` | Graph-augmented semantic search | `{"question": "...", "token_budget": 1500, "search_type": "bfs"\|"dfs"}` |
| `find_path` | Trace relationships between 2 nodes | `{"source": "...", "target": "...", "directed": true}` |
| `explain_node` | Inspect inward/outward edges of symbol | `{"node_id": "...", "limit": 20}` |
| `graph_stats` | Overview of node counts, communities & density | `{}` |
| `list_communities` | Inspect high-level architectural clusters | `{}` |
| `community_summary` | Summary of a specific architecture cluster | `{"community_id": ...}` |

---

## 5. Output Files & Layout
- `graphify-out/graph.json`: Full serialized knowledge graph (nodes, edges, clusters, centralities).
- `graphify-out/GRAPH_REPORT.md`: Auto-generated executive architecture summary, god nodes, and community map.
- `graphify-out/manifest.json`: Incremental state cache tracking hashed file signatures.
- `graphify-out/graph.html`: Standalone browser visualization (open with browser or `xdg-open`).
