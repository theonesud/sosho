---
name: graphify
description: Codebase architecture, file/symbol relationships, call paths, or impact analysis using local knowledge graph at graphify-out/graph.json.
---

# Graphify Skill Guide

AST & semantic knowledge graph (clusters, central god-nodes, call paths, honesty tags: `EXTRACTED`, `INFERRED`, `AMBIGUOUS`).
Runner: `PYTHON="$(pwd)/.pi/venv-graphify/bin/python"`

## 1. When to Use
- **Codebase Questions**: Query graph before reading full files/recursive grepping if `graphify-out/graph.json` exists.
- **Impact / Refactoring**: Run `path` or `explain` to find upstream callers & dependents before altering signatures.
- **Architecture**: Query clusters, call-flows, and high-degree god-nodes.

## 2. CLI Workflows
```bash
# Query existing graph
$PYTHON -m graphify query "<question>" [--budget 1500]       # BFS contextual exploration
$PYTHON -m graphify query "<question>" --dfs                # DFS execution trace / data flow
$PYTHON -m graphify path "<SymbolA>" "<SymbolB>"            # Shortest relationship path
$PYTHON -m graphify explain "<SymbolOrFile>" [--all]        # Node neighborhood & callers

# Extract & Update
$PYTHON -m graphify extract . --code-only --no-cluster      # Fast AST-only (no LLM needed)
OPENAI_BASE_URL=http://127.0.0.1:8080/v1 OPENAI_MODEL=Qwen3.6-35B-A3B \
  $PYTHON -m graphify extract . --backend openai --mode deep # Semantic extraction with local LLM
$PYTHON -m graphify extract . --code-only --force          # Force re-scan
$PYTHON -m graphify extract . --cluster-only               # Re-cluster only

# Watch & Ingestion
$PYTHON -m graphify . --watch                              # Background auto-rebuild
$PYTHON -m graphify add <url> [--author "Author"]          # Ingest URL docs into graph
```

## 3. Visualizations & Exports (reads `graphify-out/graph.json`)
```bash
$PYTHON -m graphify export html --graph graphify-out/graph.json --out graphify-out/graph.html # Force graph UI
$PYTHON -m graphify tree --graph graphify-out/graph.json --output graphify-out/GRAPH_TREE.html # Hierarchy tree UI
$PYTHON -m graphify export callflow-html --graph graphify-out/graph.json                       # Mermaid call-flow
$PYTHON -m graphify export obsidian --dir ~/vaults/project-graph                               # Obsidian vault + canvas
$PYTHON -m graphify export wiki                                                                # Community wiki
$PYTHON -m graphify export graphml                                                             # Gephi format
$PYTHON -m graphify export neo4j-push bolt://localhost:7687                                    # Neo4j
$PYTHON -m graphify export falkordb-push falkordb://localhost:6379                             # FalkorDB
```

## 4. MCP Tools (`.pi/mcp.json`)
| Tool | Purpose | Args |
|:---|:---|:---|
| `query_graph` | Graph semantic search | `{"question": "...", "token_budget": 1500, "search_type": "bfs"\|"dfs"}` |
| `find_path` | Trace node relationships | `{"source": "...", "target": "...", "directed": true}` |
| `explain_node` | Inward/outward edges | `{"node_id": "...", "limit": 20}` |
| `graph_stats` | Nodes, communities, density | `{}` |
| `list_communities` | Architectural clusters | `{}` |
| `community_summary`| Cluster summary | `{"community_id": ...}` |

## 5. Output Files
- `graphify-out/graph.json`: Serialized graph (nodes, edges, clusters).
- `graphify-out/GRAPH_REPORT.md`: Architecture summary, god nodes, community map.
- `graphify-out/manifest.json`: Incremental hash cache.
- `graphify-out/graph.html`: Standalone browser visualization.
