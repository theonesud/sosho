from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable

import networkx as nx
from pydantic import BaseModel, ConfigDict

from sosho_memory.conceptnet_filter import (
    ConceptNetFilterConfig,
    RawAssertion,
    parse_conceptnet_lines,
)
from sosho_memory.models import ConceptNetRelation


class FilteredOntology(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    dataset_version: str
    filter_fingerprint: str
    concepts: tuple[str, ...]
    spine_edges: tuple[RawAssertion, ...]
    lateral_edges: tuple[RawAssertion, ...]
    abstractness_scores: dict[str, float]


def compute_filter_fingerprint(config: ConceptNetFilterConfig) -> str:
    return hashlib.sha256(config.model_dump_json().encode("utf-8")).hexdigest()


def prune_low_degree(
    assertions: tuple[RawAssertion, ...],
    min_degree: int,
) -> tuple[RawAssertion, ...]:
    graph: nx.DiGraph[str] = nx.DiGraph()
    for assertion in assertions:
        graph.add_edge(assertion.source, assertion.target)
    surviving = {
        node
        for node in graph.nodes()
        if graph.in_degree(node) + graph.out_degree(node) >= min_degree
    }
    return tuple(
        assertion
        for assertion in assertions
        if assertion.source in surviving and assertion.target in surviving
    )


def compute_pagerank(
    nodes: Iterable[str],
    edges: Iterable[tuple[str, str]],
    alpha: float = 0.85,
    max_iter: int = 100,
    tol: float = 1e-6,
) -> dict[str, float]:
    node_set = set(nodes)
    edge_list = list(edges)
    for source, target in edge_list:
        node_set.add(source)
        node_set.add(target)
    sorted_nodes = sorted(node_set)
    node_count = len(sorted_nodes)
    if node_count == 0:
        return {}
    out_neighbors: dict[str, set[str]] = {node: set() for node in sorted_nodes}
    for source, target in edge_list:
        out_neighbors[source].add(target)
    dangling = [node for node in sorted_nodes if not out_neighbors[node]]
    ranks = dict.fromkeys(sorted_nodes, 1.0 / node_count)
    for _ in range(max_iter):
        dangling_sum = alpha * sum(ranks[node] for node in dangling) / node_count
        base = (1.0 - alpha) / node_count + dangling_sum
        next_ranks = dict.fromkeys(sorted_nodes, base)
        for source in sorted_nodes:
            targets = out_neighbors[source]
            if not targets:
                continue
            share = alpha * ranks[source] / len(targets)
            for target in targets:
                next_ranks[target] += share
        delta = sum(abs(next_ranks[node] - ranks[node]) for node in sorted_nodes)
        ranks = next_ranks
        if delta < tol:
            break
    return ranks


def _build_strict_dag(graph: nx.DiGraph[str], scores: dict[str, float]) -> nx.DiGraph[str]:
    dag: nx.DiGraph[str] = nx.DiGraph()
    dag.add_nodes_from(graph.nodes())
    for source, target in graph.edges():
        if scores[target] > scores[source] or (
            scores[target] == scores[source] and target > source
        ):
            dag.add_edge(source, target)
    return dag


def _compute_depths(dag: nx.DiGraph[str]) -> dict[str, int]:
    depths = dict.fromkeys(dag.nodes(), 0)
    for node in nx.topological_sort(dag):
        children = list(dag.predecessors(node))
        if children:
            depths[node] = max(depths[child] for child in children) + 1
    return depths


def _extract_initial_tree(
    dag: nx.DiGraph[str],
    scores: dict[str, float],
    depths: dict[str, int],
) -> nx.DiGraph[str]:
    reduced = nx.transitive_reduction(dag)
    tree: nx.DiGraph[str] = nx.DiGraph()
    tree.add_nodes_from(dag.nodes())
    for node in sorted(reduced.nodes()):
        parents = list(reduced.successors(node))
        if not parents:
            continue
        best_parent = max(parents, key=lambda parent: (depths[parent], scores[parent], parent))
        tree.add_edge(node, best_parent)
    return tree


def _merge_disconnected_roots(
    tree: nx.DiGraph[str],
    original: nx.DiGraph[str],
    scores: dict[str, float],
) -> None:
    node_to_root: dict[str, str] = {}
    for component in nx.weakly_connected_components(tree):
        roots = [node for node in component if tree.out_degree(node) == 0]
        root = min(roots)
        for node in component:
            node_to_root[node] = root
    all_roots = sorted(node for node in tree.nodes() if tree.out_degree(node) == 0)
    for root in all_roots:
        if root not in original:
            continue
        valid_parents = [
            parent
            for parent in original.successors(root)
            if parent in tree and node_to_root[parent] != node_to_root[root]
        ]
        if not valid_parents:
            continue
        best_parent = max(valid_parents, key=lambda parent: (scores[parent], parent))
        tree.add_edge(root, best_parent)
        old_root = node_to_root[root]
        new_root = node_to_root[best_parent]
        for node, mapped_root in list(node_to_root.items()):
            if mapped_root == old_root:
                node_to_root[node] = new_root


def build_spine_edges(
    isa_assertions: tuple[RawAssertion, ...],
) -> tuple[tuple[RawAssertion, ...], dict[str, float]]:
    if not isa_assertions:
        return (), {}
    graph: nx.DiGraph[str] = nx.DiGraph()
    weights: dict[tuple[str, str], float] = {}
    for assertion in isa_assertions:
        if assertion.source == assertion.target:
            continue
        graph.add_edge(assertion.source, assertion.target)
        key = (assertion.source, assertion.target)
        existing = weights.get(key)
        weights[key] = assertion.weight if existing is None else max(existing, assertion.weight)
    pagerank = compute_pagerank(graph.nodes(), graph.edges())
    scores = {node: pagerank[node] * (graph.out_degree(node) + 1) for node in graph.nodes()}
    dag = _build_strict_dag(graph, scores)
    depths = _compute_depths(dag)
    tree = _extract_initial_tree(dag, scores, depths)
    _merge_disconnected_roots(tree, graph, scores)
    sorted_edges = sorted(tree.edges())
    spine_edges = tuple(
        RawAssertion(
            source=source,
            target=target,
            relation=ConceptNetRelation.IS_A,
            weight=weights[(source, target)],
        )
        for source, target in sorted_edges
    )
    rounded_scores = {node: round(scores[node], 6) for node in sorted(scores)}
    return spine_edges, rounded_scores


def build_filtered_ontology(
    lines: Iterable[str],
    config: ConceptNetFilterConfig,
    noun_predicate: Callable[[str], bool] | None = None,
) -> FilteredOntology:
    parsed = parse_conceptnet_lines(lines, config, noun_predicate=noun_predicate)
    pruned = prune_low_degree(parsed, config.min_degree)
    isa_assertions = tuple(
        assertion for assertion in pruned if assertion.relation == ConceptNetRelation.IS_A
    )
    lateral_edges = tuple(
        assertion for assertion in pruned if assertion.relation != ConceptNetRelation.IS_A
    )
    spine_edges, abstractness_scores = build_spine_edges(isa_assertions)
    concepts = tuple(
        sorted(
            {node for edge in (*spine_edges, *lateral_edges) for node in (edge.source, edge.target)}
        )
    )
    return FilteredOntology(
        dataset_version=config.dataset_version,
        filter_fingerprint=compute_filter_fingerprint(config),
        concepts=concepts,
        spine_edges=spine_edges,
        lateral_edges=lateral_edges,
        abstractness_scores=abstractness_scores,
    )
