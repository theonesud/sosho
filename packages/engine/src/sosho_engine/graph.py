from collections import defaultdict, deque
from collections.abc import Iterable

from sosho_engine.spec import Edge


def adjacency(edges: Iterable[Edge], include_loops: bool) -> dict[str, list[str]]:
    result: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        if include_loops or not edge.loop:
            result[edge.source].append(edge.target)
    return result


def reachable(start: Iterable[str], adj: dict[str, list[str]]) -> set[str]:
    seen: set[str] = set()
    queue = deque(start)
    while queue:
        current = queue.popleft()
        if current in seen:
            continue
        seen.add(current)
        queue.extend(adj.get(current, []))
    return seen


def has_cycle(node_ids: Iterable[str], adj: dict[str, list[str]]) -> bool:
    indegree = dict.fromkeys(node_ids, 0)
    for targets in adj.values():
        for target in targets:
            if target in indegree:
                indegree[target] += 1
    queue = deque(node for node, degree in indegree.items() if degree == 0)
    visited = 0
    while queue:
        current = queue.popleft()
        visited += 1
        for target in adj.get(current, []):
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    return visited != len(indegree)


def incoming_edges(edges: Iterable[Edge], include_loops: bool) -> dict[str, list[int]]:
    result: dict[str, list[int]] = defaultdict(list)
    for index, edge in enumerate(edges):
        if include_loops or not edge.loop:
            result[edge.target].append(index)
    return result
