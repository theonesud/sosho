import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sosho_memory import (
    AgentRole,
    AuditAction,
    ConceptNetRelation,
    DecayConfig,
    GraphMaintenanceService,
    MemoryEdge,
    MemoryNode,
    MemoryWriteService,
    NodeKind,
    Provenance,
    SurrealMemoryStore,
    WorkflowRelation,
    compute_decayed_weight,
    decode_audit_snapshot,
    find_duplicate_candidates,
    load_memory_settings,
)

_T0 = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)


def _prov(ts: datetime, *, confidence: float = 0.9, session_id: str = "sess-maint") -> Provenance:
    return Provenance(
        valid_from=ts,
        valid_to=None,
        confidence=confidence,
        agent_id="coord-1",
        agent_role=AgentRole.COORDINATOR,
        session_id=session_id,
        timestamp=ts,
    )


def _node(
    kind: NodeKind,
    key: str,
    content: str,
    *,
    ts: datetime = _T0,
    embedding: tuple[float, ...] | None = None,
) -> MemoryNode:
    return MemoryNode(
        kind=kind,
        key=key,
        label=key,
        content=content,
        embedding=embedding,
        provenance=_prov(ts),
    )


def _edge(
    relation: ConceptNetRelation | WorkflowRelation,
    source: tuple[NodeKind, str],
    target: tuple[NodeKind, str],
    *,
    weight: float = 1.0,
    ts: datetime = _T0,
) -> MemoryEdge:
    return MemoryEdge(
        relation=relation,
        source_kind=source[0],
        source_key=source[1],
        target_kind=target[0],
        target_key=target[1],
        weight=weight,
        provenance=_prov(ts),
    )


async def _seed_decay_graph(writer: MemoryWriteService, db: str) -> None:
    nodes = (
        _node(NodeKind.ENTITY, "svc", "service node"),
        _node(NodeKind.CONCEPT, "stale_target", "stale concept"),
        _node(NodeKind.CONCEPT, "mid_target", "mid concept"),
        _node(NodeKind.CONCEPT, "strong_target", "strong concept"),
    )
    for idx, node in enumerate(nodes, start=1):
        await writer.write_node(db, node, transaction_id=f"tx-d-n-{idx}")
    edges = (
        _edge(
            WorkflowRelation.DEPENDS_ON,
            (NodeKind.ENTITY, "svc"),
            (NodeKind.CONCEPT, "stale_target"),
            weight=0.25,
            ts=_T0,
        ),
        _edge(
            WorkflowRelation.DEPENDS_ON,
            (NodeKind.ENTITY, "svc"),
            (NodeKind.CONCEPT, "mid_target"),
            weight=1.0,
            ts=_T0 + timedelta(days=60),
        ),
        _edge(
            WorkflowRelation.DEPENDS_ON,
            (NodeKind.ENTITY, "svc"),
            (NodeKind.CONCEPT, "strong_target"),
            weight=3.0,
            ts=_T0,
        ),
    )
    for idx, edge in enumerate(edges, start=1):
        await writer.write_edge(db, edge, transaction_id=f"tx-d-e-{idx}")


async def _verify_decay_state(
    store: SurrealMemoryStore,
    db: str,
    now: datetime,
    prior_count: int,
) -> None:
    edges = await store.list_outgoing_edges(
        db, NodeKind.ENTITY, "svc", relation=WorkflowRelation.DEPENDS_ON
    )
    by_target = {edge.target_key: edge for edge in edges}
    assert by_target["stale_target"].provenance.valid_to == now
    assert by_target["mid_target"].provenance.valid_to is None
    assert by_target["mid_target"].weight == pytest.approx(0.5)
    assert by_target["strong_target"].provenance.valid_to is None
    assert by_target["strong_target"].weight == pytest.approx(3.0)
    entries = await store.list_audit_entries(db)
    assert len(entries) == prior_count + 2
    decay_entries = [entry for entry in entries if entry.transaction_id == "tx-decay"]
    assert len(decay_entries) == 2
    assert all(entry.action is AuditAction.CLOSE_EDGE for entry in decay_entries)
    after_weights = [
        MemoryEdge.model_validate_json(
            decode_audit_snapshot(entry.payload_json).after_json or "{}"
        ).weight
        for entry in decay_entries
    ]
    assert sorted(after_weights) == [pytest.approx(0.25), pytest.approx(0.5)]


async def _run_decay_check(db_path: Path) -> None:
    now = _T0 + timedelta(days=90)
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope("decay-proj")
        writer = MemoryWriteService(store)
        maint = GraphMaintenanceService(store, writer)
        await _seed_decay_graph(writer, db)
        prior_entries = await store.list_audit_entries(db)
        result = await maint.apply_edge_decay(
            db,
            now=now,
            config=DecayConfig(half_life_days=30.0, min_active_weight=0.1, max_weight_to_decay=1.5),
            provenance=_prov(now),
            transaction_id="tx-decay",
        )
        assert result.inspected_edges == 2
        assert result.decayed_edges == 1
        assert result.closed_edges == 1
        all_entries = await store.list_audit_entries(db)
        for prior in prior_entries:
            assert prior in all_entries
        await _verify_decay_state(store, db, now, len(prior_entries))


def test_decay_math_and_edge_decay_preserves_audit_history(tmp_path: Path) -> None:
    assert compute_decayed_weight(1.0, 30.0, 30.0) == pytest.approx(0.5)
    assert compute_decayed_weight(1.0, 0.0, 30.0) == 1.0
    with pytest.raises(ValueError, match="weight must be non-negative"):
        compute_decayed_weight(-0.1, 10.0, 30.0)
    with pytest.raises(ValueError, match="half_life_days must be positive"):
        compute_decayed_weight(1.0, 10.0, 0.0)
    with pytest.raises(ValueError, match="half_life_days must be positive"):
        compute_decayed_weight(1.0, 10.0, -5.0)
    asyncio.run(_run_decay_check(tmp_path / "decay.db"))


async def _seed_merge_graph(writer: MemoryWriteService, db: str) -> None:
    nodes = (
        _node(NodeKind.CONCEPT, "primary_db", "primary database"),
        _node(NodeKind.CONCEPT, "dup_db", "duplicate database"),
        _node(NodeKind.ENTITY, "app", "application service"),
        _node(NodeKind.CONCEPT, "storage", "storage engine"),
    )
    for idx, node in enumerate(nodes, start=1):
        await writer.write_node(db, node, transaction_id=f"tx-m-n-{idx}")
    edges = (
        _edge(WorkflowRelation.DEPENDS_ON, (NodeKind.ENTITY, "app"), (NodeKind.CONCEPT, "dup_db")),
        _edge(ConceptNetRelation.IS_A, (NodeKind.CONCEPT, "dup_db"), (NodeKind.CONCEPT, "storage")),
        _edge(
            ConceptNetRelation.IS_A, (NodeKind.CONCEPT, "primary_db"), (NodeKind.CONCEPT, "dup_db")
        ),
    )
    for idx, edge in enumerate(edges, start=1):
        await writer.write_edge(db, edge, transaction_id=f"tx-m-e-{idx}")


async def _verify_merge_state(
    store: SurrealMemoryStore,
    db: str,
    merge_ts: datetime,
    prior_entries: tuple[object, ...],
) -> None:
    dup_node = await store.get_node(db, NodeKind.CONCEPT, "dup_db")
    assert dup_node is not None
    assert dup_node.provenance.valid_to == merge_ts
    app_edges = await store.list_outgoing_edges(db, NodeKind.ENTITY, "app")
    active_app = [edge for edge in app_edges if edge.provenance.valid_to is None]
    assert len(active_app) == 1
    assert active_app[0].relation is WorkflowRelation.DEPENDS_ON
    assert active_app[0].target_key == "primary_db"
    primary_edges = await store.list_outgoing_edges(db, NodeKind.CONCEPT, "primary_db")
    active_primary = {
        (edge.relation, edge.target_key)
        for edge in primary_edges
        if edge.provenance.valid_to is None
    }
    assert active_primary == {
        (ConceptNetRelation.IS_A, "storage"),
        (WorkflowRelation.SUPERSEDES, "dup_db"),
    }
    entries = await store.list_audit_entries(db)
    for prior in prior_entries:
        assert prior in entries
    merge_entries = [entry for entry in entries if entry.transaction_id == "tx-merge"]
    assert len(merge_entries) == 7
    assert any(entry.action is AuditAction.UPDATE_NODE for entry in merge_entries)
    assert sum(1 for entry in merge_entries if entry.action is AuditAction.CLOSE_EDGE) == 3
    assert sum(1 for entry in merge_entries if entry.action is AuditAction.CREATE_EDGE) == 3


async def _run_merge_check(db_path: Path) -> None:
    merge_ts = _T0 + timedelta(days=5)
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope("merge-proj")
        writer = MemoryWriteService(store)
        maint = GraphMaintenanceService(store, writer)
        await _seed_merge_graph(writer, db)
        prior_entries = await store.list_audit_entries(db)
        result = await maint.merge_nodes(
            db,
            NodeKind.CONCEPT,
            "primary_db",
            "dup_db",
            provenance=_prov(merge_ts),
            transaction_id="tx-merge",
        )
        assert result.rewired_edges == 2
        assert result.closed_edges == 3
        await _verify_merge_state(store, db, merge_ts, prior_entries)


def test_merge_nodes_rewires_edges_and_preserves_audit_log(tmp_path: Path) -> None:
    asyncio.run(_run_merge_check(tmp_path / "merge.db"))


def _verify_duplicate_candidates() -> None:
    later_ts = _T0 + timedelta(days=2)
    nodes = (
        _node(
            NodeKind.CONCEPT, "c_later", "sqlite db", ts=later_ts, embedding=(0.99, 0.1, 0.0, 0.0)
        ),
        _node(
            NodeKind.CONCEPT, "c_earlier", "sqlite database", ts=_T0, embedding=(1.0, 0.0, 0.0, 0.0)
        ),
        _node(NodeKind.CONCEPT, "c_other", "redis cache", ts=_T0, embedding=(0.0, 1.0, 0.0, 0.0)),
        _node(
            NodeKind.ENTITY, "e_same_vec", "sqlite entity", ts=_T0, embedding=(1.0, 0.0, 0.0, 0.0)
        ),
        _node(
            NodeKind.CONCEPT,
            "c_closed",
            "closed sqlite",
            ts=_T0,
            embedding=(1.0, 0.0, 0.0, 0.0),
        ).model_copy(update={"provenance": _prov(_T0).model_copy(update={"valid_to": later_ts})}),
    )
    candidates = find_duplicate_candidates(nodes, similarity_threshold=0.9)
    assert len(candidates) == 1
    assert candidates[0].kind is NodeKind.CONCEPT
    assert candidates[0].primary_key == "c_earlier"
    assert candidates[0].duplicate_key == "c_later"
    assert candidates[0].similarity > 0.99


async def _seed_health_and_episodes(writer: MemoryWriteService, db: str) -> None:
    nodes = (
        _node(NodeKind.ERROR, "err_lock", "sqlite lock timeout"),
        _node(NodeKind.FIX, "fix_wal", "enable WAL mode"),
        _node(NodeKind.EPISODE, "ep_1", "lock episode one"),
        _node(NodeKind.EPISODE, "ep_2", "lock episode two"),
        _node(NodeKind.ENTITY, "orphan_one", "unconnected entity"),
    )
    for idx, node in enumerate(nodes, start=1):
        await writer.write_node(db, node, transaction_id=f"tx-h-n-{idx}")
    edges = (
        _edge(ConceptNetRelation.CAUSES, (NodeKind.EPISODE, "ep_1"), (NodeKind.ERROR, "err_lock")),
        _edge(WorkflowRelation.FIXED_BY, (NodeKind.EPISODE, "ep_1"), (NodeKind.FIX, "fix_wal")),
        _edge(ConceptNetRelation.CAUSES, (NodeKind.EPISODE, "ep_2"), (NodeKind.ERROR, "err_lock")),
        _edge(WorkflowRelation.FIXED_BY, (NodeKind.EPISODE, "ep_2"), (NodeKind.FIX, "fix_wal")),
    )
    for idx, edge in enumerate(edges, start=1):
        await writer.write_edge(db, edge, transaction_id=f"tx-h-e-{idx}")


async def _verify_consolidation_state(
    store: SurrealMemoryStore,
    db: str,
    cons_ts: datetime,
) -> None:
    rule_node = await store.get_node(db, NodeKind.FIX, "rule_err_lock_fix_wal")
    assert rule_node is not None
    assert rule_node.provenance.confidence == 1.0
    err_edges = await store.list_outgoing_edges(
        db, NodeKind.ERROR, "err_lock", relation=WorkflowRelation.FIXED_BY
    )
    active_rule_edges = [
        edge
        for edge in err_edges
        if edge.provenance.valid_to is None and edge.target_key == "rule_err_lock_fix_wal"
    ]
    assert len(active_rule_edges) == 1
    assert active_rule_edges[0].weight == 2.0
    for ep_key in ("ep_1", "ep_2"):
        ep_node = await store.get_node(db, NodeKind.EPISODE, ep_key)
        assert ep_node is not None
        assert ep_node.provenance.valid_to == cons_ts


async def _run_health_and_consolidation(db_path: Path) -> None:
    cons_ts = _T0 + timedelta(days=7)
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope("health-proj")
        writer = MemoryWriteService(store)
        maint = GraphMaintenanceService(store, writer)
        await _seed_health_and_episodes(writer, db)
        health = await maint.graph_health(db)
        assert health.total_nodes == 5
        assert health.total_active_edges == 4
        assert health.node_counts == {
            "entity": 1,
            "concept": 0,
            "preference": 0,
            "error": 1,
            "fix": 1,
            "episode": 2,
        }
        assert health.edge_counts["Causes"] == 2
        assert health.edge_counts["FixedBy"] == 2
        assert health.orphan_node_count == 1
        assert "entity:orphan_one" in health.orphan_node_ids
        result = await maint.consolidate_episodes(
            db, min_occurrences=2, provenance=_prov(cons_ts), transaction_id="tx-consolidate"
        )
        assert result.promoted_fixes == 1
        assert result.created_fix_keys == ("rule_err_lock_fix_wal",)
        await _verify_consolidation_state(store, db, cons_ts)


def test_episode_consolidation_graph_health_and_duplicate_candidates(tmp_path: Path) -> None:
    _verify_duplicate_candidates()
    asyncio.run(_run_health_and_consolidation(tmp_path / "health.db"))
