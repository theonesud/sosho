from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TypeIs

from surrealdb import RecordID

from sosho_memory.audit import encode_audit_snapshot
from sosho_memory.errors import (
    MemoryModelError,
    MemoryStorageError,
    MemoryValidationError,
)
from sosho_memory.litellm_client import LiteLLMClient
from sosho_memory.maintenance_models import (
    ConsolidationResult,
    DecayConfig,
    DecayResult,
    DuplicateVerification,
    GraphHealthSummary,
    MergeResult,
    build_duplicate_verification_prompts,
    compute_decayed_weight,
    find_duplicate_candidates,
)
from sosho_memory.models import (
    AgentRole,
    AuditAction,
    AuditLogEntry,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    Provenance,
    WorkflowRelation,
)
from sosho_memory.schema import EDGE_TABLES, NODE_TABLES
from sosho_memory.store import SurrealMemoryStore, audit_payload, parse_edge_record
from sosho_memory.surreal_queries import (
    build_active_edges_query,
    build_active_nodes_query,
    build_incident_edges_query,
)
from sosho_memory.write_gate import validate_write_provenance
from sosho_memory.write_service import MemoryWriteService


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


def _parse_node_row(row: Mapping[str, object]) -> MemoryNode:
    record_id = _req_record_id(row, "id")
    try:
        return MemoryNode(
            kind=NodeKind(record_id.table_name),
            key=_req_str(row, "key"),
            label=_req_str(row, "label"),
            content=_req_str(row, "content"),
            embedding=_opt_float_tuple(row, "embedding"),
            provenance=_parse_provenance(row),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid node fields: {error}") from error


def _parse_edge_with_id(row: Mapping[str, object]) -> tuple[RecordID, MemoryEdge]:
    record_id = _req_record_id(row, "id")
    return record_id, parse_edge_record(row)


def _edge_id_str(record_id: RecordID) -> str:
    return f"{record_id.table_name}:{record_id.id}"


def _node_id_str(kind: NodeKind, key: str) -> str:
    return f"{kind.value}:{key}"


def _require_non_empty(value: str, field_name: str) -> None:
    if not value.strip():
        raise MemoryValidationError(f"{field_name} must not be empty.")


def _rewired_edge(
    edge: MemoryEdge,
    kind: NodeKind,
    primary_key: str,
    duplicate_key: str,
    provenance: Provenance,
) -> MemoryEdge | None:
    duplicate_id = (kind, duplicate_key)
    source_kind, source_key = (
        (kind, primary_key)
        if (edge.source_kind, edge.source_key) == duplicate_id
        else (edge.source_kind, edge.source_key)
    )
    target_kind, target_key = (
        (kind, primary_key)
        if (edge.target_kind, edge.target_key) == duplicate_id
        else (edge.target_kind, edge.target_key)
    )
    if (source_kind, source_key) == (target_kind, target_key):
        return None
    return MemoryEdge(
        relation=edge.relation,
        source_kind=source_kind,
        source_key=source_key,
        target_kind=target_kind,
        target_key=target_key,
        weight=edge.weight,
        provenance=provenance,
    )


def _collect_episode_groups(
    episodes: Mapping[str, MemoryNode],
    errors: Mapping[str, MemoryNode],
    fixes: Mapping[str, MemoryNode],
    edges: Sequence[MemoryEdge],
) -> dict[tuple[str, str], list[str]]:
    ep_errors: dict[str, set[str]] = {key: set() for key in episodes}
    ep_fixes: dict[str, set[str]] = {key: set() for key in episodes}
    for edge in edges:
        if edge.provenance.valid_to is not None:
            continue
        endpoints = ((edge.source_kind, edge.source_key), (edge.target_kind, edge.target_key))
        for ep_idx, other_idx in ((0, 1), (1, 0)):
            ep_kind, ep_key = endpoints[ep_idx]
            other_kind, other_key = endpoints[other_idx]
            if ep_kind is not NodeKind.EPISODE or ep_key not in episodes:
                continue
            if other_kind is NodeKind.ERROR and other_key in errors:
                ep_errors[ep_key].add(other_key)
            if other_kind is NodeKind.FIX and other_key in fixes:
                ep_fixes[ep_key].add(other_key)
    groups: dict[tuple[str, str], list[str]] = {}
    for ep_key in sorted(episodes):
        for err_key in sorted(ep_errors[ep_key]):
            for fix_key in sorted(ep_fixes[ep_key]):
                groups.setdefault((err_key, fix_key), []).append(ep_key)
    return groups


def _build_decay_audit_entry(
    edge_rid: RecordID,
    edge: MemoryEdge,
    new_weight: float,
    provenance: Provenance,
    transaction_id: str,
) -> AuditLogEntry:
    after_edge = edge.model_copy(update={"weight": new_weight})
    return AuditLogEntry(
        transaction_id=transaction_id,
        session_id=provenance.session_id,
        agent_id=provenance.agent_id,
        agent_role=provenance.agent_role,
        action=AuditAction.CLOSE_EDGE,
        target_table=edge.relation.value,
        target_id=_edge_id_str(edge_rid),
        payload_json=encode_audit_snapshot(
            before_json=edge.model_dump_json(),
            after_json=after_edge.model_dump_json(),
        ),
        timestamp=datetime.now(UTC),
    )


@dataclass(frozen=True, slots=True)
class _WriteContext:
    database: str
    provenance: Provenance
    transaction_id: str


class GraphMaintenanceService:
    def __init__(
        self,
        store: SurrealMemoryStore,
        write_service: MemoryWriteService,
        model_client: LiteLLMClient | None = None,
    ) -> None:
        self._store = store
        self._write_service = write_service
        self._model_client = model_client

    async def _fetch_active_nodes(
        self,
        database: str,
        node_tables: tuple[str, ...] = NODE_TABLES,
    ) -> tuple[MemoryNode, ...]:
        raw = await self._store.run_query(database, build_active_nodes_query(node_tables))
        rows = _flatten_query_rows(raw, "active_nodes")
        nodes: list[MemoryNode] = []
        for row in rows:
            node = _parse_node_row(row)
            if node.provenance.valid_to is None:
                nodes.append(node)
        return tuple(nodes)

    async def _fetch_active_edges(self, database: str) -> tuple[tuple[RecordID, MemoryEdge], ...]:
        raw = await self._store.run_query(database, build_active_edges_query())
        rows = _flatten_query_rows(raw, "active_edges")
        edges: list[tuple[RecordID, MemoryEdge]] = []
        for row in rows:
            edge_rid, edge = _parse_edge_with_id(row)
            if edge.provenance.valid_to is None:
                edges.append((edge_rid, edge))
        return tuple(edges)

    async def graph_health(self, database: str) -> GraphHealthSummary:
        nodes = await self._fetch_active_nodes(database)
        edges = await self._fetch_active_edges(database)
        node_counts: dict[str, int] = dict.fromkeys(NODE_TABLES, 0)
        edge_counts: dict[str, int] = dict.fromkeys(EDGE_TABLES, 0)
        active_node_ids: set[str] = set()
        for node in nodes:
            node_counts[node.kind.value] += 1
            active_node_ids.add(_node_id_str(node.kind, node.key))
        connected_node_ids: set[str] = set()
        for _, edge in edges:
            edge_counts[edge.relation.value] += 1
            connected_node_ids.add(_node_id_str(edge.source_kind, edge.source_key))
            connected_node_ids.add(_node_id_str(edge.target_kind, edge.target_key))
        orphan_node_ids = tuple(sorted(active_node_ids - connected_node_ids))
        return GraphHealthSummary(
            database=database,
            node_counts=node_counts,
            edge_counts=edge_counts,
            total_nodes=len(nodes),
            total_active_edges=len(edges),
            orphan_node_count=len(orphan_node_ids),
            orphan_node_ids=orphan_node_ids,
        )

    async def merge_nodes(  # noqa: PLR0913
        self,
        database: str,
        kind: NodeKind,
        primary_key: str,
        duplicate_key: str,
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> MergeResult:
        _require_non_empty(transaction_id, "transaction_id")
        validate_write_provenance(provenance)
        if primary_key == duplicate_key:
            raise MemoryValidationError("primary_key and duplicate_key must be different.")
        primary = await self._store.get_node(database, kind, primary_key)
        duplicate = await self._store.get_node(database, kind, duplicate_key)
        if primary is None or duplicate is None:
            raise MemoryValidationError("Both primary and duplicate nodes must exist.")
        raw_edges = await self._store.run_query(
            database,
            build_incident_edges_query(),
            {"record_id": RecordID(kind.value, duplicate_key)},
        )
        ctx = _WriteContext(database=database, provenance=provenance, transaction_id=transaction_id)
        rewired_edges, closed_edges = await self._rewire_incident_edges(
            ctx,
            _flatten_query_rows(raw_edges, "incident_edges"),
            kind,
            primary_key,
            duplicate_key,
        )
        await self._close_duplicate_node(ctx, kind, primary_key, duplicate)
        return MergeResult(
            kind=kind,
            primary_key=primary_key,
            duplicate_key=duplicate_key,
            rewired_edges=rewired_edges,
            closed_edges=closed_edges,
        )

    async def _rewire_incident_edges(
        self,
        ctx: _WriteContext,
        rows: Sequence[Mapping[str, object]],
        kind: NodeKind,
        primary_key: str,
        duplicate_key: str,
    ) -> tuple[int, int]:
        rewired_edges = 0
        closed_edges = 0
        seen_ids: set[str] = set()
        for row in rows:
            edge_rid, edge = _parse_edge_with_id(row)
            edge_id = _edge_id_str(edge_rid)
            if edge_id in seen_ids or edge.provenance.valid_to is not None:
                continue
            seen_ids.add(edge_id)
            rewired = _rewired_edge(edge, kind, primary_key, duplicate_key, ctx.provenance)
            if rewired is not None:
                await self._write_service.write_edge(
                    ctx.database, rewired, transaction_id=ctx.transaction_id
                )
                rewired_edges += 1
            await self._write_service.close_edge(
                ctx.database,
                edge.relation,
                edge_id,
                valid_to=ctx.provenance.timestamp,
                provenance=ctx.provenance,
                transaction_id=ctx.transaction_id,
            )
            closed_edges += 1
        return rewired_edges, closed_edges

    async def _close_duplicate_node(
        self,
        ctx: _WriteContext,
        kind: NodeKind,
        primary_key: str,
        duplicate: MemoryNode,
    ) -> None:
        closed_duplicate = duplicate.model_copy(
            update={
                "provenance": duplicate.provenance.model_copy(
                    update={"valid_to": ctx.provenance.timestamp}
                )
            }
        )
        await self._write_service.write_node(
            ctx.database, closed_duplicate, transaction_id=ctx.transaction_id
        )
        supersedes_edge = MemoryEdge(
            relation=WorkflowRelation.SUPERSEDES,
            source_kind=kind,
            source_key=primary_key,
            target_kind=kind,
            target_key=duplicate.key,
            provenance=ctx.provenance,
        )
        await self._write_service.write_edge(
            ctx.database, supersedes_edge, transaction_id=ctx.transaction_id
        )

    async def detect_and_merge_duplicates(
        self,
        database: str,
        *,
        similarity_threshold: float = 0.90,
        provenance: Provenance,
        transaction_id: str,
    ) -> tuple[MergeResult, ...]:
        if self._model_client is None:
            raise MemoryModelError("LiteLLMClient is required for duplicate verification.")
        active_nodes = await self._fetch_active_nodes(database)
        nodes_by_id = {(node.kind, node.key): node for node in active_nodes}
        candidates = find_duplicate_candidates(
            active_nodes, similarity_threshold=similarity_threshold
        )
        merged: set[tuple[NodeKind, str]] = set()
        results: list[MergeResult] = []
        for candidate in candidates:
            primary_id = (candidate.kind, candidate.primary_key)
            duplicate_id = (candidate.kind, candidate.duplicate_key)
            if primary_id in merged or duplicate_id in merged:
                continue
            verification = await self._model_client.decide_json(
                *build_duplicate_verification_prompts(
                    nodes_by_id[primary_id], nodes_by_id[duplicate_id]
                ),
                DuplicateVerification,
            )
            if not verification.same_concept:
                continue
            result = await self.merge_nodes(
                database,
                candidate.kind,
                candidate.primary_key,
                candidate.duplicate_key,
                provenance=provenance,
                transaction_id=transaction_id,
            )
            merged.add(duplicate_id)
            results.append(result)
        return tuple(results)

    async def consolidate_episodes(
        self,
        database: str,
        *,
        min_occurrences: int = 2,
        provenance: Provenance,
        transaction_id: str,
    ) -> ConsolidationResult:
        _require_non_empty(transaction_id, "transaction_id")
        validate_write_provenance(provenance)
        if isinstance(min_occurrences, bool) or min_occurrences < 2:
            raise MemoryValidationError("min_occurrences must be at least 2.")
        nodes = await self._fetch_active_nodes(
            database,
            (NodeKind.EPISODE.value, NodeKind.ERROR.value, NodeKind.FIX.value),
        )
        edges = [edge for _, edge in await self._fetch_active_edges(database)]
        episodes = {node.key: node for node in nodes if node.kind is NodeKind.EPISODE}
        errors = {node.key: node for node in nodes if node.kind is NodeKind.ERROR}
        fixes = {node.key: node for node in nodes if node.kind is NodeKind.FIX}
        groups = _collect_episode_groups(episodes, errors, fixes, edges)
        ctx = _WriteContext(database=database, provenance=provenance, transaction_id=transaction_id)
        created_fix_keys, episodes_to_close = await self._promote_episode_groups(
            ctx, groups, fixes, min_occurrences
        )
        for ep_key in sorted(episodes_to_close):
            ep_node = episodes[ep_key]
            closed_ep = ep_node.model_copy(
                update={
                    "provenance": ep_node.provenance.model_copy(
                        update={"valid_to": provenance.timestamp}
                    )
                }
            )
            await self._write_service.write_node(database, closed_ep, transaction_id=transaction_id)
        return ConsolidationResult(
            promoted_fixes=len(created_fix_keys),
            source_episode_keys=tuple(sorted(episodes_to_close)),
            created_fix_keys=tuple(created_fix_keys),
        )

    async def _promote_episode_groups(
        self,
        ctx: _WriteContext,
        groups: Mapping[tuple[str, str], list[str]],
        fixes: Mapping[str, MemoryNode],
        min_occurrences: int,
    ) -> tuple[list[str], set[str]]:
        created_fix_keys: list[str] = []
        episodes_to_close: set[str] = set()
        for (error_key, fix_key), ep_keys in sorted(groups.items()):
            if len(ep_keys) < min_occurrences:
                continue
            fix_node = fixes[fix_key]
            rule_key = f"rule_{error_key}_{fix_key}"
            rule_node = MemoryNode(
                kind=NodeKind.FIX,
                key=rule_key,
                label=f"Procedural fix: {fix_node.label}",
                content=fix_node.content,
                embedding=fix_node.embedding,
                provenance=ctx.provenance.model_copy(update={"confidence": 1.0}),
            )
            await self._write_service.write_node(
                ctx.database, rule_node, transaction_id=ctx.transaction_id
            )
            rule_edge = MemoryEdge(
                relation=WorkflowRelation.FIXED_BY,
                source_kind=NodeKind.ERROR,
                source_key=error_key,
                target_kind=NodeKind.FIX,
                target_key=rule_key,
                weight=2.0,
                provenance=ctx.provenance,
            )
            await self._write_service.write_edge(
                ctx.database, rule_edge, transaction_id=ctx.transaction_id
            )
            created_fix_keys.append(rule_key)
            episodes_to_close.update(ep_keys)
        return created_fix_keys, episodes_to_close

    async def apply_edge_decay(
        self,
        database: str,
        *,
        now: datetime,
        config: DecayConfig,
        provenance: Provenance,
        transaction_id: str,
    ) -> DecayResult:
        _require_non_empty(transaction_id, "transaction_id")
        validate_write_provenance(provenance)
        if now.tzinfo is None:
            raise MemoryValidationError("now must include timezone information.")
        edges = await self._fetch_active_edges(database)
        inspected_edges = 0
        decayed_edges = 0
        closed_edges = 0
        for edge_rid, edge in edges:
            if edge.weight > config.max_weight_to_decay:
                continue
            inspected_edges += 1
            age_days = (now - edge.provenance.timestamp).total_seconds() / 86400.0
            new_weight = compute_decayed_weight(edge.weight, age_days, config.half_life_days)
            if new_weight < config.min_active_weight:
                await self._write_service.close_edge(
                    database,
                    edge.relation,
                    _edge_id_str(edge_rid),
                    valid_to=now,
                    provenance=provenance,
                    transaction_id=transaction_id,
                )
                closed_edges += 1
            elif new_weight < edge.weight:
                entry = _build_decay_audit_entry(
                    edge_rid, edge, new_weight, provenance, transaction_id
                )
                await self._write_decayed_edge(database, edge_rid, new_weight, entry)
                decayed_edges += 1
        return DecayResult(
            inspected_edges=inspected_edges,
            decayed_edges=decayed_edges,
            closed_edges=closed_edges,
        )

    async def _write_decayed_edge(
        self,
        database: str,
        edge_rid: RecordID,
        new_weight: float,
        entry: AuditLogEntry,
    ) -> None:
        query = (
            "BEGIN TRANSACTION;\n"
            "UPDATE $edge_id SET weight = $weight;\n"
            "CREATE audit_log CONTENT $audit_data;\n"
            "COMMIT TRANSACTION;"
        )
        params: dict[str, object] = {
            "edge_id": edge_rid,
            "weight": new_weight,
            "audit_data": audit_payload(entry),
        }
        await self._store.run_query(database, query, params)
