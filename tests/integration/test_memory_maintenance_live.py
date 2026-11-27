import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import SecretStr
from sosho_memory import (
    AgentRole,
    AuditAction,
    ConceptNetRelation,
    ConsolidationResult,
    GraphMaintenanceService,
    LiteLLMClient,
    MemoryEdge,
    MemoryNode,
    MemorySettings,
    MemoryWriteService,
    MergeResult,
    NodeKind,
    Provenance,
    SurrealMemoryStore,
    WorkflowRelation,
    load_memory_settings,
)

from tests.conftest import LITELLM_URL, require_service

pytestmark = pytest.mark.integration

_BASE_TIME = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)


def _provenance(minute: int = 0) -> Provenance:
    ts = _BASE_TIME + timedelta(minutes=minute)
    return Provenance(
        valid_from=ts,
        valid_to=None,
        confidence=0.95,
        agent_id="integration-maintenance-test",
        agent_role=AgentRole.COORDINATOR,
        session_id="sess-maintenance-live",
        timestamp=ts,
    )


def _settings(
    db_path: Path,
    litellm_key: str,
    embedding_dimensions: int = 768,
) -> MemorySettings:
    return load_memory_settings(
        surreal_url=f"surrealkv://{db_path}",
        embedding_dimensions=embedding_dimensions,
        litellm_url=LITELLM_URL,
        litellm_api_key=SecretStr(litellm_key),
        model_timeout_seconds=180.0,
    )


async def _seed_duplicate_concepts(
    write_service: MemoryWriteService,
    db: str,
    vectors: tuple[tuple[float, ...], ...],
) -> None:
    prov = _provenance(minute=0)
    concepts = (
        MemoryNode(
            kind=NodeKind.CONCEPT,
            key="surrealkv_storage_engine",
            label="SurrealKV embedded storage engine",
            content="SurrealKV embedded storage engine",
            embedding=vectors[0],
            provenance=prov,
        ),
        MemoryNode(
            kind=NodeKind.CONCEPT,
            key="surrealkv_kv_storage_engine",
            label="SurrealKV embedded key-value storage engine",
            content="SurrealKV embedded key-value storage engine",
            embedding=vectors[1],
            provenance=prov,
        ),
    )
    for idx, node in enumerate(concepts):
        await write_service.write_node(db, node, transaction_id=f"tx-seed-concept-{idx}")


async def _seed_episode_pair(write_service: MemoryWriteService, db: str) -> None:
    prov = _provenance(minute=1)
    nodes = (
        MemoryNode(
            kind=NodeKind.ERROR,
            key="surrealkv_lock_timeout",
            label="SurrealKV lock timeout",
            content="SurrealKV lock timeout during concurrent writes",
            provenance=prov,
        ),
        MemoryNode(
            kind=NodeKind.FIX,
            key="serialize_writes_lock",
            label="Serialize writes with asyncio Lock",
            content="Serialize writes per database with asyncio Lock",
            provenance=prov,
        ),
        MemoryNode(
            kind=NodeKind.EPISODE,
            key="ep_lock_1",
            label="First lock timeout episode",
            content="Resolved lock timeout by serializing writes",
            provenance=prov,
        ),
        MemoryNode(
            kind=NodeKind.EPISODE,
            key="ep_lock_2",
            label="Second lock timeout episode",
            content="Resolved repeated lock timeout by serializing writes",
            provenance=prov,
        ),
    )
    for idx, node in enumerate(nodes):
        await write_service.write_node(db, node, transaction_id=f"tx-seed-ep-node-{idx}")
    for idx, ep_key in enumerate(("ep_lock_1", "ep_lock_2")):
        err_edge = MemoryEdge(
            relation=ConceptNetRelation.CAUSES,
            source_kind=NodeKind.EPISODE,
            source_key=ep_key,
            target_kind=NodeKind.ERROR,
            target_key="surrealkv_lock_timeout",
            provenance=prov,
        )
        fix_edge = MemoryEdge(
            relation=WorkflowRelation.FIXED_BY,
            source_kind=NodeKind.EPISODE,
            source_key=ep_key,
            target_kind=NodeKind.FIX,
            target_key="serialize_writes_lock",
            provenance=prov,
        )
        await write_service.write_edge(db, err_edge, transaction_id=f"tx-seed-ep-err-{idx}")
        await write_service.write_edge(db, fix_edge, transaction_id=f"tx-seed-ep-fix-{idx}")


async def _verify_merge(
    store: SurrealMemoryStore,
    db: str,
    merges: tuple[MergeResult, ...],
) -> None:
    assert len(merges) >= 1
    merge = merges[0]
    assert isinstance(merge, MergeResult)
    assert merge.kind is NodeKind.CONCEPT
    assert {merge.primary_key, merge.duplicate_key} == {
        "surrealkv_storage_engine",
        "surrealkv_kv_storage_engine",
    }
    closed_dup = await store.get_node(db, NodeKind.CONCEPT, merge.duplicate_key)
    assert closed_dup is not None
    assert closed_dup.provenance.valid_to is not None
    audit_entries = await store.list_audit_entries(db, transaction_id="tx-maint-merge")
    assert any(
        entry.action is AuditAction.UPDATE_NODE
        and entry.target_id == f"concept:{merge.duplicate_key}"
        for entry in audit_entries
    )
    assert any(
        entry.action is AuditAction.CREATE_EDGE
        and entry.target_table == WorkflowRelation.SUPERSEDES.value
        for entry in audit_entries
    )


async def _verify_consolidation(
    store: SurrealMemoryStore,
    db: str,
    consolidation: ConsolidationResult,
) -> None:
    expected_rule_key = "rule_surrealkv_lock_timeout_serialize_writes_lock"
    assert consolidation.promoted_fixes == 1
    assert consolidation.source_episode_keys == ("ep_lock_1", "ep_lock_2")
    assert consolidation.created_fix_keys == (expected_rule_key,)
    promoted = await store.get_node(db, NodeKind.FIX, expected_rule_key)
    assert promoted is not None
    assert promoted.label.startswith("Procedural fix:")
    assert promoted.provenance.confidence == 1.0
    fixed_by_edges = await store.list_outgoing_edges(
        db,
        NodeKind.ERROR,
        "surrealkv_lock_timeout",
        relation=WorkflowRelation.FIXED_BY,
    )
    assert any(
        edge.target_key == expected_rule_key and edge.weight == 2.0 for edge in fixed_by_edges
    )
    for ep_key in ("ep_lock_1", "ep_lock_2"):
        ep_node = await store.get_node(db, NodeKind.EPISODE, ep_key)
        assert ep_node is not None
        assert ep_node.provenance.valid_to is not None


async def _run_live_maintenance(db_path: Path, litellm_key: str) -> None:
    texts = [
        "SurrealKV embedded storage engine",
        "SurrealKV embedded key-value storage engine",
    ]
    probe_settings = _settings(db_path, litellm_key)
    async with LiteLLMClient(probe_settings) as client:
        vectors = await client.embed(texts)
        assert len(vectors) == 2
        dims = len(vectors[0])
        assert dims > 0
        assert len(vectors[1]) == dims
        store_settings = _settings(db_path, litellm_key, embedding_dimensions=dims)
        async with SurrealMemoryStore(store_settings) as store:
            db = await store.ensure_project_scope("maint")
            assert db == "project_maint"
            write_service = MemoryWriteService(store)
            await _seed_duplicate_concepts(write_service, db, vectors)
            maintenance = GraphMaintenanceService(store, write_service, client)
            merges = await maintenance.detect_and_merge_duplicates(
                db,
                similarity_threshold=0.80,
                provenance=_provenance(minute=2),
                transaction_id="tx-maint-merge",
            )
            await _verify_merge(store, db, merges)
            await _seed_episode_pair(write_service, db)
            consolidation = await maintenance.consolidate_episodes(
                db,
                min_occurrences=2,
                provenance=_provenance(minute=3),
                transaction_id="tx-maint-consolidate",
            )
            await _verify_consolidation(store, db, consolidation)


def test_live_duplicate_merge_and_episode_consolidation(
    tmp_path: Path,
    litellm_key: str,
) -> None:
    require_service("litellm", LITELLM_URL)
    asyncio.run(_run_live_maintenance(tmp_path / "maint_live.db", litellm_key))
