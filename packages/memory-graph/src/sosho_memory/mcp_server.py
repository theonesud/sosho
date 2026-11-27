from __future__ import annotations

import asyncio
import json
import logging
import sys
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import TypeIs

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from sosho_memory.config import MemorySettings, load_memory_settings
from sosho_memory.errors import MemoryError as SoshoMemoryError
from sosho_memory.errors import MemoryValidationError
from sosho_memory.litellm_client import LiteLLMClient
from sosho_memory.models import AgentRole, MemoryNode, NodeKind, Provenance
from sosho_memory.retriever import MemoryRetriever
from sosho_memory.store import SurrealMemoryStore
from sosho_memory.write_gate import detect_secret_rule
from sosho_memory.write_service import MemoryWriteService

_LOGGER = logging.getLogger(__name__)
_PROTOCOL_VERSION = "2024-11-05"
_SERVER_NAME = "sosho-memory"
_SERVER_VERSION = "0.1.0"


class MemoryContextArgs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    project_id: str | None = None
    role: AgentRole = AgentRole.COORDINATOR
    query_text: str
    token_budget: int = Field(default=600, ge=1)


class MemoryExpandArgs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    project_id: str | None = None
    center_kind: NodeKind
    center_key: str = Field(min_length=1)
    hops: int = Field(default=2, ge=1, le=4)
    max_paths: int = Field(default=5, ge=0)


class MemoryWriteNodeArgs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    project_id: str | None = None
    kind: NodeKind
    key: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_:-]*$")
    label: str = Field(min_length=1)
    content: str
    agent_id: str = Field(min_length=1)
    agent_role: AgentRole
    session_id: str = Field(min_length=1)
    transaction_id: str = Field(min_length=1)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    timestamp: datetime


class MemoryWriteEdgeArgs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    project_id: str | None = None
    relation_name: str = Field(min_length=1)
    source_kind: NodeKind
    source_key: str = Field(min_length=1)
    target_kind: NodeKind
    target_key: str = Field(min_length=1)
    weight: float = Field(default=1.0, gt=0.0)
    agent_id: str = Field(min_length=1)
    agent_role: AgentRole
    session_id: str = Field(min_length=1)
    transaction_id: str = Field(min_length=1)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    timestamp: datetime


class MemoryAuditArgs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    project_id: str | None = None
    session_id: str | None = None
    transaction_id: str | None = None


class MemoryRollbackArgs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

    project_id: str | None = None
    transaction_id: str | None = None
    session_id: str | None = None


_TOOL_SPECS: tuple[tuple[str, str, type[BaseModel]], ...] = (
    (
        "memory_context",
        "Retrieve ranked user and project memory context within a token budget.",
        MemoryContextArgs,
    ),
    (
        "memory_expand",
        "Expand a memory subgraph around a node and return compressed paths.",
        MemoryExpandArgs,
    ),
    (
        "memory_write_node",
        "Write or update an audited memory node after secret and provenance validation.",
        MemoryWriteNodeArgs,
    ),
    (
        "memory_write_edge",
        "Write an audited memory edge with an approved relation name.",
        MemoryWriteEdgeArgs,
    ),
    (
        "memory_audit",
        "Export the memory audit log filtered by session or transaction.",
        MemoryAuditArgs,
    ),
    (
        "memory_rollback",
        "Rollback memory mutations for a transaction or session using audit snapshots.",
        MemoryRollbackArgs,
    ),
)


def _is_mapping(value: object) -> TypeIs[Mapping[object, object]]:
    return isinstance(value, Mapping)


def _to_str_dict(raw: Mapping[object, object]) -> dict[str, object] | None:
    result: dict[str, object] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            return None
        result[key] = value
    return result


def _validate_request_id(raw_id: object) -> int | str | None:
    if isinstance(raw_id, bool):
        return None
    if isinstance(raw_id, (int, str)):
        return raw_id
    return None


def _jsonrpc_result(req_id: int | str | None, result: object) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(req_id: int | str | None, code: int, message: str) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _initialize_result() -> dict[str, object]:
    return {
        "protocolVersion": _PROTOCOL_VERSION,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": _SERVER_NAME, "version": _SERVER_VERSION},
    }


def _tool_result(text: str, *, is_error: bool) -> dict[str, object]:
    return {
        "content": [{"type": "text", "text": text}],
        "isError": is_error,
    }


def _safe_error_text(error: Exception) -> str:
    text = str(error)
    rule = detect_secret_rule(text)
    if rule is not None:
        return f"Error redacted because secret pattern '{rule}' was detected."
    return text


class McpMemoryHandler:
    def __init__(
        self,
        store: SurrealMemoryStore,
        write_service: MemoryWriteService,
        retriever: MemoryRetriever,
    ) -> None:
        self._store = store
        self._write_service = write_service
        self._retriever = retriever
        self._dispatch: dict[str, Callable[[dict[str, object]], Awaitable[str]]] = {
            "memory_context": self._call_memory_context,
            "memory_expand": self._call_memory_expand,
            "memory_write_node": self._call_memory_write_node,
            "memory_write_edge": self._call_memory_write_edge,
            "memory_audit": self._call_memory_audit,
            "memory_rollback": self._call_memory_rollback,
        }

    def tool_definitions(self) -> list[dict[str, object]]:
        return [
            {
                "name": name,
                "description": description,
                "inputSchema": model_cls.model_json_schema(),
            }
            for name, description, model_cls in _TOOL_SPECS
        ]

    async def _resolve_database(self, project_id: str | None) -> str:
        if project_id is None:
            return await self._store.ensure_user_scope()
        return await self._store.ensure_project_scope(project_id)

    async def _call_memory_context(self, raw_args: dict[str, object]) -> str:
        args = MemoryContextArgs.model_validate(raw_args)
        _LOGGER.debug(
            "Calling memory_context role=%s project_id=%s",
            args.role.value,
            args.project_id,
        )
        pack = await self._retriever.build_context_pack(
            project_id=args.project_id,
            query_text=args.query_text,
            token_budget=args.token_budget,
        )
        return pack.model_dump_json()

    async def _call_memory_expand(self, raw_args: dict[str, object]) -> str:
        args = MemoryExpandArgs.model_validate(raw_args)
        database = await self._resolve_database(args.project_id)
        result = await self._retriever.expand_subgraph(
            database,
            args.center_kind,
            args.center_key,
            hops=args.hops,
            max_paths=args.max_paths,
        )
        return result.model_dump_json()

    async def _call_memory_write_node(self, raw_args: dict[str, object]) -> str:
        args = MemoryWriteNodeArgs.model_validate(raw_args)
        provenance = Provenance(
            valid_from=args.timestamp,
            valid_to=None,
            confidence=args.confidence,
            agent_id=args.agent_id,
            agent_role=args.agent_role,
            session_id=args.session_id,
            timestamp=args.timestamp,
        )
        node = MemoryNode(
            kind=args.kind,
            key=args.key,
            label=args.label,
            content=args.content,
            provenance=provenance,
        )
        database = await self._resolve_database(args.project_id)
        entry = await self._write_service.write_node(
            database,
            node,
            transaction_id=args.transaction_id,
        )
        return entry.model_dump_json()

    async def _call_memory_write_edge(self, raw_args: dict[str, object]) -> str:
        args = MemoryWriteEdgeArgs.model_validate(raw_args)
        provenance = Provenance(
            valid_from=args.timestamp,
            valid_to=None,
            confidence=args.confidence,
            agent_id=args.agent_id,
            agent_role=args.agent_role,
            session_id=args.session_id,
            timestamp=args.timestamp,
        )
        database = await self._resolve_database(args.project_id)
        entry = await self._write_service.write_edge_by_name(
            database,
            args.relation_name,
            args.source_kind,
            args.source_key,
            args.target_kind,
            args.target_key,
            weight=args.weight,
            provenance=provenance,
            transaction_id=args.transaction_id,
        )
        return entry.model_dump_json()

    async def _call_memory_audit(self, raw_args: dict[str, object]) -> str:
        args = MemoryAuditArgs.model_validate(raw_args)
        database = await self._resolve_database(args.project_id)
        return await self._write_service.export_audit_log(
            database,
            session_id=args.session_id,
            transaction_id=args.transaction_id,
        )

    async def _call_memory_rollback(self, raw_args: dict[str, object]) -> str:
        args = MemoryRollbackArgs.model_validate(raw_args)
        if args.transaction_id is not None and args.session_id is not None:
            raise MemoryValidationError("Provide only one of transaction_id or session_id.")
        database = await self._resolve_database(args.project_id)
        if args.transaction_id is not None:
            result = await self._write_service.rollback_transaction(database, args.transaction_id)
            return result.model_dump_json()
        if args.session_id is not None:
            result = await self._write_service.rollback_session(database, args.session_id)
            return result.model_dump_json()
        raise MemoryValidationError("Provide transaction_id or session_id for rollback.")

    async def _execute_tool(
        self,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        handler = self._dispatch.get(tool_name)
        if handler is None:
            return _tool_result(
                _safe_error_text(MemoryValidationError(f"Unknown tool: {tool_name}")),
                is_error=True,
            )
        try:
            text = await handler(arguments)
        except (SoshoMemoryError, ValidationError) as error:
            return _tool_result(_safe_error_text(error), is_error=True)
        return _tool_result(text, is_error=False)

    async def _handle_tools_call(
        self,
        req_id: int | str | None,
        raw_params: object,
    ) -> dict[str, object]:
        if not _is_mapping(raw_params):
            return _jsonrpc_error(req_id, -32602, "Invalid params: expected object")
        params = _to_str_dict(raw_params)
        if params is None:
            return _jsonrpc_error(req_id, -32602, "Invalid params: keys must be strings")
        tool_name = params.get("name")
        if not isinstance(tool_name, str) or not tool_name:
            return _jsonrpc_error(
                req_id, -32602, "Invalid params: tool name must be a non-empty string"
            )
        raw_args = params.get("arguments")
        if raw_args is None:
            arguments: dict[str, object] = {}
        elif _is_mapping(raw_args):
            parsed_args = _to_str_dict(raw_args)
            if parsed_args is None:
                return _jsonrpc_error(
                    req_id, -32602, "Invalid params: argument keys must be strings"
                )
            arguments = parsed_args
        else:
            return _jsonrpc_error(req_id, -32602, "Invalid params: arguments must be an object")
        return _jsonrpc_result(req_id, await self._execute_tool(tool_name, arguments))

    async def _dispatch_request(
        self,
        req_id: int | str | None,
        method: str,
        params: object,
    ) -> dict[str, object]:
        if method == "initialize":
            return _jsonrpc_result(req_id, _initialize_result())
        if method == "ping":
            return _jsonrpc_result(req_id, {})
        if method == "tools/list":
            return _jsonrpc_result(req_id, {"tools": self.tool_definitions()})
        if method == "tools/call":
            return await self._handle_tools_call(req_id, params)
        return _jsonrpc_error(req_id, -32601, f"Method not found: {method}")

    async def handle_message(self, message: dict[str, object]) -> dict[str, object] | None:
        has_id = "id" in message
        raw_id = message.get("id")
        if "jsonrpc" in message and message.get("jsonrpc") != "2.0":
            return _jsonrpc_error(None, -32600, "Invalid Request") if has_id else None
        method = message.get("method")
        if not isinstance(method, str):
            return _jsonrpc_error(None, -32600, "Invalid Request") if has_id else None
        if method == "notifications/initialized" or (
            not has_id and method.startswith("notifications/")
        ):
            return None
        req_id = _validate_request_id(raw_id)
        if has_id and req_id is None and raw_id is not None:
            return _jsonrpc_error(None, -32600, "Invalid Request")
        if not has_id:
            await self._dispatch_request(None, method, message.get("params"))
            return None
        return await self._dispatch_request(req_id, method, message.get("params"))


def _write_json_line(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _parse_json_object(line: str) -> tuple[dict[str, object] | None, dict[str, object] | None]:
    try:
        raw: object = json.loads(line)
    except json.JSONDecodeError:
        return None, _jsonrpc_error(None, -32700, "Parse error")
    if not _is_mapping(raw):
        return None, _jsonrpc_error(None, -32600, "Invalid Request")
    message = _to_str_dict(raw)
    if message is None:
        return None, _jsonrpc_error(None, -32600, "Invalid Request")
    return message, None


async def run_stdio_server(settings: MemorySettings | None = None) -> None:
    effective_settings = settings if settings is not None else load_memory_settings()
    async with (
        SurrealMemoryStore(effective_settings) as store,
        LiteLLMClient(effective_settings) as model_client,
    ):
        write_service = MemoryWriteService(store)
        retriever = MemoryRetriever(store, model_client=model_client)
        handler = McpMemoryHandler(store, write_service, retriever)
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if line == "":
                break
            stripped = line.strip()
            if not stripped:
                continue
            message, parse_error = _parse_json_object(stripped)
            response = parse_error if message is None else await handler.handle_message(message)
            if response is not None:
                await asyncio.to_thread(_write_json_line, response)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )
    asyncio.run(run_stdio_server())


if __name__ == "__main__":
    main()
