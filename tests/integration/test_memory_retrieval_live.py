import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import SecretStr
from sosho_memory import (
    AgentRole,
    ContextPack,
    LiteLLMClient,
    MemoryEdge,
    MemoryNode,
    MemoryRetriever,
    MemorySettings,
    MemorySourceScope,
    MemoryWriteService,
    NodeKind,
    Provenance,
    SurrealMemoryStore,
    WorkflowRelation,
    load_memory_settings,
)

from tests.conftest import LITELLM_URL, require_service

pytestmark = pytest.mark.integration

_BASE_TIME = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)


def _provenance() -> Provenance:
    return Provenance(
        valid_from=_BASE_TIME,
        valid_to=None,
        confidence=0.95,
        agent_id="integration-retrieval-test",
        agent_role=AgentRole.COORDINATOR,
        session_id="sess-retrieval-live",
        timestamp=_BASE_TIME,
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


async def _seed_memories(
    store: SurrealMemoryStore,
    vectors: Sequence[Sequence[float]],
) -> None:
    prov = _provenance()
    service = MemoryWriteService(store)
    user_db = await store.ensure_user_scope()
    assert user_db == "user_memory"
    pref_node = MemoryNode(
        kind=NodeKind.PREFERENCE,
        key="concise_bullet_lists",
        label="concise bullet lists",
        content="Always reply in concise bullet lists",
        embedding=tuple(vectors[0]),
        provenance=prov,
    )
    await service.write_node(user_db, pref_node, transaction_id="tx-live-pref")

    project_db = await store.ensure_project_scope("live")
    assert project_db == "project_live"
    error_node = MemoryNode(
        kind=NodeKind.ERROR,
        key="surrealkv_lock_timeout",
        label="SurrealKV lock timeout",
        content="SurrealKV lock timeout during concurrent writes",
        embedding=tuple(vectors[1]),
        provenance=prov,
    )
    fix_node = MemoryNode(
        kind=NodeKind.FIX,
        key="serialize_writes_lock",
        label="Serialize writes with asyncio Lock",
        content="Serialize writes per database with asyncio Lock",
        embedding=tuple(vectors[2]),
        provenance=prov,
    )
    await service.write_node(project_db, error_node, transaction_id="tx-live-error")
    await service.write_node(project_db, fix_node, transaction_id="tx-live-fix")
    fixed_edge = MemoryEdge(
        relation=WorkflowRelation.FIXED_BY,
        source_kind=NodeKind.ERROR,
        source_key=error_node.key,
        target_kind=NodeKind.FIX,
        target_key=fix_node.key,
        provenance=prov,
    )
    await service.write_edge(project_db, fixed_edge, transaction_id="tx-live-fixed-by")


async def _run_live_retrieval(db_path: Path, litellm_key: str) -> ContextPack:
    texts = [
        "Always reply in concise bullet lists",
        "SurrealKV lock timeout during concurrent writes",
        "Serialize writes per database with asyncio Lock",
    ]
    probe_settings = _settings(db_path, litellm_key)
    async with LiteLLMClient(probe_settings) as client:
        vectors = await client.embed(texts)
        assert len(vectors) == 3
        dims = len(vectors[0])
        assert dims > 0
        assert all(len(vec) == dims for vec in vectors)
        store_settings = _settings(db_path, litellm_key, embedding_dimensions=dims)
        async with SurrealMemoryStore(store_settings) as store:
            await _seed_memories(store, vectors)
            retriever = MemoryRetriever(store, client)
            return await retriever.build_context_pack(
                project_id="live",
                query_text="database lock timeout",
                query_vector=None,
                token_budget=300,
            )


def test_live_hybrid_recall_preference_priority_and_error_fixes(
    tmp_path: Path,
    litellm_key: str,
) -> None:
    require_service("litellm", LITELLM_URL)
    pack = asyncio.run(_run_live_retrieval(tmp_path / "retrieval_live.db", litellm_key))
    assert len(pack.preferences) >= 1
    assert pack.preferences[0].node.kind is NodeKind.PREFERENCE
    assert pack.preferences[0].node.key == "concise_bullet_lists"
    assert pack.preferences[0].scope is MemorySourceScope.USER
    assert pack.preferences[0].priority_boost == 1.0
    assert any(
        pair.error_node.key == "surrealkv_lock_timeout"
        and pair.fix_node.key == "serialize_writes_lock"
        and pair.scope is MemorySourceScope.PROJECT
        for pair in pack.error_fixes
    )
    assert "[PREFERENCES]" in pack.rendered_text
    assert "[PAST ERROR FIXES]" in pack.rendered_text
    assert pack.rendered_text.index("[PREFERENCES]") < pack.rendered_text.index(
        "[PAST ERROR FIXES]"
    )
    assert "Always reply in concise bullet lists" in pack.rendered_text
    assert pack.estimated_tokens <= 300
    assert pack.token_budget == 300
