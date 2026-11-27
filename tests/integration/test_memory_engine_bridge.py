import asyncio
from collections.abc import Sequence
from pathlib import Path

import pytest
from pydantic import JsonValue, SecretStr
from sosho_engine.memory_bridge import inject_engine_memory_context, register_memory_tools
from sosho_engine.tools import JsonDict, ToolRegistry
from sosho_memory import (
    LiteLLMClient,
    MemoryBridge,
    MemoryRetriever,
    MemorySettings,
    MemoryWriteService,
    NodeKind,
    SurrealMemoryStore,
    WorkflowRelation,
    load_memory_settings,
)

from tests.conftest import LITELLM_URL, require_service

pytestmark = pytest.mark.integration

_TEXTS = (
    "Always prefer short answers with exact file paths",
    "Port 8123 already in use when starting worker",
    "Stop the stale worker process before binding port 8123",
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


def _as_json_vector(vector: Sequence[float]) -> list[JsonValue]:
    return [float(value) for value in vector]


def _write_steps(vectors: Sequence[Sequence[float]]) -> list[tuple[str, JsonDict]]:
    return [
        (
            "memory_write_node",
            {
                "kind": NodeKind.PREFERENCE.value,
                "key": "pref_short_reply",
                "label": "Short reply preference",
                "content": _TEXTS[0],
                "embedding": _as_json_vector(vectors[0]),
                "agent_id": "coord-main",
                "role_name": "main",
                "session_id": "sess-eng-coord",
                "transaction_id": "tx-eng-1",
            },
        ),
        (
            "memory_write_node",
            {
                "kind": NodeKind.ERROR.value,
                "key": "err_port_busy",
                "label": "Port 8123 already in use",
                "content": _TEXTS[1],
                "embedding": _as_json_vector(vectors[1]),
                "agent_id": "subagent-1",
                "role_name": "subagent",
                "session_id": "sess-eng-sub1",
                "transaction_id": "tx-eng-2",
            },
        ),
        (
            "memory_write_node",
            {
                "kind": NodeKind.FIX.value,
                "key": "fix_stop_worker",
                "label": "Stop stale worker process",
                "content": _TEXTS[2],
                "embedding": _as_json_vector(vectors[2]),
                "agent_id": "subagent-1",
                "role_name": "subagent",
                "session_id": "sess-eng-sub1",
                "transaction_id": "tx-eng-3",
            },
        ),
        (
            "memory_write_edge",
            {
                "relation": WorkflowRelation.FIXED_BY.value,
                "source_kind": NodeKind.ERROR.value,
                "source_key": "err_port_busy",
                "target_kind": NodeKind.FIX.value,
                "target_key": "fix_stop_worker",
                "agent_id": "subagent-1",
                "role_name": "subagent",
                "session_id": "sess-eng-sub1",
                "transaction_id": "tx-eng-4",
            },
        ),
    ]


async def _verify_recall_and_audit(bridge: MemoryBridge, registry: ToolRegistry) -> None:
    instructions = await inject_engine_memory_context(
        bridge,
        project_id="bridge-proj",
        role_name="subagent",
        instructions="Follow repository rules.",
        task="Port 8123 already in use when starting worker",
    )
    assert instructions is not None
    assert "[MEMORY CONTEXT]" in instructions
    assert _TEXTS[0] in instructions
    assert _TEXTS[2] in instructions
    assert "Follow repository rules." in instructions
    audit_result = await registry.get("memory_audit").run({})
    report = audit_result.get("report")
    assert isinstance(report, str)
    assert "coordinator" in report
    assert "subagent" in report
    assert "coord-main" in report
    assert "subagent-1" in report


async def _run_engine_bridge(db_path: Path, litellm_key: str) -> None:
    probe_settings = _settings(db_path, litellm_key)
    async with LiteLLMClient(probe_settings) as client:
        vectors = await client.embed(_TEXTS)
        assert len(vectors) == 3
        dims = len(vectors[0])
        assert dims > 0
        store_settings = _settings(db_path, litellm_key, embedding_dimensions=dims)
        async with SurrealMemoryStore(store_settings) as store:
            write_service = MemoryWriteService(store)
            retriever = MemoryRetriever(store, client)
            bridge = MemoryBridge(store, write_service, retriever)
            registry = ToolRegistry()
            register_memory_tools(
                registry,
                bridge,
                project_id="bridge-proj",
                default_session_id="sess-eng-1",
            )
            for tool_name, payload in _write_steps(vectors):
                await registry.get(tool_name).run(payload)
            await _verify_recall_and_audit(bridge, registry)


def test_engine_tools_coordinator_and_subagent_tagged_cross_recall(
    tmp_path: Path,
    litellm_key: str,
) -> None:
    require_service("litellm", LITELLM_URL)
    asyncio.run(_run_engine_bridge(tmp_path / "engine_bridge.db", litellm_key))
