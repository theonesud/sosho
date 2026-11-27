import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sosho_memory import (
    NODE_TABLES,
    AgentRole,
    AuditLogEntry,
    ConceptNetRelation,
    MemoryNode,
    MemoryValidationError,
    MemoryWriteService,
    NodeKind,
    Provenance,
    SecretRejectedError,
    SurrealMemoryStore,
    UnapprovedRelationError,
    WorkflowRelation,
    load_memory_settings,
)

_BASE_TIME = datetime(2026, 2, 1, 9, 0, 0, tzinfo=UTC)


def _prov(
    *,
    agent_id: str = "coord-1",
    agent_role: AgentRole = AgentRole.COORDINATOR,
    session_id: str = "sess-base",
    minute: int = 0,
) -> Provenance:
    base_ts = _BASE_TIME + timedelta(minutes=minute)
    return Provenance(
        valid_from=base_ts,
        valid_to=None,
        confidence=0.9,
        agent_id=agent_id,
        agent_role=agent_role,
        session_id=session_id,
        timestamp=base_ts,
    )


def _node(
    kind: NodeKind,
    key: str,
    content: str,
    *,
    provenance: Provenance | None = None,
) -> MemoryNode:
    return MemoryNode(
        kind=kind,
        key=key,
        label=f"{kind.value}:{key}",
        content=content,
        provenance=provenance if provenance is not None else _prov(),
    )


def _secret_payloads() -> tuple[tuple[str, str], ...]:
    return (
        ("private_key", "".join(("-----BEGIN ", "RSA PRIVATE KEY-----"))),
        ("anthropic_key", "".join(("sk-ant-", "testtoken1234567890"))),
        ("github_token", "".join(("ghp_", "AbCdEfGhIjKlMnOpQrSt12"))),
        ("aws_key", "".join(("AKIA", "1234567890ABCDEF"))),
        ("credential_url", "".join(("https://", "user:pass", "@host/db"))),
        ("env_line", "".join(("LITELLM_MASTER_KEY", "=", "secret_val_999"))),
    )


async def _assert_secret_rejections(
    service: MemoryWriteService,
    store: SurrealMemoryStore,
    db: str,
) -> None:
    for idx, (label, secret) in enumerate(_secret_payloads()):
        node = _node(NodeKind.ENTITY, f"secret_{idx}", secret)
        with pytest.raises(SecretRejectedError) as exc_info:
            await service.write_node(db, node, transaction_id=f"tx-sec-{label}")
        assert secret not in str(exc_info.value)
        assert await store.get_node(db, NodeKind.ENTITY, f"secret_{idx}") is None
    for table in NODE_TABLES:
        raw = await store.run_query(db, "SELECT * FROM type::table($table);", {"table": table})
        assert raw == [[]]
    assert await store.list_audit_entries(db) == ()


async def _assert_provenance_and_relation_rejections(
    service: MemoryWriteService,
    store: SurrealMemoryStore,
    db: str,
) -> None:
    invalid_provenances = (
        _prov(agent_id="   "),
        _prov(session_id="   "),
        _prov().model_copy(update={"timestamp": datetime(2026, 2, 1, 9, 0, 0)}),
        _prov().model_copy(update={"valid_to": _BASE_TIME - timedelta(minutes=1)}),
    )
    for idx, bad_prov in enumerate(invalid_provenances):
        bad_node = _node(NodeKind.ENTITY, f"bad_prov_{idx}", "valid text", provenance=bad_prov)
        with pytest.raises(MemoryValidationError):
            await service.write_node(db, bad_node, transaction_id=f"tx-prov-{idx}")
    with pytest.raises(UnapprovedRelationError):
        await service.write_edge_by_name(
            db,
            "UnapprovedEdge",
            NodeKind.ENTITY,
            "src_node",
            NodeKind.CONCEPT,
            "dst_node",
            provenance=_prov(),
            transaction_id="tx-rel-bad",
        )
    assert await store.list_outgoing_edges(db, NodeKind.ENTITY, "src_node") == ()
    assert await store.list_audit_entries(db) == ()


async def _run_gate_checks(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope("gate-proj")
        service = MemoryWriteService(store)
        await _assert_secret_rejections(service, store, db)
        await _assert_provenance_and_relation_rejections(service, store, db)


def test_secret_gate_provenance_and_relation_allowlist(tmp_path: Path) -> None:
    asyncio.run(_run_gate_checks(tmp_path / "gate.db"))


async def _write_agent_graph(
    service: MemoryWriteService,
    db: str,
    role: AgentRole,
    agent_id: str,
    minute: int,
) -> tuple[MemoryNode, MemoryNode, Provenance, tuple[AuditLogEntry, ...]]:
    prov = _prov(agent_id=agent_id, agent_role=role, session_id=f"sess-{agent_id}", minute=minute)
    src = _node(NodeKind.ENTITY, f"{agent_id}_src", f"entity by {agent_id}", provenance=prov)
    dst = _node(NodeKind.CONCEPT, f"{agent_id}_dst", f"concept by {agent_id}", provenance=prov)
    e1 = await service.write_node(db, src, transaction_id=f"tx-{agent_id}-1")
    e2 = await service.write_node(db, dst, transaction_id=f"tx-{agent_id}-2")
    e3 = await service.write_edge_by_name(
        db,
        ConceptNetRelation.IS_A.value,
        NodeKind.ENTITY,
        src.key,
        NodeKind.CONCEPT,
        dst.key,
        provenance=prov,
        transaction_id=f"tx-{agent_id}-3",
    )
    return src, dst, prov, (e1, e2, e3)


async def _run_concurrent_tagged_writes(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    agents = (
        (AgentRole.COORDINATOR, "coord-1", 1),
        (AgentRole.SUBAGENT, "sub-1", 2),
        (AgentRole.SUBAGENT, "sub-2", 3),
        (AgentRole.SUBAGENT, "sub-3", 4),
    )
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope("concurrent-proj")
        service = MemoryWriteService(store)
        results = await asyncio.gather(
            *(_write_agent_graph(service, db, role, aid, m) for role, aid, m in agents)
        )
        entries = await store.list_audit_entries(db)
        assert len(entries) == 12
        by_tx = {entry.transaction_id: entry for entry in entries}
        for (src, dst, prov, created_entries), (role, aid, _) in zip(results, agents, strict=True):
            assert await store.get_node(db, NodeKind.ENTITY, src.key) == src
            assert await store.get_node(db, NodeKind.CONCEPT, dst.key) == dst
            edges = await store.list_outgoing_edges(
                db, NodeKind.ENTITY, src.key, relation=ConceptNetRelation.IS_A
            )
            assert len(edges) == 1
            assert edges[0].provenance == prov
            for created in created_entries:
                persisted = by_tx[created.transaction_id]
                assert persisted == created
                assert persisted.agent_id == aid
                assert persisted.agent_role == role
                assert persisted.session_id == f"sess-{aid}"
        report = await service.export_audit_log(db)
        for role, aid, _ in agents:
            assert aid in report
            assert role.value in report
        assert (
            await service.export_audit_log(db, session_id="missing") == "No audit entries recorded."
        )


def test_concurrent_coordinator_and_subagent_tagged_writes(tmp_path: Path) -> None:
    asyncio.run(_run_concurrent_tagged_writes(tmp_path / "concurrent.db"))


async def _run_tx_rollback_check(
    service: MemoryWriteService,
    store: SurrealMemoryStore,
    db: str,
    baseline_pref: MemoryNode,
) -> None:
    coord_prov = _prov(
        agent_id="coord-1", agent_role=AgentRole.COORDINATOR, session_id="sess-coord", minute=1
    )
    updated_pref = baseline_pref.model_copy(update={"content": "verbose", "provenance": coord_prov})
    fix_1 = _node(NodeKind.FIX, "fix_1", "increase timeout", provenance=coord_prov)
    await service.write_node(db, updated_pref, transaction_id="tx-coord-1")
    await service.write_node(db, fix_1, transaction_id="tx-coord-1")
    await service.write_edge_by_name(
        db,
        WorkflowRelation.FIXED_BY.value,
        NodeKind.ERROR,
        "err_timeout",
        NodeKind.FIX,
        "fix_1",
        provenance=coord_prov,
        transaction_id="tx-coord-1",
    )
    rollback = await service.rollback_transaction(db, "tx-coord-1")
    assert rollback.reverted_entries == 3
    assert rollback.reverted_transaction_ids == ("tx-coord-1",)
    assert await store.get_node(db, NodeKind.PREFERENCE, "pref_style") == baseline_pref
    assert await store.get_node(db, NodeKind.FIX, "fix_1") is None
    assert (
        await store.list_outgoing_edges(
            db, NodeKind.ERROR, "err_timeout", relation=WorkflowRelation.FIXED_BY
        )
        == ()
    )
    assert len(await store.list_audit_entries(db)) == 5
    assert len(await store.list_audit_entries(db, transaction_id="tx-coord-1")) == 3


async def _run_session_rollback_check(
    service: MemoryWriteService,
    store: SurrealMemoryStore,
    db: str,
    baseline_pref: MemoryNode,
    baseline_err: MemoryNode,
) -> None:
    sub_prov = _prov(
        agent_id="sub-9", agent_role=AgentRole.SUBAGENT, session_id="sess-sub-9", minute=2
    )
    fix_retry = _node(NodeKind.FIX, "fix_retry", "retry backoff", provenance=sub_prov)
    bullets_pref = baseline_pref.model_copy(update={"content": "bullets", "provenance": sub_prov})
    await service.write_node(db, fix_retry, transaction_id="tx-sub-1")
    await service.write_node(db, bullets_pref, transaction_id="tx-sub-2")
    edge_entry = await service.write_edge_by_name(
        db,
        WorkflowRelation.FIXED_BY.value,
        NodeKind.ERROR,
        "err_timeout",
        NodeKind.FIX,
        "fix_retry",
        provenance=sub_prov,
        transaction_id="tx-sub-3",
    )
    await service.close_edge(
        db,
        WorkflowRelation.FIXED_BY,
        edge_entry.target_id,
        valid_to=_BASE_TIME + timedelta(minutes=5),
        provenance=sub_prov,
        transaction_id="tx-sub-4",
    )
    await service.delete_node(
        db, NodeKind.ERROR, "err_timeout", provenance=sub_prov, transaction_id="tx-sub-5"
    )
    rollback = await service.rollback_session(db, "sess-sub-9")
    assert rollback.reverted_entries == 5
    assert await store.get_node(db, NodeKind.FIX, "fix_retry") is None
    assert await store.get_node(db, NodeKind.PREFERENCE, "pref_style") == baseline_pref
    assert await store.get_node(db, NodeKind.ERROR, "err_timeout") == baseline_err
    assert (
        await store.list_outgoing_edges(
            db, NodeKind.ERROR, "err_timeout", relation=WorkflowRelation.FIXED_BY
        )
        == ()
    )
    assert len(await store.list_audit_entries(db)) == 10
    assert len(await store.list_audit_entries(db, session_id="sess-sub-9")) == 5


async def _run_rollback_suite(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope("rollback-proj")
        service = MemoryWriteService(store)
        base_prov = _prov(session_id="sess-base", minute=0)
        baseline_pref = _node(NodeKind.PREFERENCE, "pref_style", "concise", provenance=base_prov)
        baseline_err = _node(NodeKind.ERROR, "err_timeout", "rpc timeout", provenance=base_prov)
        await service.write_node(db, baseline_pref, transaction_id="tx-base-1")
        await service.write_node(db, baseline_err, transaction_id="tx-base-2")
        await _run_tx_rollback_check(service, store, db, baseline_pref)
        await _run_session_rollback_check(service, store, db, baseline_pref, baseline_err)


def test_atomic_transaction_and_session_rollback_restores_exact_graph(tmp_path: Path) -> None:
    asyncio.run(_run_rollback_suite(tmp_path / "rollback.db"))
