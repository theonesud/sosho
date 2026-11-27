import asyncio
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import SecretStr
from sosho_engine.host_node import compose_prompt
from sosho_engine.memory_bridge import inject_engine_memory_context
from sosho_engine.pi_process import PiRun, run_pi
from sosho_memory import (
    AgentRole,
    LiteLLMClient,
    MemoryBridge,
    MemoryEdge,
    MemoryNode,
    MemoryRetriever,
    MemorySettings,
    MemoryWriteService,
    NodeKind,
    Provenance,
    SurrealMemoryStore,
    WorkflowRelation,
    estimate_tokens,
    load_memory_settings,
)

from tests.conftest import LITELLM_URL, ROOT, require_service

pytestmark = pytest.mark.integration

LAUNCHER = ROOT / "bin" / "pi-launcher.sh"
_BASE_TIME = datetime(2026, 4, 1, 12, 0, 0, tzinfo=UTC)
_TOKEN_BUDGET = 300
_BASE_INSTRUCTIONS = "Use the memory context to answer the task."
_TASK_PROMPT = "What fixes err_port and how should you answer?"
_TEXTS = (
    "Always answer in one short sentence",
    "err_port address already in use",
    "fix_port terminate the conflicting listener",
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


def _provenance(agent_id: str, agent_role: AgentRole, minute: int) -> Provenance:
    ts = _BASE_TIME + timedelta(minutes=minute)
    return Provenance(
        valid_from=ts,
        valid_to=None,
        confidence=0.95,
        agent_id=agent_id,
        agent_role=agent_role,
        session_id="pi-sess-1",
        timestamp=ts,
    )


async def _seed_session_one(
    bridge: MemoryBridge,
    vectors: tuple[tuple[float, ...], ...],
) -> None:
    pref_prov = _provenance("pi-coord", AgentRole.COORDINATOR, 0)
    pref_node = MemoryNode(
        kind=NodeKind.PREFERENCE,
        key="pref_one_sentence",
        label="One short sentence",
        content=_TEXTS[0],
        embedding=vectors[0],
        provenance=pref_prov,
    )
    await bridge.record_task_outcome(
        project_id=None,
        agent_id="pi-coord",
        agent_role=AgentRole.COORDINATOR,
        session_id="pi-sess-1",
        transaction_id="tx-pi-pref",
        timestamp=_BASE_TIME,
        nodes=(pref_node,),
    )
    fix_prov = _provenance("pi-sub", AgentRole.SUBAGENT, 1)
    err_node = MemoryNode(
        kind=NodeKind.ERROR,
        key="err_port",
        label="err_port conflict",
        content=_TEXTS[1],
        embedding=vectors[1],
        provenance=fix_prov,
    )
    fix_node = MemoryNode(
        kind=NodeKind.FIX,
        key="fix_port",
        label="fix_port release",
        content=_TEXTS[2],
        embedding=vectors[2],
        provenance=fix_prov,
    )
    fix_edge = MemoryEdge(
        relation=WorkflowRelation.FIXED_BY,
        source_kind=NodeKind.ERROR,
        source_key="err_port",
        target_kind=NodeKind.FIX,
        target_key="fix_port",
        provenance=fix_prov,
    )
    await bridge.record_task_outcome(
        project_id="pi-proj",
        agent_id="pi-sub",
        agent_role=AgentRole.SUBAGENT,
        session_id="pi-sess-1",
        transaction_id="tx-pi-fix",
        timestamp=_BASE_TIME + timedelta(minutes=1),
        nodes=(err_node, fix_node),
        edges=(fix_edge,),
    )


async def _never_cancelled() -> bool:
    return False


async def _invoke_pi(workspace: Path, litellm_key: str, instructions: str) -> str:
    prompt = compose_prompt(instructions, _TASK_PROMPT)
    argv = [
        str(LAUNCHER),
        "--raw",
        "-p",
        "--no-session",
        "--mode",
        "json",
        "--provider",
        "litellm",
        "--model",
        "local-uncensored",
        "--no-tools",
        "--no-skills",
        "--no-context-files",
        prompt,
    ]
    env = {
        **os.environ,
        "PI_SKIP_WARMUP": "1",
        "SOSHO_ROOT": str(ROOT),
        "SOSHO_PI_STATE": "root",
    }
    env.setdefault("LITELLM_MASTER_KEY", litellm_key)
    request = PiRun(
        argv=argv,
        env=env,
        cwd=workspace,
        timeout_seconds=240.0,
        max_turns=4,
        stdout_cap_bytes=1_000_000,
        line_cap_bytes=1_000_000,
        poll_seconds=0.2,
        cancelled=_never_cancelled,
    )
    trace = await run_pi(request)
    assert trace.ended
    assert trace.stop_reason != "error"
    return trace.text or ""


async def _verify_rollback_and_audit(bridge: MemoryBridge, store: SurrealMemoryStore) -> None:
    rollback = await bridge.rollback_for_pi(project_id="pi-proj", session_id="pi-sess-1")
    assert rollback.reverted_entries == 3
    assert rollback.reverted_transaction_ids == ("tx-pi-fix",)
    project_db = await store.ensure_project_scope("pi-proj")
    assert await store.get_node(project_db, NodeKind.ERROR, "err_port") is None
    assert await store.get_node(project_db, NodeKind.FIX, "fix_port") is None
    audit_entries = await store.list_audit_entries(project_db, session_id="pi-sess-1")
    assert len(audit_entries) == 3
    report = await bridge.export_audit_for_pi(project_id="pi-proj", session_id="pi-sess-1")
    assert "tx-pi-fix" in report


async def _run_pi_bridge(db_path: Path, workspace: Path, litellm_key: str) -> None:
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
            await _seed_session_one(bridge, vectors)
            instructions = await inject_engine_memory_context(
                bridge,
                project_id="pi-proj",
                role_name="main",
                instructions=_BASE_INSTRUCTIONS,
                task=_TASK_PROMPT,
                token_budget=_TOKEN_BUDGET,
            )
            assert instructions is not None
            assert instructions.startswith("[MEMORY CONTEXT]\n")
            assert _TEXTS[0] in instructions
            assert _TEXTS[2] in instructions
            packed = instructions.removeprefix("[MEMORY CONTEXT]\n").removesuffix(
                f"\n\n{_BASE_INSTRUCTIONS}"
            )
            assert estimate_tokens(packed) <= _TOKEN_BUDGET
            reply = await _invoke_pi(workspace, litellm_key, instructions)
            assert reply.strip()
            await _verify_rollback_and_audit(bridge, store)


def test_real_pi_two_session_recall_and_audit_rollback(
    tmp_path: Path,
    litellm_key: str,
) -> None:
    require_service("litellm", LITELLM_URL)
    assert LAUNCHER.is_file()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    asyncio.run(_run_pi_bridge(tmp_path / "pi_bridge.db", workspace, litellm_key))
