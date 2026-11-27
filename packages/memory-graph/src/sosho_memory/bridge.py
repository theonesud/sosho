from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from sosho_memory.audit import RollbackResult
from sosho_memory.errors import MemoryValidationError
from sosho_memory.models import (
    AgentRole,
    AuditLogEntry,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    Provenance,
)
from sosho_memory.retrieval_models import CompressedPath, ContextPack, GraphExpansionResult
from sosho_memory.retriever import MemoryRetriever
from sosho_memory.store import SurrealMemoryStore
from sosho_memory.subgraph_compressor import pack_context_within_budget
from sosho_memory.write_service import MemoryWriteService

COORDINATOR_DEFAULT_BUDGET = 800
SUBAGENT_DEFAULT_BUDGET = 400
MEMORY_HEADING = "[MEMORY CONTEXT]"


def inject_memory_into_instructions(instructions: str | None, pack: ContextPack) -> str | None:
    if not pack.rendered_text.strip():
        return instructions
    memory_block = f"{MEMORY_HEADING}\n{pack.rendered_text}"
    if not instructions:
        return memory_block
    return f"{memory_block}\n\n{instructions}"


def _merge_compressed_paths(
    primary: Sequence[CompressedPath],
    secondary: Sequence[CompressedPath],
) -> tuple[CompressedPath, ...]:
    merged: list[CompressedPath] = []
    seen: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    for path in (*primary, *secondary):
        identity = (path.nodes, path.relations)
        if identity in seen:
            continue
        seen.add(identity)
        merged.append(path)
    return tuple(merged)


def _validate_provenance_match(
    provenance: Provenance,
    *,
    agent_id: str,
    agent_role: AgentRole,
    session_id: str,
    item_label: str,
) -> None:
    if provenance.agent_id != agent_id:
        raise MemoryValidationError(
            f"{item_label} agent_id {provenance.agent_id!r} does not match {agent_id!r}."
        )
    if provenance.agent_role is not agent_role:
        raise MemoryValidationError(
            f"{item_label} agent_role {provenance.agent_role.value!r} "
            f"does not match {agent_role.value!r}."
        )
    if provenance.session_id != session_id:
        raise MemoryValidationError(
            f"{item_label} session_id {provenance.session_id!r} does not match {session_id!r}."
        )


def _validate_outcome_metadata(
    *,
    agent_id: str,
    session_id: str,
    transaction_id: str,
    timestamp: datetime,
) -> None:
    if not agent_id.strip():
        raise MemoryValidationError("agent_id must not be empty.")
    if not session_id.strip():
        raise MemoryValidationError("session_id must not be empty.")
    if not transaction_id.strip():
        raise MemoryValidationError("transaction_id must not be empty.")
    if timestamp.tzinfo is None:
        raise MemoryValidationError("timestamp must include timezone information.")


def _validate_outcome_items(
    nodes: Sequence[MemoryNode],
    edges: Sequence[MemoryEdge],
    *,
    agent_id: str,
    agent_role: AgentRole,
    session_id: str,
) -> None:
    for idx, node in enumerate(nodes):
        _validate_provenance_match(
            node.provenance,
            agent_id=agent_id,
            agent_role=agent_role,
            session_id=session_id,
            item_label=f"Node[{idx}] ({node.kind.value}:{node.key})",
        )
    for idx, edge in enumerate(edges):
        _validate_provenance_match(
            edge.provenance,
            agent_id=agent_id,
            agent_role=agent_role,
            session_id=session_id,
            item_label=f"Edge[{idx}] ({edge.relation.value})",
        )


class MemoryBridge:
    def __init__(
        self,
        store: SurrealMemoryStore,
        write_service: MemoryWriteService,
        retriever: MemoryRetriever,
    ) -> None:
        self._store = store
        self._write_service = write_service
        self._retriever = retriever

    async def resolve_database(self, project_id: str | None) -> str:
        if project_id is not None:
            return await self._store.ensure_project_scope(project_id)
        return await self._store.ensure_user_scope()

    async def build_turn_context(  # noqa: PLR0913
        self,
        *,
        role: AgentRole,
        project_id: str | None,
        task_prompt: str,
        center_kind: NodeKind | None = None,
        center_key: str | None = None,
        query_vector: Sequence[float] | None = None,
        token_budget: int | None = None,
    ) -> ContextPack:
        default_budget = (
            COORDINATOR_DEFAULT_BUDGET if role is AgentRole.COORDINATOR else SUBAGENT_DEFAULT_BUDGET
        )
        budget = token_budget if token_budget is not None else default_budget
        if role is AgentRole.COORDINATOR:
            return await self._retriever.build_context_pack(
                project_id=project_id,
                query_text=task_prompt,
                query_vector=query_vector,
                token_budget=budget,
                top_k=10,
                max_paths=5,
            )
        pack = await self._retriever.build_context_pack(
            project_id=project_id,
            query_text=task_prompt,
            query_vector=query_vector,
            token_budget=budget,
            top_k=5,
            max_paths=3,
        )
        if center_kind is None or center_key is None:
            return pack
        database = await self.resolve_database(project_id)
        expansion = await self._retriever.expand_subgraph(
            database,
            center_kind,
            center_key,
            hops=2,
            max_paths=3,
        )
        combined_paths = _merge_compressed_paths(expansion.paths, pack.paths)
        return pack_context_within_budget(
            preferences=pack.preferences,
            error_fixes=pack.error_fixes,
            paths=combined_paths,
            supporting_nodes=pack.supporting_nodes,
            token_budget=budget,
        )

    async def record_task_outcome(  # noqa: PLR0913
        self,
        *,
        project_id: str | None,
        agent_id: str,
        agent_role: AgentRole,
        session_id: str,
        transaction_id: str,
        timestamp: datetime,
        nodes: Sequence[MemoryNode] = (),
        edges: Sequence[MemoryEdge] = (),
    ) -> tuple[AuditLogEntry, ...]:
        _validate_outcome_metadata(
            agent_id=agent_id,
            session_id=session_id,
            transaction_id=transaction_id,
            timestamp=timestamp,
        )
        _validate_outcome_items(
            nodes,
            edges,
            agent_id=agent_id,
            agent_role=agent_role,
            session_id=session_id,
        )
        database = await self.resolve_database(project_id)
        node_entries = [
            await self._write_service.write_node(
                database,
                node,
                transaction_id=transaction_id,
            )
            for node in nodes
        ]
        edge_entries = [
            await self._write_service.write_edge(
                database,
                edge,
                transaction_id=transaction_id,
            )
            for edge in edges
        ]
        return (*node_entries, *edge_entries)

    async def expand_for_pi(
        self,
        *,
        project_id: str | None,
        center_kind: NodeKind,
        center_key: str,
        hops: int = 2,
        max_paths: int = 5,
    ) -> GraphExpansionResult:
        database = await self.resolve_database(project_id)
        return await self._retriever.expand_subgraph(
            database,
            center_kind,
            center_key,
            hops=hops,
            max_paths=max_paths,
        )

    async def export_audit_for_pi(
        self,
        *,
        project_id: str | None,
        session_id: str | None = None,
        transaction_id: str | None = None,
    ) -> str:
        database = await self.resolve_database(project_id)
        return await self._write_service.export_audit_log(
            database,
            session_id=session_id,
            transaction_id=transaction_id,
        )

    async def rollback_for_pi(
        self,
        *,
        project_id: str | None,
        transaction_id: str | None = None,
        session_id: str | None = None,
    ) -> RollbackResult:
        if transaction_id is not None and session_id is None:
            database = await self.resolve_database(project_id)
            return await self._write_service.rollback_transaction(database, transaction_id)
        if session_id is not None and transaction_id is None:
            database = await self.resolve_database(project_id)
            return await self._write_service.rollback_session(database, session_id)
        raise MemoryValidationError("Provide exactly one of transaction_id or session_id.")
