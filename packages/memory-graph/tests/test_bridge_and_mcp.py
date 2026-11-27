import asyncio
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TypeIs

import pytest
from sosho_memory import (
    AgentRole,
    ContextPack,
    GraphExpansionResult,
    MemoryBridge,
    MemoryEdge,
    MemoryNode,
    MemoryRetriever,
    MemoryValidationError,
    MemoryWriteService,
    NodeKind,
    Provenance,
    RollbackResult,
    SurrealMemoryStore,
    WorkflowRelation,
    inject_memory_into_instructions,
    load_memory_settings,
)
from sosho_memory.bridge import MEMORY_HEADING, SUBAGENT_DEFAULT_BUDGET
from sosho_memory.mcp_server import McpMemoryHandler

_BASE_TIME = datetime(2026, 3, 15, 12, 0, 0, tzinfo=UTC)


def _prov(
    *,
    agent_id: str,
    agent_role: AgentRole,
    session_id: str,
    minute: int = 0,
) -> Provenance:
    ts = _BASE_TIME + timedelta(minutes=minute)
    return Provenance(
        valid_from=ts,
        valid_to=None,
        confidence=0.95,
        agent_id=agent_id,
        agent_role=agent_role,
        session_id=session_id,
        timestamp=ts,
    )


def _node(
    kind: NodeKind,
    key: str,
    content: str,
    *,
    provenance: Provenance,
    embedding: tuple[float, ...] | None = None,
) -> MemoryNode:
    return MemoryNode(
        kind=kind,
        key=key,
        label=key,
        content=content,
        embedding=embedding,
        provenance=provenance,
    )


def _edge(
    relation: WorkflowRelation,
    source: tuple[NodeKind, str],
    target: tuple[NodeKind, str],
    *,
    provenance: Provenance,
) -> MemoryEdge:
    return MemoryEdge(
        relation=relation,
        source_kind=source[0],
        source_key=source[1],
        target_kind=target[0],
        target_key=target[1],
        weight=1.0,
        provenance=provenance,
    )


async def _seed_bridge_outcomes(bridge: MemoryBridge) -> None:
    coord_prov = _prov(
        agent_id="coord-1",
        agent_role=AgentRole.COORDINATOR,
        session_id="sess-coord",
        minute=0,
    )
    pref_style = _node(
        NodeKind.PREFERENCE,
        "pref_style",
        "concise technical answers",
        provenance=coord_prov,
        embedding=(1.0, 0.0, 0.0, 0.0),
    )
    coord_entries = await bridge.record_task_outcome(
        project_id=None,
        agent_id="coord-1",
        agent_role=AgentRole.COORDINATOR,
        session_id="sess-coord",
        transaction_id="tx-coord-1",
        timestamp=_BASE_TIME,
        nodes=(pref_style,),
    )
    assert len(coord_entries) == 1
    sub1_prov = _prov(
        agent_id="sub-1",
        agent_role=AgentRole.SUBAGENT,
        session_id="sess-sub-1",
        minute=1,
    )
    err_lock = _node(
        NodeKind.ERROR,
        "err_lock",
        "sqlite database lock timeout",
        provenance=sub1_prov,
        embedding=(1.0, 0.0, 0.0, 0.0),
    )
    fix_wal = _node(
        NodeKind.FIX,
        "fix_wal",
        "enable WAL mode and busy_timeout",
        provenance=sub1_prov,
        embedding=(0.9, 0.1, 0.0, 0.0),
    )
    fix_edge = _edge(
        WorkflowRelation.FIXED_BY,
        (NodeKind.ERROR, "err_lock"),
        (NodeKind.FIX, "fix_wal"),
        provenance=sub1_prov,
    )
    sub_entries = await bridge.record_task_outcome(
        project_id="proj1",
        agent_id="sub-1",
        agent_role=AgentRole.SUBAGENT,
        session_id="sess-sub-1",
        transaction_id="tx-sub-1",
        timestamp=_BASE_TIME + timedelta(minutes=1),
        nodes=(err_lock, fix_wal),
        edges=(fix_edge,),
    )
    assert len(sub_entries) == 3
    with pytest.raises(MemoryValidationError):
        await bridge.record_task_outcome(
            project_id="proj1",
            agent_id="sub-mismatch",
            agent_role=AgentRole.SUBAGENT,
            session_id="sess-sub-1",
            transaction_id="tx-sub-bad",
            timestamp=_BASE_TIME + timedelta(minutes=2),
            nodes=(err_lock,),
        )


async def _run_bridge_test(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        write_service = MemoryWriteService(store)
        retriever = MemoryRetriever(store)
        bridge = MemoryBridge(store, write_service, retriever)
        await _seed_bridge_outcomes(bridge)
        pack = await bridge.build_turn_context(
            role=AgentRole.SUBAGENT,
            project_id="proj1",
            task_prompt="lock timeout",
            center_kind=NodeKind.ERROR,
            center_key="err_lock",
            query_vector=(1.0, 0.0, 0.0, 0.0),
        )
        instructions = inject_memory_into_instructions("Follow repo rules.", pack)
        assert instructions is not None
        assert instructions.startswith(MEMORY_HEADING)
        assert "concise technical answers" in instructions
        assert "enable WAL mode and busy_timeout" in instructions
        assert "--[FixedBy]-->" in instructions
        assert instructions.endswith("Follow repo rules.")
        assert pack.estimated_tokens <= SUBAGENT_DEFAULT_BUDGET


def test_bridge_role_scoped_context_and_cross_subagent_error_recall(tmp_path: Path) -> None:
    asyncio.run(_run_bridge_test(tmp_path / "bridge.db"))


def _is_mapping(value: object) -> TypeIs[Mapping[object, object]]:
    return isinstance(value, Mapping)


def _is_list(value: object) -> TypeIs[list[object]]:
    return isinstance(value, list)


def _as_dict(value: object) -> dict[str, object]:
    assert _is_mapping(value)
    result: dict[str, object] = {}
    for key, item in value.items():
        assert isinstance(key, str)
        result[key] = item
    return result


def _rpc_result(response: dict[str, object] | None) -> dict[str, object]:
    assert response is not None
    assert "error" not in response
    return _as_dict(response.get("result"))


async def _call_tool(
    handler: McpMemoryHandler,
    req_id: int,
    name: str,
    arguments: dict[str, object],
) -> tuple[bool, str]:
    response = await handler.handle_message(
        {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
    )
    result = _rpc_result(response)
    is_error = result.get("isError")
    assert isinstance(is_error, bool)
    content = result.get("content")
    assert _is_list(content)
    assert len(content) == 1
    first_item = _as_dict(content[0])
    assert first_item.get("type") == "text"
    text = first_item.get("text")
    assert isinstance(text, str)
    return is_error, text


async def _verify_mcp_handshake(handler: McpMemoryHandler) -> None:
    init_res = _rpc_result(
        await handler.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
        )
    )
    assert init_res.get("protocolVersion") == "2024-11-05"
    notif_res = await handler.handle_message(
        {"jsonrpc": "2.0", "method": "notifications/initialized"}
    )
    assert notif_res is None
    list_res = _rpc_result(
        await handler.handle_message({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    )
    raw_tools = list_res.get("tools")
    assert _is_list(raw_tools)
    tool_names = {_as_dict(item).get("name") for item in raw_tools}
    assert tool_names == {
        "memory_context",
        "memory_expand",
        "memory_write_node",
        "memory_write_edge",
        "memory_audit",
        "memory_rollback",
    }


def _mcp_node_args(
    *,
    kind: str,
    key: str,
    content: str,
    transaction_id: str,
    minute: int,
) -> dict[str, object]:
    return {
        "project_id": "mcp-proj",
        "kind": kind,
        "key": key,
        "label": key,
        "content": content,
        "agent_id": "sub-mcp",
        "agent_role": "subagent",
        "session_id": "sess-mcp",
        "transaction_id": transaction_id,
        "timestamp": (_BASE_TIME + timedelta(minutes=minute)).isoformat(),
    }


async def _write_and_query_mcp_graph(handler: McpMemoryHandler) -> None:
    err_is_err, _ = await _call_tool(
        handler,
        3,
        "memory_write_node",
        _mcp_node_args(
            kind="error",
            key="err_timeout",
            content="sqlite database lock timeout",
            transaction_id="tx-mcp-1",
            minute=0,
        ),
    )
    assert err_is_err is False
    fix_is_err, _ = await _call_tool(
        handler,
        4,
        "memory_write_node",
        _mcp_node_args(
            kind="fix",
            key="fix_busy",
            content="set busy_timeout to 5000ms",
            transaction_id="tx-mcp-2",
            minute=1,
        ),
    )
    assert fix_is_err is False
    edge_is_err, _ = await _call_tool(
        handler,
        5,
        "memory_write_edge",
        {
            "project_id": "mcp-proj",
            "relation_name": "FixedBy",
            "source_kind": "error",
            "source_key": "err_timeout",
            "target_kind": "fix",
            "target_key": "fix_busy",
            "agent_id": "sub-mcp",
            "agent_role": "subagent",
            "session_id": "sess-mcp",
            "transaction_id": "tx-mcp-3",
            "timestamp": (_BASE_TIME + timedelta(minutes=2)).isoformat(),
        },
    )
    assert edge_is_err is False


async def _verify_mcp_context_expand_audit(handler: McpMemoryHandler) -> None:
    ctx_is_err, ctx_text = await _call_tool(
        handler,
        6,
        "memory_context",
        {
            "project_id": "mcp-proj",
            "role": "subagent",
            "query_text": "sqlite lock",
            "token_budget": 400,
        },
    )
    assert ctx_is_err is False
    pack = ContextPack.model_validate_json(ctx_text)
    assert any(
        pair.error_node.key == "err_timeout" and pair.fix_node.key == "fix_busy"
        for pair in pack.error_fixes
    )
    exp_is_err, exp_text = await _call_tool(
        handler,
        7,
        "memory_expand",
        {
            "project_id": "mcp-proj",
            "center_kind": "error",
            "center_key": "err_timeout",
            "hops": 2,
            "max_paths": 5,
        },
    )
    assert exp_is_err is False
    expansion = GraphExpansionResult.model_validate_json(exp_text)
    assert {node.key for node in expansion.nodes} == {"err_timeout", "fix_busy"}
    assert any("--[FixedBy]-->" in path.rendered for path in expansion.paths)
    audit_is_err, audit_text = await _call_tool(
        handler,
        8,
        "memory_audit",
        {"project_id": "mcp-proj", "session_id": "sess-mcp"},
    )
    assert audit_is_err is False
    assert "tx-mcp-1" in audit_text
    assert "tx-mcp-2" in audit_text
    assert "tx-mcp-3" in audit_text


async def _verify_mcp_secret_and_rollback(
    handler: McpMemoryHandler,
    store: SurrealMemoryStore,
) -> None:
    secret = "".join(("sk-ant-", "1234567890abcdef123456"))
    sec_is_err, sec_text = await _call_tool(
        handler,
        9,
        "memory_write_node",
        _mcp_node_args(
            kind="entity",
            key="secret_node",
            content=secret,
            transaction_id="tx-mcp-sec",
            minute=3,
        ),
    )
    assert sec_is_err is True
    assert secret not in sec_text
    rb_is_err, rb_text = await _call_tool(
        handler,
        10,
        "memory_rollback",
        {"project_id": "mcp-proj", "session_id": "sess-mcp"},
    )
    assert rb_is_err is False
    rollback = RollbackResult.model_validate_json(rb_text)
    assert rollback.reverted_entries == 3
    assert rollback.reverted_transaction_ids == ("tx-mcp-3", "tx-mcp-2", "tx-mcp-1")
    project_db = await store.ensure_project_scope("mcp-proj")
    assert await store.get_node(project_db, NodeKind.ERROR, "err_timeout") is None
    assert await store.get_node(project_db, NodeKind.FIX, "fix_busy") is None
    audit_is_err, audit_text = await _call_tool(
        handler,
        11,
        "memory_audit",
        {"project_id": "mcp-proj", "session_id": "sess-mcp"},
    )
    assert audit_is_err is False
    assert "tx-mcp-1" in audit_text
    assert "tx-mcp-2" in audit_text
    assert "tx-mcp-3" in audit_text


async def _run_mcp_test(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        write_service = MemoryWriteService(store)
        retriever = MemoryRetriever(store)
        handler = McpMemoryHandler(store, write_service, retriever)
        await _verify_mcp_handshake(handler)
        await _write_and_query_mcp_graph(handler)
        await _verify_mcp_context_expand_audit(handler)
        await _verify_mcp_secret_and_rollback(handler, store)


def test_mcp_handler_end_to_end_protocol_and_rollback(tmp_path: Path) -> None:
    asyncio.run(_run_mcp_test(tmp_path / "mcp.db"))
