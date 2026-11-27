import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sosho_memory import (
    AUDIT_LOG_TABLE,
    EDGE_TABLES,
    NODE_TABLES,
    ONTOLOGY_METADATA_TABLE,
    AgentRole,
    AuditAction,
    AuditLogEntry,
    ConceptNetRelation,
    MemoryConfigError,
    MemoryEdge,
    MemoryNode,
    MemorySettings,
    MemoryStorageError,
    MemoryValidationError,
    NodeKind,
    OntologyMetadata,
    Provenance,
    RelationType,
    SurrealMemoryStore,
    WorkflowRelation,
    load_memory_settings,
)

_BASE_TIME = datetime(2026, 1, 15, 10, 0, 0, tzinfo=UTC)


def _provenance(session_id: str = "sess-1", minute: int = 0) -> Provenance:
    ts = _BASE_TIME + timedelta(minutes=minute)
    return Provenance(
        valid_from=ts,
        valid_to=None,
        confidence=0.95,
        agent_id="agent-1",
        agent_role=AgentRole.COORDINATOR,
        session_id=session_id,
        timestamp=ts,
    )


def _node(
    kind: NodeKind,
    key: str,
    content: str,
    embedding: tuple[float, ...] | None = None,
    session_id: str = "sess-1",
) -> MemoryNode:
    return MemoryNode(
        kind=kind,
        key=key,
        label=f"{kind.value}:{key}",
        content=content,
        embedding=embedding,
        provenance=_provenance(session_id=session_id),
    )


def _edge(
    relation: RelationType,
    source: tuple[NodeKind, str],
    target: tuple[NodeKind, str],
    weight: float = 1.0,
    session_id: str = "sess-1",
) -> MemoryEdge:
    return MemoryEdge(
        relation=relation,
        source_kind=source[0],
        source_key=source[1],
        target_kind=target[0],
        target_key=target[1],
        weight=weight,
        provenance=_provenance(session_id=session_id),
    )


def _audit(
    transaction_id: str,
    session_id: str,
    payload_json: str,
    minute: int = 0,
) -> AuditLogEntry:
    return AuditLogEntry(
        transaction_id=transaction_id,
        session_id=session_id,
        agent_id="agent-1",
        agent_role=AgentRole.SYSTEM,
        action=AuditAction.CREATE_NODE,
        target_table="entity",
        target_id="entity:repo_sosho",
        payload_json=payload_json,
        timestamp=_BASE_TIME + timedelta(minutes=minute),
    )


async def _verify_schema_and_nodes(
    store: SurrealMemoryStore,
    db: str,
) -> tuple[MemoryNode, MemoryNode, MemoryNode, MemoryNode]:
    tables = await store.table_names(db)
    assert len(NODE_TABLES) == 6
    assert len(EDGE_TABLES) == 11
    assert set(NODE_TABLES).issubset(tables)
    assert set(EDGE_TABLES).issubset(tables)
    assert AUDIT_LOG_TABLE in tables
    assert ONTOLOGY_METADATA_TABLE in tables

    nodes = (
        _node(NodeKind.ENTITY, "repo_sosho", "Sosho repository", embedding=(0.1, 0.2, 0.3, 0.4)),
        _node(NodeKind.CONCEPT, "graph_memory", "Graph memory architecture"),
        _node(NodeKind.ERROR, "err_timeout", "Request timed out", embedding=(0.5, 0.6, 0.7, 0.8)),
        _node(NodeKind.FIX, "fix_retry", "Retry with exponential backoff"),
    )
    for node in nodes:
        assert await store.upsert_node(db, node) == node
        assert await store.get_node(db, node.kind, node.key) == node

    invalid_node = _node(NodeKind.ENTITY, "bad_vec", "Invalid dims", embedding=(1.0, 2.0))
    with pytest.raises(MemoryValidationError):
        await store.upsert_node(db, invalid_node)
    return nodes


async def _verify_edges_audit_and_delete(
    store: SurrealMemoryStore,
    db: str,
) -> tuple[MemoryEdge, MemoryEdge, MemoryEdge, AuditLogEntry, AuditLogEntry]:
    isa_edge = _edge(
        ConceptNetRelation.IS_A,
        (NodeKind.ENTITY, "repo_sosho"),
        (NodeKind.CONCEPT, "graph_memory"),
    )
    depends_edge = _edge(
        WorkflowRelation.DEPENDS_ON,
        (NodeKind.ENTITY, "repo_sosho"),
        (NodeKind.FIX, "fix_retry"),
    )
    fixed_edge = _edge(
        WorkflowRelation.FIXED_BY,
        (NodeKind.ERROR, "err_timeout"),
        (NodeKind.FIX, "fix_retry"),
    )
    for edge in (isa_edge, depends_edge, fixed_edge):
        assert await store.create_edge(db, edge) == edge

    assert await store.list_outgoing_edges(db, NodeKind.ENTITY, "repo_sosho") == (
        isa_edge,
        depends_edge,
    )
    assert await store.list_outgoing_edges(
        db, NodeKind.ENTITY, "repo_sosho", relation=ConceptNetRelation.IS_A
    ) == (isa_edge,)
    assert await store.list_outgoing_edges(
        db, NodeKind.ERROR, "err_timeout", relation=WorkflowRelation.FIXED_BY
    ) == (fixed_edge,)

    audit_1 = _audit("tx-1", "sess-1", '{"step":1}', minute=1)
    audit_2 = _audit("tx-2", "sess-2", '{"step":2}', minute=2)
    assert await store.append_audit_entry(db, audit_1) == audit_1
    assert await store.append_audit_entry(db, audit_2) == audit_2
    assert await store.list_audit_entries(db) == (audit_1, audit_2)
    assert await store.list_audit_entries(db, transaction_id="tx-1") == (audit_1,)
    assert await store.list_audit_entries(db, session_id="sess-2") == (audit_2,)

    temp_node = _node(NodeKind.PREFERENCE, "pref_temp", "Temporary preference")
    await store.upsert_node(db, temp_node)
    assert await store.delete_node(db, NodeKind.PREFERENCE, "pref_temp") is True
    assert await store.delete_node(db, NodeKind.PREFERENCE, "pref_temp") is False
    assert await store.get_node(db, NodeKind.PREFERENCE, "pref_temp") is None
    return isa_edge, depends_edge, fixed_edge, audit_1, audit_2


async def _verify_ontology_and_ensure_edge(
    store: SurrealMemoryStore,
    db: str,
) -> tuple[MemoryEdge, OntologyMetadata]:
    assert await store.get_ontology_metadata(db, "conceptnet-5.7") is None
    initial_meta = OntologyMetadata(
        dataset_version="conceptnet-5.7",
        filter_fingerprint="fp-1",
        concept_count=10,
        spine_edge_count=5,
        lateral_edge_count=3,
        loaded_at=_BASE_TIME,
        session_id="sess-1",
    )
    assert await store.upsert_ontology_metadata(db, initial_meta) == initial_meta
    updated_meta = initial_meta.model_copy(
        update={"concept_count": 12, "filter_fingerprint": "fp-2"}
    )
    assert await store.upsert_ontology_metadata(db, updated_meta) == updated_meta
    assert await store.get_ontology_metadata(db, "conceptnet-5.7") == updated_meta

    part_edge = _edge(
        ConceptNetRelation.PART_OF,
        (NodeKind.CONCEPT, "graph_memory"),
        (NodeKind.ENTITY, "repo_sosho"),
        weight=1.0,
    )
    saved_first, created_first = await store.ensure_edge(db, part_edge)
    assert created_first is True
    assert saved_first == part_edge

    part_edge_reweighted = part_edge.model_copy(update={"weight": 2.5})
    saved_second, created_second = await store.ensure_edge(db, part_edge_reweighted)
    assert created_second is False
    assert saved_second == part_edge_reweighted
    assert await store.list_outgoing_edges(
        db, NodeKind.CONCEPT, "graph_memory", relation=ConceptNetRelation.PART_OF
    ) == (part_edge_reweighted,)
    return part_edge_reweighted, updated_meta


async def _run_roundtrip_persistence(db_path: Path) -> None:
    settings = load_memory_settings(
        surreal_url=f"surrealkv://{db_path}",
        embedding_dimensions=4,
    )
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_user_scope()
        nodes = await _verify_schema_and_nodes(store, db)
        isa_edge, depends_edge, fixed_edge, audit_1, audit_2 = await _verify_edges_audit_and_delete(
            store, db
        )
        part_edge, ontology_meta = await _verify_ontology_and_ensure_edge(store, db)

    async with SurrealMemoryStore(settings) as reopened:
        assert await reopened.get_node(db, NodeKind.ENTITY, "repo_sosho") == nodes[0]
        assert await reopened.get_node(db, NodeKind.PREFERENCE, "pref_temp") is None
        assert await reopened.list_outgoing_edges(db, NodeKind.ENTITY, "repo_sosho") == (
            isa_edge,
            depends_edge,
        )
        assert await reopened.list_outgoing_edges(
            db, NodeKind.ERROR, "err_timeout", relation=WorkflowRelation.FIXED_BY
        ) == (fixed_edge,)
        assert await reopened.list_outgoing_edges(
            db, NodeKind.CONCEPT, "graph_memory", relation=ConceptNetRelation.PART_OF
        ) == (part_edge,)
        assert await reopened.list_audit_entries(db) == (audit_1, audit_2)
        assert await reopened.get_ontology_metadata(db, "conceptnet-5.7") == ontology_meta


def test_schema_and_roundtrip_persistence_on_surrealkv(tmp_path: Path) -> None:
    asyncio.run(_run_roundtrip_persistence(tmp_path / "mem.db"))


async def _seed_scope(
    store: SurrealMemoryStore,
    db: str,
    tag: str,
    weight: float,
) -> tuple[MemoryNode, MemoryNode, MemoryEdge, AuditLogEntry]:
    entity = _node(
        NodeKind.ENTITY,
        "shared_key",
        f"entity content for {tag}",
        embedding=(weight, 0.1, 0.2, 0.3),
        session_id=f"sess-{tag}",
    )
    concept = _node(
        NodeKind.CONCEPT,
        "shared_key",
        f"concept content for {tag}",
        session_id=f"sess-{tag}",
    )
    edge = _edge(
        ConceptNetRelation.IS_A,
        (NodeKind.ENTITY, "shared_key"),
        (NodeKind.CONCEPT, "shared_key"),
        weight=weight,
        session_id=f"sess-{tag}",
    )
    audit = _audit("shared-tx", f"sess-{tag}", f'{{"scope":"{tag}"}}')
    await store.upsert_node(db, entity)
    await store.upsert_node(db, concept)
    await store.create_edge(db, edge)
    await store.append_audit_entry(db, audit)
    return entity, concept, edge, audit


async def _run_scope_isolation(db_path: Path) -> None:
    settings = load_memory_settings(
        surreal_url=f"surrealkv://{db_path}",
        embedding_dimensions=4,
    )
    async with SurrealMemoryStore(settings) as store:
        user_db = await store.ensure_user_scope()
        alpha_db = await store.ensure_project_scope("project-alpha")
        beta_db = await store.ensure_project_scope("project-beta")
        expected = {
            user_db: await _seed_scope(store, user_db, "user", 1.0),
            alpha_db: await _seed_scope(store, alpha_db, "alpha", 2.0),
            beta_db: await _seed_scope(store, beta_db, "beta", 3.0),
        }
        for db, (entity, concept, edge, audit) in expected.items():
            assert await store.get_node(db, NodeKind.ENTITY, "shared_key") == entity
            assert await store.get_node(db, NodeKind.CONCEPT, "shared_key") == concept
            assert await store.list_outgoing_edges(db, NodeKind.ENTITY, "shared_key") == (edge,)
            assert await store.list_audit_entries(db) == (audit,)


def test_user_and_project_scopes_stay_isolated(tmp_path: Path) -> None:
    asyncio.run(_run_scope_isolation(tmp_path / "iso.db"))


async def _connect_failing_store(settings: MemorySettings) -> None:
    store = SurrealMemoryStore(settings)
    with pytest.raises(MemoryStorageError):
        await store.connect()


def test_invalid_config_and_storage_errors_fail_fast(tmp_path: Path) -> None:
    invalid_cases: tuple[dict[str, str | int], ...] = (
        {"surreal_url": "sqlite://bad.db"},
        {"namespace": "bad-ns"},
        {"user_database": "1invalid"},
        {"embedding_dimensions": 0},
    )
    for kwargs in invalid_cases:
        with pytest.raises(MemoryConfigError):
            load_memory_settings(
                surreal_url=str(kwargs["surreal_url"]) if "surreal_url" in kwargs else None,
                namespace=str(kwargs["namespace"]) if "namespace" in kwargs else None,
                user_database=(str(kwargs["user_database"]) if "user_database" in kwargs else None),
                embedding_dimensions=(
                    int(kwargs["embedding_dimensions"])
                    if "embedding_dimensions" in kwargs
                    else None
                ),
            )

    settings = load_memory_settings(surreal_url=f"surrealkv://{tmp_path / 'ok.db'}")
    assert settings.project_database_name("my-proj") == "project_my_proj"
    with pytest.raises(MemoryValidationError):
        settings.project_database_name("bad id!")

    disconnected = SurrealMemoryStore(settings)
    with pytest.raises(MemoryStorageError):
        asyncio.run(disconnected.ensure_user_scope())

    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory", encoding="utf-8")
    blocked_settings = load_memory_settings(surreal_url=f"surrealkv://{blocker / 'db'}")
    asyncio.run(_connect_failing_store(blocked_settings))
