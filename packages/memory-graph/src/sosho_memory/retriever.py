from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import TypeIs

from surrealdb import RecordID

from sosho_memory.errors import MemoryStorageError, MemoryValidationError
from sosho_memory.litellm_client import LiteLLMClient
from sosho_memory.models import AgentRole, MemoryEdge, MemoryNode, NodeKind, Provenance
from sosho_memory.retrieval_models import (
    CompressedPath,
    ContextPack,
    ErrorFixPair,
    GraphExpansionResult,
    MemorySourceScope,
    ScoredNode,
)
from sosho_memory.schema import EDGE_TABLES
from sosho_memory.store import SurrealMemoryStore, parse_edge_record
from sosho_memory.subgraph_compressor import (
    extract_compressed_paths,
    merge_two_graph_nodes,
    pack_context_within_budget,
)
from sosho_memory.surreal_queries import (
    build_error_fix_query,
    build_hybrid_search_query,
    build_neighbors_query,
)


def _is_mapping(value: object) -> TypeIs[Mapping[object, object]]:
    return isinstance(value, Mapping)


def _is_list(value: object) -> TypeIs[list[object]]:
    return isinstance(value, list)


def _is_sequence(value: object) -> TypeIs[list[object] | tuple[object, ...]]:
    return isinstance(value, (list, tuple))


def _to_str_mapping(raw: object, context: str) -> dict[str, object]:
    if not _is_mapping(raw):
        raise MemoryStorageError(f"Expected mapping for {context}, got {type(raw).__name__}")
    result: dict[str, object] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            raise MemoryStorageError(f"Expected string key in {context}")
        result[key] = value
    return result


def _req_str(row: Mapping[str, object], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str):
        raise MemoryStorageError(f"Expected string for field {field!r}")
    return value


def _req_float(row: Mapping[str, object], field: str) -> float:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MemoryStorageError(f"Expected float for field {field!r}")
    return float(value)


def _opt_float(row: Mapping[str, object], field: str) -> float | None:
    value = row.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MemoryStorageError(f"Expected optional float for field {field!r}")
    return float(value)


def _req_dt(row: Mapping[str, object], field: str) -> datetime:
    value = row.get(field)
    if not isinstance(value, datetime):
        raise MemoryStorageError(f"Expected datetime for field {field!r}")
    return value


def _opt_dt(row: Mapping[str, object], field: str) -> datetime | None:
    value = row.get(field)
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise MemoryStorageError(f"Expected optional datetime for field {field!r}")
    return value


def _opt_float_tuple(row: Mapping[str, object], field: str) -> tuple[float, ...] | None:
    value = row.get(field)
    if value is None:
        return None
    if not _is_sequence(value):
        raise MemoryStorageError(f"Expected sequence for field {field!r}")
    items: list[float] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise MemoryStorageError(f"Expected numeric item in field {field!r}")
        items.append(float(item))
    return tuple(items)


def _req_record_id(row: Mapping[str, object], field: str) -> RecordID:
    value = row.get(field)
    if not isinstance(value, RecordID):
        raise MemoryStorageError(f"Expected RecordID for field {field!r}")
    return value


def _parse_provenance(row: Mapping[str, object]) -> Provenance:
    try:
        return Provenance(
            valid_from=_req_dt(row, "valid_from"),
            valid_to=_opt_dt(row, "valid_to"),
            confidence=_req_float(row, "confidence"),
            agent_id=_req_str(row, "agent_id"),
            agent_role=AgentRole(_req_str(row, "agent_role")),
            session_id=_req_str(row, "session_id"),
            timestamp=_req_dt(row, "timestamp"),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid provenance fields: {error}") from error


def _parse_node_row(
    row: Mapping[str, object],
    expected_kind: NodeKind | None = None,
) -> MemoryNode:
    record_id = _req_record_id(row, "id")
    try:
        kind = expected_kind if expected_kind is not None else NodeKind(record_id.table_name)
        return MemoryNode(
            kind=kind,
            key=_req_str(row, "key"),
            label=_req_str(row, "label"),
            content=_req_str(row, "content"),
            embedding=_opt_float_tuple(row, "embedding"),
            provenance=_parse_provenance(row),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid node fields: {error}") from error


def _flatten_query_rows(results: Sequence[object], context: str) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for item in results:
        if item is None:
            continue
        if _is_list(item):
            rows.extend(_to_str_mapping(entry, context) for entry in item)
        elif _is_mapping(item):
            rows.append(_to_str_mapping(item, context))
        else:
            raise MemoryStorageError(f"Unexpected result item in {context}: {type(item).__name__}")
    return tuple(rows)


def _fuse_hybrid_rows(
    rows: Sequence[Mapping[str, object]],
    scope: MemorySourceScope,
) -> tuple[ScoredNode, ...]:
    candidates: dict[tuple[NodeKind, str], tuple[MemoryNode, float, float]] = {}
    for row in rows:
        node = _parse_node_row(row)
        if node.provenance.valid_to is not None:
            continue
        vec_dist = _opt_float(row, "_vec_dist")
        vec_score = max(0.0, 1.0 - vec_dist) if vec_dist is not None else 0.0
        bm25_raw = _opt_float(row, "_bm25_score")
        bm25_score = max(0.0, bm25_raw) if bm25_raw is not None else 0.0
        identity = (node.kind, node.key)
        existing = candidates.get(identity)
        if existing is None:
            candidates[identity] = (node, vec_score, bm25_score)
        else:
            candidates[identity] = (
                existing[0],
                max(existing[1], vec_score),
                max(existing[2], bm25_score),
            )
    scored: list[ScoredNode] = []
    for node, vec_score, bm25_score in candidates.values():
        priority_boost = 1.0 if node.kind is NodeKind.PREFERENCE else 0.0
        scored.append(
            ScoredNode(
                node=node,
                scope=scope,
                score=vec_score + bm25_score + priority_boost,
                vector_score=vec_score,
                bm25_score=bm25_score,
                priority_boost=priority_boost,
            )
        )
    scored.sort(key=lambda item: (-item.score, item.node.kind.value, item.node.key))
    return tuple(scored)


def _require_row_list(row: Mapping[str, object], field: str) -> tuple[object, ...]:
    value = row.get(field)
    if value is None:
        return ()
    if not _is_list(value):
        raise MemoryStorageError(f"Expected list for field {field!r}")
    return tuple(value)


def _parse_error_fix_rows(
    rows: Sequence[Mapping[str, object]],
    scope: MemorySourceScope,
    limit: int,
) -> tuple[ErrorFixPair, ...]:
    pairs_by_key: dict[tuple[str, str], ErrorFixPair] = {}
    for row in rows:
        error_node = _parse_node_row(row, expected_kind=NodeKind.ERROR)
        if error_node.provenance.valid_to is not None:
            continue
        fixes_by_key: dict[str, MemoryNode] = {}
        for raw_fix in _require_row_list(row, "_fixes"):
            fix_node = _parse_node_row(
                _to_str_mapping(raw_fix, "_fixes"), expected_kind=NodeKind.FIX
            )
            if fix_node.provenance.valid_to is None:
                fixes_by_key[fix_node.key] = fix_node
        for raw_edge in _require_row_list(row, "_fixed_edges"):
            edge = parse_edge_record(raw_edge)
            if (
                edge.provenance.valid_to is not None
                or edge.source_kind is not NodeKind.ERROR
                or edge.source_key != error_node.key
                or edge.target_kind is not NodeKind.FIX
            ):
                continue
            fix_node = fixes_by_key.get(edge.target_key)
            if fix_node is None:
                continue
            pair_key = (error_node.key, fix_node.key)
            candidate = ErrorFixPair(
                error_node=error_node,
                fix_node=fix_node,
                scope=scope,
                weight=edge.weight,
            )
            existing = pairs_by_key.get(pair_key)
            if existing is None or candidate.weight > existing.weight:
                pairs_by_key[pair_key] = candidate
    sorted_pairs = sorted(
        pairs_by_key.values(),
        key=lambda item: (-item.weight, item.error_node.key, item.fix_node.key),
    )
    return tuple(sorted_pairs[:limit])


def _merge_error_fixes(
    user_fixes: Sequence[ErrorFixPair],
    project_fixes: Sequence[ErrorFixPair],
) -> tuple[ErrorFixPair, ...]:
    merged: dict[tuple[str, str], ErrorFixPair] = {
        (pair.error_node.key, pair.fix_node.key): pair for pair in project_fixes
    }
    for pair in user_fixes:
        pair_key = (pair.error_node.key, pair.fix_node.key)
        if pair_key not in merged:
            merged[pair_key] = pair
    return tuple(
        sorted(
            merged.values(), key=lambda item: (-item.weight, item.error_node.key, item.fix_node.key)
        )
    )


def _edge_identity(edge: MemoryEdge) -> tuple[str, NodeKind, str, NodeKind, str]:
    return (
        edge.relation.value,
        edge.source_kind,
        edge.source_key,
        edge.target_kind,
        edge.target_key,
    )


def _sort_edges(edges: Iterable[MemoryEdge]) -> tuple[MemoryEdge, ...]:
    return tuple(
        sorted(
            edges,
            key=lambda item: (
                item.relation.value,
                item.source_kind.value,
                item.source_key,
                item.target_kind.value,
                item.target_key,
            ),
        )
    )


def _merge_edges(
    user_edges: Sequence[MemoryEdge],
    project_edges: Sequence[MemoryEdge],
) -> tuple[MemoryEdge, ...]:
    merged: dict[tuple[str, NodeKind, str, NodeKind, str], MemoryEdge] = {
        _edge_identity(edge): edge for edge in project_edges
    }
    for edge in user_edges:
        key = _edge_identity(edge)
        if key not in merged:
            merged[key] = edge
    return _sort_edges(merged.values())


def _top_seed_nodes(nodes: Sequence[ScoredNode], top_k: int) -> tuple[ScoredNode, ...]:
    ranked = sorted(
        nodes,
        key=lambda item: (-item.score, item.node.kind.value, item.node.key),
    )
    return tuple(ranked[:top_k])


class MemoryRetriever:
    def __init__(
        self,
        store: SurrealMemoryStore,
        model_client: LiteLLMClient | None = None,
    ) -> None:
        self._store = store
        self._model_client = model_client

    async def hybrid_search_scope(
        self,
        database: str,
        scope: MemorySourceScope,
        *,
        query_text: str = "",
        query_vector: Sequence[float] | None = None,
        top_k: int = 8,
    ) -> tuple[ScoredNode, ...]:
        stripped_text = query_text.strip()
        include_vector = query_vector is not None
        include_bm25 = bool(stripped_text)
        query = build_hybrid_search_query(
            include_vector=include_vector,
            include_bm25=include_bm25,
            top_k=top_k,
        )
        params: dict[str, object] = {"top_k": top_k}
        if query_vector is not None:
            params["query_vector"] = [float(value) for value in query_vector]
        if include_bm25:
            params["query_text"] = stripped_text
        raw_results = await self._store.run_query(database, query, params)
        rows = _flatten_query_rows(raw_results, "hybrid_search_scope")
        return _fuse_hybrid_rows(rows, scope)

    async def find_error_fixes(
        self,
        database: str,
        scope: MemorySourceScope,
        *,
        query_text: str = "",
        query_vector: Sequence[float] | None = None,
        limit: int = 5,
    ) -> tuple[ErrorFixPair, ...]:
        stripped_text = query_text.strip()
        include_vector = query_vector is not None
        include_bm25 = bool(stripped_text)
        query = build_error_fix_query(
            include_vector=include_vector,
            include_bm25=include_bm25,
            limit=limit,
        )
        params: dict[str, object] = {"limit": limit}
        if query_vector is not None:
            params["query_vector"] = [float(value) for value in query_vector]
        if include_bm25:
            params["query_text"] = stripped_text
        raw_results = await self._store.run_query(database, query, params)
        rows = _flatten_query_rows(raw_results, "find_error_fixes")
        return _parse_error_fix_rows(rows, scope, limit)

    async def _query_neighbor_edges(
        self,
        database: str,
        identities: Sequence[tuple[NodeKind, str]],
    ) -> tuple[MemoryEdge, ...]:
        if not identities:
            return ()
        query = build_neighbors_query(EDGE_TABLES)
        record_ids = [RecordID(kind.value, key) for kind, key in identities]
        raw_results = await self._store.run_query(database, query, {"record_ids": record_ids})
        rows = _flatten_query_rows(raw_results, "neighbors_query")
        edges: list[MemoryEdge] = []
        for row in rows:
            edge = parse_edge_record(row)
            if edge.provenance.valid_to is None:
                edges.append(edge)
        return tuple(edges)

    async def _fetch_active_nodes(
        self,
        database: str,
        identities: Iterable[tuple[NodeKind, str]],
    ) -> tuple[MemoryNode, ...]:
        ordered = sorted(set(identities), key=lambda item: (item[0].value, item[1]))
        nodes: list[MemoryNode] = []
        for kind, key in ordered:
            node = await self._store.get_node(database, kind, key)
            if node is not None and node.provenance.valid_to is None:
                nodes.append(node)
        return tuple(nodes)

    async def _collect_bfs_graph(
        self,
        database: str,
        center_id: tuple[NodeKind, str],
        hops: int,
    ) -> tuple[set[tuple[NodeKind, str]], tuple[MemoryEdge, ...]]:
        visited: set[tuple[NodeKind, str]] = {center_id}
        frontier: list[tuple[NodeKind, str]] = [center_id]
        edges_by_key: dict[tuple[str, NodeKind, str, NodeKind, str], MemoryEdge] = {}
        for _ in range(hops):
            if not frontier:
                break
            hop_edges = await self._query_neighbor_edges(database, frontier)
            next_frontier: list[tuple[NodeKind, str]] = []
            for edge in hop_edges:
                edges_by_key[_edge_identity(edge)] = edge
                for endpoint in (
                    (edge.source_kind, edge.source_key),
                    (edge.target_kind, edge.target_key),
                ):
                    if endpoint not in visited:
                        visited.add(endpoint)
                        next_frontier.append(endpoint)
            frontier = next_frontier
        return visited, _sort_edges(edges_by_key.values())

    async def expand_subgraph(
        self,
        database: str,
        center_kind: NodeKind,
        center_key: str,
        *,
        hops: int = 2,
        max_paths: int = 5,
    ) -> GraphExpansionResult:
        if isinstance(hops, bool) or hops < 1 or hops > 4:
            raise MemoryValidationError(f"hops must be between 1 and 4, got {hops!r}")
        if isinstance(max_paths, bool) or max_paths < 0:
            raise MemoryValidationError(f"max_paths must be non-negative, got {max_paths!r}")
        center_id = (center_kind, center_key)
        visited, edges = await self._collect_bfs_graph(database, center_id, hops)
        nodes = await self._fetch_active_nodes(database, visited)
        seed_keys = [
            f"{center_kind.value}:{center_key}",
            *(
                f"{node.kind.value}:{node.key}"
                for node in nodes
                if (node.kind, node.key) != center_id
            ),
        ]
        paths: tuple[CompressedPath, ...] = extract_compressed_paths(
            seed_keys, edges, max_paths=max_paths
        )
        return GraphExpansionResult(
            center_kind=center_kind,
            center_key=center_key,
            hops=hops,
            nodes=nodes,
            edges=edges,
            paths=paths,
        )

    async def _retrieve_scope_bundle(
        self,
        database: str,
        scope: MemorySourceScope,
        *,
        query_text: str,
        query_vector: Sequence[float] | None,
        top_k: int,
    ) -> tuple[
        tuple[ScoredNode, ...],
        tuple[ErrorFixPair, ...],
        tuple[ScoredNode, ...],
        tuple[MemoryEdge, ...],
    ]:
        nodes = await self.hybrid_search_scope(
            database,
            scope,
            query_text=query_text,
            query_vector=query_vector,
            top_k=top_k,
        )
        fixes = await self.find_error_fixes(
            database,
            scope,
            query_text=query_text,
            query_vector=query_vector,
            limit=top_k,
        )
        seeds = _top_seed_nodes(nodes, top_k)
        edges = await self._query_neighbor_edges(
            database,
            [(item.node.kind, item.node.key) for item in seeds],
        )
        return nodes, fixes, seeds, edges

    async def _resolve_query_vector(
        self,
        query_text: str,
        query_vector: Sequence[float] | None,
    ) -> Sequence[float] | None:
        if query_vector is not None:
            return query_vector
        if self._model_client is not None and query_text.strip():
            vectors = await self._model_client.embed([query_text])
            if vectors:
                return vectors[0]
        return None

    async def build_context_pack(  # noqa: PLR0913
        self,
        *,
        project_id: str | None,
        query_text: str,
        query_vector: Sequence[float] | None = None,
        token_budget: int = 600,
        top_k: int = 8,
        max_paths: int = 5,
    ) -> ContextPack:
        effective_vector = await self._resolve_query_vector(query_text, query_vector)
        user_db = await self._store.ensure_user_scope()
        user_nodes, user_fixes, user_seeds, user_edges = await self._retrieve_scope_bundle(
            user_db,
            MemorySourceScope.USER,
            query_text=query_text,
            query_vector=effective_vector,
            top_k=top_k,
        )
        p_nodes: tuple[ScoredNode, ...] = ()
        p_fixes: tuple[ErrorFixPair, ...] = ()
        p_seeds: tuple[ScoredNode, ...] = ()
        p_edges: tuple[MemoryEdge, ...] = ()
        if project_id is not None:
            p_db = await self._store.ensure_project_scope(project_id)
            p_nodes, p_fixes, p_seeds, p_edges = await self._retrieve_scope_bundle(
                p_db,
                MemorySourceScope.PROJECT,
                query_text=query_text,
                query_vector=effective_vector,
                top_k=top_k,
            )
        merged_nodes = merge_two_graph_nodes(user_nodes, p_nodes)
        preferences = tuple(item for item in merged_nodes if item.node.kind is NodeKind.PREFERENCE)
        supporting = tuple(
            item for item in merged_nodes if item.node.kind is not NodeKind.PREFERENCE
        )
        seed_keys = list(
            dict.fromkeys(
                f"{item.node.kind.value}:{item.node.key}" for item in (*p_seeds, *user_seeds)
            )
        )
        paths = extract_compressed_paths(
            seed_keys, _merge_edges(user_edges, p_edges), max_paths=max_paths
        )
        return pack_context_within_budget(
            preferences=preferences,
            error_fixes=_merge_error_fixes(user_fixes, p_fixes),
            paths=paths,
            supporting_nodes=supporting,
            token_budget=token_budget,
        )
