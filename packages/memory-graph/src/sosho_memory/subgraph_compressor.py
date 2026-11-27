from __future__ import annotations

import itertools
from collections import deque
from collections.abc import Sequence

import networkx as nx

from sosho_memory.models import MemoryEdge, NodeKind
from sosho_memory.retrieval_models import (
    CompressedPath,
    ContextPack,
    ErrorFixPair,
    ScoredNode,
)


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def merge_two_graph_nodes(
    user_nodes: Sequence[ScoredNode],
    project_nodes: Sequence[ScoredNode],
) -> tuple[ScoredNode, ...]:
    active_project = [item for item in project_nodes if item.node.provenance.valid_to is None]
    active_user = [item for item in user_nodes if item.node.provenance.valid_to is None]
    project_identities = {(item.node.kind, item.node.key) for item in active_project}
    project_pref_labels = {
        item.node.label.strip().lower()
        for item in active_project
        if item.node.kind is NodeKind.PREFERENCE
    }
    merged: list[ScoredNode] = list(active_project)
    for item in active_user:
        if (item.node.kind, item.node.key) in project_identities:
            continue
        if (
            item.node.kind is NodeKind.PREFERENCE
            and item.node.label.strip().lower() in project_pref_labels
        ):
            continue
        merged.append(item)
    merged.sort(
        key=lambda item: (
            0 if item.node.kind is NodeKind.PREFERENCE else 1,
            -item.score,
            item.node.kind.value,
            item.node.key,
        )
    )
    return tuple(merged)


def _build_weighted_graph(
    edges: Sequence[MemoryEdge],
) -> tuple[nx.Graph[str], dict[frozenset[str], tuple[float, str]]]:
    graph: nx.Graph[str] = nx.Graph()
    edge_meta: dict[frozenset[str], tuple[float, str]] = {}
    for edge in edges:
        if edge.provenance.valid_to is not None:
            continue
        source = f"{edge.source_kind.value}:{edge.source_key}"
        target = f"{edge.target_kind.value}:{edge.target_key}"
        if source == target:
            continue
        cost = 1.0 / max(edge.weight, 0.01)
        pair = frozenset((source, target))
        existing = edge_meta.get(pair)
        if existing is None or cost < existing[0]:
            edge_meta[pair] = (cost, edge.relation.value)
            graph.add_edge(source, target, cost=cost)
    return graph, edge_meta


def _resolve_seed_nodes(seed_keys: Sequence[str], graph: nx.Graph[str]) -> list[str]:
    bare_to_nodes: dict[str, list[str]] = {}
    for node_id in sorted(graph.nodes()):
        bare_key = node_id.split(":", 1)[1] if ":" in node_id else node_id
        bare_to_nodes.setdefault(bare_key, []).append(node_id)
    resolved: dict[str, None] = {}
    for seed in seed_keys:
        if seed in graph:
            resolved[seed] = None
            continue
        for node_id in bare_to_nodes.get(seed, ()):
            resolved[node_id] = None
    return list(resolved)


def _collect_shortest_path_edges(
    graph: nx.Graph[str],
    seeds: Sequence[str],
) -> set[tuple[str, str]]:
    edges_in_paths: set[tuple[str, str]] = set()
    for start, end in itertools.combinations(seeds, 2):
        try:
            path = nx.dijkstra_path(graph, source=start, target=end, weight="cost")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            continue
        for idx in range(len(path) - 1):
            edges_in_paths.add((path[idx], path[idx + 1]))
    return edges_in_paths


def _bfs_farthest_path(graph: nx.Graph[str], start: str) -> list[str]:
    parent: dict[str, str | None] = {start: None}
    queue: deque[str] = deque([start])
    last_node = start
    while queue:
        current = queue.popleft()
        last_node = current
        for neighbor in sorted(graph.neighbors(current)):
            if neighbor not in parent:
                parent[neighbor] = current
                queue.append(neighbor)
    path: list[str] = []
    cursor: str | None = last_node
    while cursor is not None:
        path.append(cursor)
        cursor = parent[cursor]
    path.reverse()
    return path


def _find_longest_diameter_path(subgraph: nx.Graph[str]) -> list[str]:
    longest_path: list[str] = []
    for component in nx.connected_components(subgraph):
        sub = subgraph.subgraph(component)
        if sub.number_of_edges() == 0:
            continue
        start_node = min(component)
        farthest_node = _bfs_farthest_path(sub, start_node)[-1]
        candidate = _bfs_farthest_path(sub, farthest_node)
        if len(candidate) > len(longest_path):
            longest_path = candidate
    return longest_path


def _format_compressed_path(
    path: Sequence[str],
    edge_meta: dict[frozenset[str], tuple[float, str]],
) -> CompressedPath:
    relations: list[str] = []
    parts: list[str] = [path[0]]
    total_cost = 0.0
    for idx in range(len(path) - 1):
        cost, relation = edge_meta[frozenset((path[idx], path[idx + 1]))]
        relations.append(relation)
        total_cost += cost
        parts.append(f"--[{relation}]--> {path[idx + 1]}")
    return CompressedPath(
        nodes=tuple(path),
        relations=tuple(relations),
        total_cost=total_cost,
        rendered=" ".join(parts),
    )


def extract_compressed_paths(
    seed_keys: Sequence[str],
    edges: Sequence[MemoryEdge],
    *,
    max_paths: int = 5,
) -> tuple[CompressedPath, ...]:
    if max_paths <= 0:
        return ()
    graph, edge_meta = _build_weighted_graph(edges)
    seeds = _resolve_seed_nodes(seed_keys, graph)
    if len(seeds) < 2:
        return ()
    edges_in_paths = _collect_shortest_path_edges(graph, seeds)
    if not edges_in_paths:
        return ()
    subgraph: nx.Graph[str] = nx.Graph()
    subgraph.add_edges_from(edges_in_paths)
    compressed: list[CompressedPath] = []
    while subgraph.number_of_edges() > 0:
        longest_path = _find_longest_diameter_path(subgraph)
        if len(longest_path) < 2:
            break
        compressed.append(_format_compressed_path(longest_path, edge_meta))
        for idx in range(len(longest_path) - 1):
            u, v = longest_path[idx], longest_path[idx + 1]
            if subgraph.has_edge(u, v):
                subgraph.remove_edge(u, v)
        subgraph.remove_nodes_from(list(nx.isolates(subgraph)))
    compressed.sort(key=lambda item: (item.total_cost, item.rendered))
    return tuple(compressed[:max_paths])


def _render_sections(section_lines: Sequence[tuple[str, Sequence[str]]]) -> str:
    blocks = [f"{header}\n" + "\n".join(lines) for header, lines in section_lines if lines]
    return "\n\n".join(blocks)


def _pack_sections(
    sections_spec: tuple[tuple[str, list[str]], ...],
    token_budget: int,
) -> tuple[list[list[int]], str, bool]:
    active_sections: list[tuple[str, list[str]]] = [(header, []) for header, _ in sections_spec]
    kept_indices: list[list[int]] = [[] for _ in sections_spec]
    rendered_text = ""
    truncated = False
    hard_clipped = False
    for sec_idx, (_, candidate_lines) in enumerate(sections_spec):
        if hard_clipped:
            if candidate_lines:
                truncated = True
            continue
        for item_idx, line in enumerate(candidate_lines):
            active_sections[sec_idx][1].append(line)
            candidate_text = _render_sections(active_sections)
            if estimate_tokens(candidate_text) <= token_budget:
                kept_indices[sec_idx].append(item_idx)
                rendered_text = candidate_text
            elif not rendered_text:
                kept_indices[sec_idx].append(item_idx)
                rendered_text = candidate_text[: token_budget * 4]
                truncated = True
                hard_clipped = True
                break
            else:
                active_sections[sec_idx][1].pop()
                truncated = True
    return kept_indices, rendered_text, truncated


def pack_context_within_budget(
    *,
    preferences: Sequence[ScoredNode],
    error_fixes: Sequence[ErrorFixPair],
    paths: Sequence[CompressedPath],
    supporting_nodes: Sequence[ScoredNode],
    token_budget: int,
) -> ContextPack:
    if token_budget < 1:
        raise ValueError("token_budget must be at least 1")
    sections_spec: tuple[tuple[str, list[str]], ...] = (
        ("[PREFERENCES]", [f"- {item.node.label}: {item.node.content}" for item in preferences]),
        (
            "[PAST ERROR FIXES]",
            [
                f"- {item.error_node.label} -> {item.fix_node.label}: {item.fix_node.content}"
                for item in error_fixes
            ],
        ),
        ("[GRAPH PATHS]", [f"- {item.rendered}" for item in paths]),
        (
            "[CONTEXT]",
            [
                f"- [{item.node.kind.value}] {item.node.label}: {item.node.content}"
                for item in supporting_nodes
            ],
        ),
    )
    kept_indices, rendered_text, truncated = _pack_sections(sections_spec, token_budget)
    return ContextPack(
        preferences=tuple(preferences[idx] for idx in kept_indices[0]),
        error_fixes=tuple(error_fixes[idx] for idx in kept_indices[1]),
        paths=tuple(paths[idx] for idx in kept_indices[2]),
        supporting_nodes=tuple(supporting_nodes[idx] for idx in kept_indices[3]),
        rendered_text=rendered_text,
        estimated_tokens=estimate_tokens(rendered_text),
        token_budget=token_budget,
        truncated=truncated,
    )
