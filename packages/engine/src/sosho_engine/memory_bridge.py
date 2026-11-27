from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from sosho_memory import (
    AgentRole,
    AuditLogEntry,
    ConceptNetRelation,
    MemoryBridge,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    Provenance,
    WorkflowRelation,
    inject_memory_into_instructions,
)

from sosho_engine.tools import JsonDict, ToolRegistry


def engine_agent_role(role_name: str) -> AgentRole:
    if role_name == "main":
        return AgentRole.COORDINATOR
    return AgentRole.SUBAGENT


async def inject_engine_memory_context(  # noqa: PLR0913
    bridge: MemoryBridge,
    *,
    project_id: str | None,
    role_name: str,
    instructions: str | None,
    task: str,
    center_kind: NodeKind | None = None,
    center_key: str | None = None,
    query_vector: Sequence[float] | None = None,
    token_budget: int | None = None,
) -> str | None:
    role = engine_agent_role(role_name)
    pack = await bridge.build_turn_context(
        role=role,
        project_id=project_id,
        task_prompt=task,
        center_kind=center_kind,
        center_key=center_key,
        query_vector=query_vector,
        token_budget=token_budget,
    )
    return inject_memory_into_instructions(instructions, pack)


class MemoryContextToolParams(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    task: str
    role_name: str = "subagent"
    project_id: str | None = None
    center_kind: NodeKind | None = None
    center_key: str | None = None
    query_vector: list[float] | None = None
    token_budget: int | None = Field(default=None, ge=1)


class MemoryExpandToolParams(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    center_kind: NodeKind
    center_key: str = Field(min_length=1)
    hops: int = Field(default=2, ge=1, le=4)
    max_paths: int = Field(default=5, ge=0)
    project_id: str | None = None


class MemoryWriteNodeToolParams(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: NodeKind
    key: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_:-]*$")
    label: str = Field(min_length=1)
    content: str
    embedding: list[float] | None = None
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    agent_id: str = Field(default="engine", min_length=1)
    role_name: str = "subagent"
    session_id: str | None = None
    transaction_id: str | None = None
    project_id: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None


class MemoryWriteEdgeToolParams(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    relation: ConceptNetRelation | WorkflowRelation
    source_kind: NodeKind
    source_key: str = Field(min_length=1)
    target_kind: NodeKind
    target_key: str = Field(min_length=1)
    weight: float = Field(default=1.0, gt=0.0)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    agent_id: str = Field(default="engine", min_length=1)
    role_name: str = "subagent"
    session_id: str | None = None
    transaction_id: str | None = None
    project_id: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None


class MemoryAuditToolParams(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    session_id: str | None = None
    transaction_id: str | None = None
    project_id: str | None = None


def _build_provenance(
    params: MemoryWriteNodeToolParams | MemoryWriteEdgeToolParams,
    session_id: str,
    now: datetime,
) -> Provenance:
    return Provenance(
        valid_from=params.valid_from if params.valid_from is not None else now,
        valid_to=params.valid_to,
        confidence=params.confidence,
        agent_id=params.agent_id,
        agent_role=engine_agent_role(params.role_name),
        session_id=session_id,
        timestamp=now,
    )


def _serialize_audit_entries(entries: Sequence[AuditLogEntry]) -> list[JsonValue]:
    serialized: list[JsonValue] = []
    for entry in entries:
        payload: JsonDict = entry.model_dump(mode="json")
        serialized.append(payload)
    return serialized


async def _run_context_tool(
    bridge: MemoryBridge,
    default_project_id: str | None,
    params: MemoryContextToolParams,
) -> JsonDict:
    target_project = params.project_id if params.project_id is not None else default_project_id
    pack = await bridge.build_turn_context(
        role=engine_agent_role(params.role_name),
        project_id=target_project,
        task_prompt=params.task,
        center_kind=params.center_kind,
        center_key=params.center_key,
        query_vector=params.query_vector,
        token_budget=params.token_budget,
    )
    return pack.model_dump(mode="json")


async def _run_expand_tool(
    bridge: MemoryBridge,
    default_project_id: str | None,
    params: MemoryExpandToolParams,
) -> JsonDict:
    target_project = params.project_id if params.project_id is not None else default_project_id
    expansion = await bridge.expand_for_pi(
        project_id=target_project,
        center_kind=params.center_kind,
        center_key=params.center_key,
        hops=params.hops,
        max_paths=params.max_paths,
    )
    return expansion.model_dump(mode="json")


async def _run_write_node_tool(
    bridge: MemoryBridge,
    default_project_id: str | None,
    default_session_id: str,
    params: MemoryWriteNodeToolParams,
) -> JsonDict:
    now = datetime.now(UTC)
    target_project = params.project_id if params.project_id is not None else default_project_id
    session_id = params.session_id if params.session_id is not None else default_session_id
    transaction_id = (
        params.transaction_id if params.transaction_id is not None else f"tx-{uuid4().hex}"
    )
    provenance = _build_provenance(params, session_id, now)
    node = MemoryNode(
        kind=params.kind,
        key=params.key,
        label=params.label,
        content=params.content,
        embedding=tuple(params.embedding) if params.embedding is not None else None,
        provenance=provenance,
    )
    entries = await bridge.record_task_outcome(
        project_id=target_project,
        agent_id=params.agent_id,
        agent_role=provenance.agent_role,
        session_id=session_id,
        transaction_id=transaction_id,
        timestamp=now,
        nodes=(node,),
    )
    return {
        "transaction_id": transaction_id,
        "node_kind": node.kind.value,
        "node_key": node.key,
        "audit_entries": _serialize_audit_entries(entries),
    }


async def _run_write_edge_tool(
    bridge: MemoryBridge,
    default_project_id: str | None,
    default_session_id: str,
    params: MemoryWriteEdgeToolParams,
) -> JsonDict:
    now = datetime.now(UTC)
    target_project = params.project_id if params.project_id is not None else default_project_id
    session_id = params.session_id if params.session_id is not None else default_session_id
    transaction_id = (
        params.transaction_id if params.transaction_id is not None else f"tx-{uuid4().hex}"
    )
    provenance = _build_provenance(params, session_id, now)
    edge = MemoryEdge(
        relation=params.relation,
        source_kind=params.source_kind,
        source_key=params.source_key,
        target_kind=params.target_kind,
        target_key=params.target_key,
        weight=params.weight,
        provenance=provenance,
    )
    entries = await bridge.record_task_outcome(
        project_id=target_project,
        agent_id=params.agent_id,
        agent_role=provenance.agent_role,
        session_id=session_id,
        transaction_id=transaction_id,
        timestamp=now,
        edges=(edge,),
    )
    return {
        "transaction_id": transaction_id,
        "relation": edge.relation.value,
        "source": f"{edge.source_kind.value}:{edge.source_key}",
        "target": f"{edge.target_kind.value}:{edge.target_key}",
        "audit_entries": _serialize_audit_entries(entries),
    }


async def _run_audit_tool(
    bridge: MemoryBridge,
    default_project_id: str | None,
    params: MemoryAuditToolParams,
) -> JsonDict:
    target_project = params.project_id if params.project_id is not None else default_project_id
    report = await bridge.export_audit_for_pi(
        project_id=target_project,
        session_id=params.session_id,
        transaction_id=params.transaction_id,
    )
    return {"report": report}


def register_memory_tools(
    registry: ToolRegistry,
    bridge: MemoryBridge,
    *,
    project_id: str | None,
    default_session_id: str,
) -> None:
    async def handle_context(params: MemoryContextToolParams) -> JsonDict:
        return await _run_context_tool(bridge, project_id, params)

    async def handle_expand(params: MemoryExpandToolParams) -> JsonDict:
        return await _run_expand_tool(bridge, project_id, params)

    async def handle_write_node(params: MemoryWriteNodeToolParams) -> JsonDict:
        return await _run_write_node_tool(bridge, project_id, default_session_id, params)

    async def handle_write_edge(params: MemoryWriteEdgeToolParams) -> JsonDict:
        return await _run_write_edge_tool(bridge, project_id, default_session_id, params)

    async def handle_audit(params: MemoryAuditToolParams) -> JsonDict:
        return await _run_audit_tool(bridge, project_id, params)

    registry.register(
        "memory_context",
        "Build a budgeted memory context pack for a task.",
        MemoryContextToolParams,
        handle_context,
    )
    registry.register(
        "memory_expand",
        "Expand the memory graph around a center node.",
        MemoryExpandToolParams,
        handle_expand,
    )
    registry.register(
        "memory_write_node",
        "Write a memory node with provenance and audit logging.",
        MemoryWriteNodeToolParams,
        handle_write_node,
        side_effect=True,
    )
    registry.register(
        "memory_write_edge",
        "Write a memory edge with provenance and audit logging.",
        MemoryWriteEdgeToolParams,
        handle_write_edge,
        side_effect=True,
    )
    registry.register(
        "memory_audit",
        "Export the memory audit log report.",
        MemoryAuditToolParams,
        handle_audit,
    )
