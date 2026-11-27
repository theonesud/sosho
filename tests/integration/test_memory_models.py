import asyncio
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import yaml
from pydantic import BaseModel, ConfigDict, SecretStr, TypeAdapter, ValidationError
from sosho_memory import (
    AgentRole,
    ConceptNetRelation,
    LiteLLMClient,
    MemoryEdge,
    MemoryNode,
    MemorySettings,
    MemoryWriteService,
    NodeKind,
    OntologyCurator,
    Provenance,
    SurrealMemoryStore,
    WorkflowRelation,
    concept_slug,
    load_memory_settings,
)

from tests import conftest
from tests.conftest import LITELLM_URL, ROOT, require_service

pytestmark = pytest.mark.integration

_BASE_TIME = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)


class _LiteLLMParams(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model: str = ""


class _LiteLLMRole(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model_name: str
    litellm_params: _LiteLLMParams = _LiteLLMParams()


class _LiteLLMConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model_list: list[_LiteLLMRole]


class _LlamaModelStatus(BaseModel):
    model_config = ConfigDict(extra="ignore")
    value: str = ""


class _LlamaModelEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    status: _LlamaModelStatus | str | None = None


class _LlamaModelsEnvelope(BaseModel):
    model_config = ConfigDict(extra="ignore")
    data: list[_LlamaModelEntry]


_LLAMA_LIST_ADAPTER = TypeAdapter(list[_LlamaModelEntry])


def _provenance(minute: int = 0) -> Provenance:
    ts = _BASE_TIME + timedelta(minutes=minute)
    return Provenance(
        valid_from=ts,
        valid_to=None,
        confidence=0.95,
        agent_id="integration-memory-test",
        agent_role=AgentRole.COORDINATOR,
        session_id="sess-memory-models",
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


def _resolve_llama_url() -> str:
    configured = getattr(conftest, "LLAMA_URL", None)
    if isinstance(configured, str) and configured.strip():
        return configured.rstrip("/")
    env_url = os.environ.get("SOSHO_LLAMA_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    return f"http://127.0.0.1:{8080}"


def _gpu_model_ids() -> frozenset[str]:
    text = (ROOT / "docker" / "litellm.yaml").read_text(encoding="utf-8")
    config = _LiteLLMConfig.model_validate(yaml.safe_load(text))
    ids = {"local-uncensored"}
    for entry in config.model_list:
        if entry.model_name == "local-uncensored" and entry.litellm_params.model:
            ids.add(entry.litellm_params.model.removeprefix("openai/"))
    return frozenset(ids)


def _entry_status(entry: _LlamaModelEntry) -> str:
    if isinstance(entry.status, _LlamaModelStatus):
        return entry.status.value.lower()
    if isinstance(entry.status, str):
        return entry.status.lower()
    return ""


def _parse_llama_models(raw: bytes) -> list[_LlamaModelEntry]:
    try:
        return _LlamaModelsEnvelope.model_validate_json(raw).data
    except ValidationError:
        return _LLAMA_LIST_ADAPTER.validate_json(raw)


def _loaded_gpu_models(llama_url: str, gpu_ids: frozenset[str]) -> set[str] | None:
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{llama_url}/models")
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    try:
        entries = _parse_llama_models(resp.content)
    except ValidationError:
        return None
    return {
        entry.id
        for entry in entries
        if entry.id in gpu_ids and _entry_status(entry) in {"loaded", "loading"}
    }


async def _run_embed_roundtrip(db_path: Path, litellm_key: str) -> None:
    sentence = "Sosho stores embedded vectors in SurrealDB."
    probe_settings = _settings(db_path, litellm_key)
    async with LiteLLMClient(probe_settings) as client:
        vectors = await client.embed([sentence])
    assert len(vectors) == 1
    vector = vectors[0]
    assert len(vector) > 0

    store_settings = _settings(db_path, litellm_key, embedding_dimensions=len(vector))
    node = MemoryNode(
        kind=NodeKind.CONCEPT,
        key="embed_roundtrip_probe",
        label="embed roundtrip probe",
        content=sentence,
        embedding=vector,
        provenance=_provenance(),
    )
    async with SurrealMemoryStore(store_settings) as store:
        db = await store.ensure_user_scope()
        service = MemoryWriteService(store)
        await service.write_node(db, node, transaction_id="tx-embed-probe")
        loaded = await store.get_node(db, NodeKind.CONCEPT, "embed_roundtrip_probe")
    assert loaded is not None
    assert loaded.embedding == vector


async def _seed_preference_graph(
    service: MemoryWriteService,
    db: str,
    seed_prov: Provenance,
) -> tuple[str, MemoryEdge]:
    nodes = (
        MemoryNode(
            kind=NodeKind.ENTITY,
            key="user",
            label="user",
            content="primary user",
            provenance=seed_prov,
        ),
        MemoryNode(
            kind=NodeKind.PREFERENCE,
            key="verbose_output",
            label="verbose output",
            content="User prefers verbose output.",
            provenance=seed_prov,
        ),
        MemoryNode(
            kind=NodeKind.PREFERENCE,
            key="concise_output",
            label="concise output",
            content="User prefers concise output.",
            provenance=seed_prov,
        ),
    )
    for idx, node in enumerate(nodes):
        await service.write_node(db, node, transaction_id=f"tx-seed-node-{idx}")
    old_edge = MemoryEdge(
        relation=WorkflowRelation.PREFERS_OVER,
        source_kind=NodeKind.ENTITY,
        source_key="user",
        target_kind=NodeKind.PREFERENCE,
        target_key="verbose_output",
        provenance=seed_prov,
    )
    audit_entry = await service.write_edge(db, old_edge, transaction_id="tx-seed-edge")
    return audit_entry.target_id, old_edge


async def _verify_contradiction_resolution(
    curator: OntologyCurator,
    store: SurrealMemoryStore,
    db: str,
    old_edge_id: str,
    old_edge: MemoryEdge,
) -> None:
    curate_prov = _provenance(minute=1)
    new_edge = MemoryEdge(
        relation=WorkflowRelation.PREFERS_OVER,
        source_kind=NodeKind.ENTITY,
        source_key="user",
        target_kind=NodeKind.PREFERENCE,
        target_key="concise_output",
        provenance=curate_prov,
    )
    result = await curator.resolve_and_write_edge(
        db,
        new_edge,
        ((old_edge_id, old_edge),),
        provenance=curate_prov,
        transaction_id="tx-resolve-contradiction",
    )
    assert result.contradicted is True
    assert len(result.closed_edge_ids) == 1
    assert len(result.supersedes_edge_ids) == 1

    prefers_edges = await store.list_outgoing_edges(
        db,
        NodeKind.ENTITY,
        "user",
        relation=WorkflowRelation.PREFERS_OVER,
    )
    closed_edges = [edge for edge in prefers_edges if edge.target_key == "verbose_output"]
    active_edges = [edge for edge in prefers_edges if edge.target_key == "concise_output"]
    assert len(closed_edges) == 1
    assert closed_edges[0].provenance.valid_to is not None
    assert len(active_edges) == 1
    assert active_edges[0].provenance.valid_to is None

    supersedes_edges = await store.list_outgoing_edges(
        db,
        NodeKind.PREFERENCE,
        "concise_output",
        relation=WorkflowRelation.SUPERSEDES,
    )
    assert len(supersedes_edges) == 1
    assert supersedes_edges[0].target_key == "verbose_output"


async def _verify_unknown_term_attachment(
    curator: OntologyCurator,
    store: SurrealMemoryStore,
    db: str,
) -> None:
    attach_prov = _provenance(minute=2)
    growth = await curator.attach_unknown_concept(
        db,
        "surrealkv",
        "embedded key value storage engine",
        (),
        provenance=attach_prov,
        transaction_id="tx-attach-surrealkv",
    )
    assert growth.term == "surrealkv"
    assert growth.attached_parent.strip()
    assert isinstance(growth.relation, ConceptNetRelation)
    assert growth.created_edge_id

    term_node = await store.get_node(db, NodeKind.CONCEPT, "surrealkv")
    assert term_node is not None
    assert term_node.embedding is not None
    outgoing = await store.list_outgoing_edges(
        db,
        NodeKind.CONCEPT,
        "surrealkv",
        relation=growth.relation,
    )
    parent_slug = concept_slug(growth.attached_parent)
    assert any(edge.target_key == parent_slug for edge in outgoing)


async def _run_curation_flow(db_path: Path, litellm_key: str) -> None:
    probe_settings = _settings(db_path, litellm_key)
    async with LiteLLMClient(probe_settings) as client:
        probe_vecs = await client.embed(["surrealkv"])
        dims = len(probe_vecs[0])
        store_settings = _settings(db_path, litellm_key, embedding_dimensions=dims)
        async with SurrealMemoryStore(store_settings) as store:
            db = await store.ensure_user_scope()
            service = MemoryWriteService(store)
            curator = OntologyCurator(service, client)
            old_edge_id, old_edge = await _seed_preference_graph(service, db, _provenance(minute=0))
            await _verify_contradiction_resolution(curator, store, db, old_edge_id, old_edge)
            await _verify_unknown_term_attachment(curator, store, db)


async def _run_embed_only(litellm_key: str) -> None:
    settings = load_memory_settings(
        surreal_url="mem://",
        litellm_url=LITELLM_URL,
        litellm_api_key=SecretStr(litellm_key),
        model_timeout_seconds=180.0,
    )
    async with LiteLLMClient(settings) as client:
        vectors = await client.embed(["CPU-only memory embed check."])
    assert len(vectors) == 1
    assert len(vectors[0]) > 0


def test_embed_vectors_match_surrealdb_index(tmp_path: Path, litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    asyncio.run(_run_embed_roundtrip(tmp_path / "embed.db", litellm_key))


def test_decision_closes_contradiction_and_attaches_unknown_term(
    tmp_path: Path,
    litellm_key: str,
) -> None:
    require_service("litellm", LITELLM_URL)
    asyncio.run(_run_curation_flow(tmp_path / "curate.db", litellm_key))


def test_memory_model_calls_do_not_load_gpu_role(litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    llama_url = _resolve_llama_url()
    gpu_ids = _gpu_model_ids()
    before_loaded = _loaded_gpu_models(llama_url, gpu_ids)
    asyncio.run(_run_embed_only(litellm_key))
    if before_loaded is not None:
        after_loaded = _loaded_gpu_models(llama_url, gpu_ids)
        assert after_loaded is not None
        assert not (after_loaded - before_loaded)
