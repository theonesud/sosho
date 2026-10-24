---
name: graphify
description: "Query and explore codebase architecture, relationships, and knowledge graphs using local Graphify tools."
---

# Graphify Cheat Sheet for Pi

Use Graphify to understand codebase architecture, find symbol relationships, query call paths, or update the graph. The graph is stored locally in `graphify-out/graph.json`.

Python runner for all commands:
```bash
PYTHON="$(pwd)/.pi/venv-graphify/bin/python"
```

---

## 1. Querying the Codebase (Fast Path)
Always use these when answering architecture or relationship questions:

- **Ask a broad question (BFS traversal)**:
  ```bash
  $PYTHON -m graphify query "<question>"
  ```
- **Trace a deep execution path (DFS)**:
  ```bash
  $PYTHON -m graphify query "<question>" --dfs
  ```
- **Find the shortest path between two modules/symbols**:
  ```bash
  $PYTHON -m graphify path "<SymbolA>" "<SymbolB>"
  ```
- **Explain a specific node/class/function and its connections**:
  ```bash
  $PYTHON -m graphify explain "<SymbolOrFile>"
  ```

---

## 2. Updating & Building the Graph

- **Incremental update (only re-index modified files)**:
  ```bash
  $PYTHON -m graphify extract . --code-only --no-cluster
  ```
- **Full re-scan from scratch**:
  ```bash
  $PYTHON -m graphify extract . --code-only --no-cluster --force
  ```

---

## 3. Generating Visualizations & Reports

- **Interactive 2D/3D Force Graph (`graph.html`)**:
  ```bash
  $PYTHON -m graphify export html --graph graphify-out/graph.json --out graphify-out/graph.html
  ```
- **Collapsible Hierarchy Tree (`GRAPH_TREE.html`)**:
  ```bash
  $PYTHON -m graphify tree --graph graphify-out/graph.json --output graphify-out/GRAPH_TREE.html
  ```
- **Mermaid Architecture / Call-Flow Summary**:
  ```bash
  $PYTHON -m graphify export callflow-html --graph graphify-out/graph.json
  ```
- **Export to Obsidian / Gephi**:
  ```bash
  $PYTHON -m graphify export obsidian --dir ~/vaults/codebase
  $PYTHON -m graphify export graphml
  ```

---

## 4. MCP Tools Reference (Stdio)
If calling via Pi MCP tools (`graphify_*`), use:
- `graph_stats`: Overview of node count, communities, and density.
- `query_graph`: Natural language search with `{"question": "...", "token_budget": 1500}`.
- `find_path`: Trace relations with `{"source": "...", "target": "..."}`.
- `explain_node`: Inspect node neighbors with `{"node_id": "..."}`.
