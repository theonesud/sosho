from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from surrealdb import RecordID

from sosho_memory.audit import (
    AuditSnapshot,
    RollbackResult,
    decode_audit_snapshot,
    encode_audit_snapshot,
    format_audit_log_report,
)
from sosho_memory.errors import MemoryStorageError, MemoryValidationError
from sosho_memory.models import (
    AuditAction,
    AuditLogEntry,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    Provenance,
    RelationType,
)
from sosho_memory.schema import EDGE_TABLES, NODE_TABLES
from sosho_memory.store import (
    SurrealMemoryStore,
    audit_payload,
    edge_payload,
    extract_query_rows,
    node_payload,
    parse_created_audit_entry,
    parse_edge_record,
)
from sosho_memory.write_gate import (
    validate_edge_write,
    validate_node_write,
    validate_relation_name,
    validate_write_provenance,
)


def _strip_surreal_delimiters(value: str) -> str:
    if (value.startswith("⟨") and value.endswith("⟩")) or (
        value.startswith("`") and value.endswith("`")
    ):
        return value[1:-1]
    return value


def _parse_edge_record_id(expected_table: str, raw_id: str) -> RecordID:
    cleaned = raw_id.strip()
    if not cleaned:
        raise MemoryValidationError("Edge ID must not be empty.")
    if ":" in cleaned:
        table_name, key_part = cleaned.split(":", 1)
        table_name = _strip_surreal_delimiters(table_name)
        if table_name != expected_table:
            raise MemoryValidationError(
                f"Expected edge table {expected_table!r}, got {table_name!r}"
            )
        record_key = _strip_surreal_delimiters(key_part)
    else:
        record_key = _strip_surreal_delimiters(cleaned)
    if not record_key:
        raise MemoryValidationError("Edge record key must not be empty.")
    return RecordID(expected_table, record_key)


def _extract_node_key(expected_table: str, target_id: str) -> str:
    if ":" in target_id:
        table_name, key_part = target_id.split(":", 1)
        if _strip_surreal_delimiters(table_name) != expected_table:
            raise MemoryStorageError(
                f"Audit entry target_id {target_id!r} does not match table {expected_table!r}"
            )
        return _strip_surreal_delimiters(key_part)
    return _strip_surreal_delimiters(target_id)


def _require_non_empty(value: str, field_name: str) -> None:
    if not value.strip():
        raise MemoryValidationError(f"{field_name} must not be empty.")


def _decode_snapshot(entry: AuditLogEntry) -> AuditSnapshot:
    try:
        return decode_audit_snapshot(entry.payload_json)
    except ValueError as error:
        raise MemoryStorageError(
            f"Invalid audit snapshot for {entry.target_id}: {error}"
        ) from error


def _build_node_rollback_statement(
    idx: int,
    entry: AuditLogEntry,
    snapshot: AuditSnapshot,
    params: dict[str, object],
) -> str:
    table_var = f"t_{idx}"
    key_var = f"k_{idx}"
    params[table_var] = entry.target_table
    params[key_var] = _extract_node_key(entry.target_table, entry.target_id)
    if snapshot.before_json is None:
        return f"DELETE type::record(${table_var}, ${key_var});"
    before_node = MemoryNode.model_validate_json(snapshot.before_json)
    data_var = f"d_{idx}"
    params[data_var] = dict(node_payload(before_node))
    return f"UPSERT type::record(${table_var}, ${key_var}) CONTENT ${data_var};"


def _build_edge_rollback_statement(
    idx: int,
    entry: AuditLogEntry,
    snapshot: AuditSnapshot,
    params: dict[str, object],
) -> str:
    rid_var = f"r_{idx}"
    params[rid_var] = _parse_edge_record_id(entry.target_table, entry.target_id)
    if snapshot.before_json is None:
        return f"DELETE ${rid_var};"
    before_edge = MemoryEdge.model_validate_json(snapshot.before_json)
    relation = validate_relation_name(before_edge.relation.value)
    data_var = f"d_{idx}"
    src_var = f"s_{idx}"
    dst_var = f"o_{idx}"
    params[data_var] = edge_payload(before_edge)
    params[src_var] = RecordID(before_edge.source_kind.value, before_edge.source_key)
    params[dst_var] = RecordID(before_edge.target_kind.value, before_edge.target_key)
    return (
        f"IF record::exists(${rid_var}) "
        f"{{ UPDATE ${rid_var} MERGE ${data_var}; }} "
        f"ELSE {{ RELATE ${src_var}->{relation.value}->${dst_var} CONTENT ${data_var}; }};"
    )


def _build_rollback_query(
    entries: tuple[AuditLogEntry, ...],
) -> tuple[str, dict[str, object]]:
    statements: list[str] = ["BEGIN TRANSACTION;"]
    params: dict[str, object] = {}
    for idx, entry in enumerate(entries):
        snapshot = _decode_snapshot(entry)
        if entry.target_table in NODE_TABLES:
            statements.append(_build_node_rollback_statement(idx, entry, snapshot, params))
        elif entry.target_table in EDGE_TABLES:
            statements.append(_build_edge_rollback_statement(idx, entry, snapshot, params))
        else:
            raise MemoryStorageError(f"Unsupported audit target table: {entry.target_table!r}")
    statements.append("COMMIT TRANSACTION;")
    return "\n".join(statements), params


class MemoryWriteService:
    def __init__(self, store: SurrealMemoryStore) -> None:
        self._store = store
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_audit_ts: datetime | None = None

    def _lock_for(self, database: str) -> asyncio.Lock:
        lock = self._locks.get(database)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[database] = lock
        return lock

    def _next_audit_timestamp(self) -> datetime:
        now = datetime.now(UTC)
        if self._last_audit_ts is not None and now <= self._last_audit_ts:
            now = self._last_audit_ts + timedelta(microseconds=1)
        self._last_audit_ts = now
        return now

    async def write_node(
        self,
        database: str,
        node: MemoryNode,
        *,
        transaction_id: str,
    ) -> AuditLogEntry:
        _require_non_empty(transaction_id, "transaction_id")
        validate_node_write(node)
        expected_dims = self._store.settings.embedding_dimensions
        if node.embedding is not None and len(node.embedding) != expected_dims:
            raise MemoryValidationError(
                f"Expected embedding length {expected_dims}, got {len(node.embedding)}"
            )
        async with self._lock_for(database):
            before_node = await self._store.get_node(database, node.kind, node.key)
            action = AuditAction.UPDATE_NODE if before_node is not None else AuditAction.CREATE_NODE
            payload_json = encode_audit_snapshot(
                before_json=before_node.model_dump_json() if before_node is not None else None,
                after_json=node.model_dump_json(),
            )
            entry = AuditLogEntry(
                transaction_id=transaction_id,
                session_id=node.provenance.session_id,
                agent_id=node.provenance.agent_id,
                agent_role=node.provenance.agent_role,
                action=action,
                target_table=node.kind.value,
                target_id=f"{node.kind.value}:{node.key}",
                payload_json=payload_json,
                timestamp=self._next_audit_timestamp(),
            )
            query = (
                "BEGIN TRANSACTION;\n"
                "UPSERT type::record($table, $key) CONTENT $node_data;\n"
                "CREATE audit_log CONTENT $audit_data;\n"
                "COMMIT TRANSACTION;"
            )
            params: dict[str, object] = {
                "table": node.kind.value,
                "key": node.key,
                "node_data": node_payload(node),
                "audit_data": audit_payload(entry),
            }
            result = await self._store.run_query(database, query, params)
            return parse_created_audit_entry(result[2])

    async def delete_node(
        self,
        database: str,
        kind: NodeKind,
        key: str,
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> AuditLogEntry | None:
        _require_non_empty(transaction_id, "transaction_id")
        validate_write_provenance(provenance)
        async with self._lock_for(database):
            before_node = await self._store.get_node(database, kind, key)
            if before_node is None:
                return None
            payload_json = encode_audit_snapshot(
                before_json=before_node.model_dump_json(),
                after_json=None,
            )
            entry = AuditLogEntry(
                transaction_id=transaction_id,
                session_id=provenance.session_id,
                agent_id=provenance.agent_id,
                agent_role=provenance.agent_role,
                action=AuditAction.DELETE_NODE,
                target_table=kind.value,
                target_id=f"{kind.value}:{key}",
                payload_json=payload_json,
                timestamp=self._next_audit_timestamp(),
            )
            query = (
                "BEGIN TRANSACTION;\n"
                "DELETE type::record($table, $key);\n"
                "CREATE audit_log CONTENT $audit_data;\n"
                "COMMIT TRANSACTION;"
            )
            params: dict[str, object] = {
                "table": kind.value,
                "key": key,
                "audit_data": audit_payload(entry),
            }
            result = await self._store.run_query(database, query, params)
            return parse_created_audit_entry(result[2])

    async def write_edge(
        self,
        database: str,
        edge: MemoryEdge,
        *,
        transaction_id: str,
    ) -> AuditLogEntry:
        _require_non_empty(transaction_id, "transaction_id")
        validate_edge_write(edge)
        relation = validate_relation_name(edge.relation.value)
        payload_json = encode_audit_snapshot(
            before_json=None,
            after_json=edge.model_dump_json(),
        )
        async with self._lock_for(database):
            query = (
                "BEGIN TRANSACTION;\n"
                f"LET $created = RELATE $source->{relation.value}->$target CONTENT $edge_data;\n"
                "CREATE audit_log CONTENT {\n"
                "    transaction_id: $transaction_id,\n"
                "    session_id: $session_id,\n"
                "    agent_id: $agent_id,\n"
                "    agent_role: $agent_role,\n"
                "    action: $action,\n"
                "    target_table: $target_table,\n"
                "    target_id: string::concat("
                "record::tb($created[0].id), ':', record::id($created[0].id)"
                "),\n"
                "    payload_json: $payload_json,\n"
                "    timestamp: $timestamp\n"
                "};\n"
                "COMMIT TRANSACTION;"
            )
            params: dict[str, object] = {
                "source": RecordID(edge.source_kind.value, edge.source_key),
                "target": RecordID(edge.target_kind.value, edge.target_key),
                "edge_data": edge_payload(edge),
                "transaction_id": transaction_id,
                "session_id": edge.provenance.session_id,
                "agent_id": edge.provenance.agent_id,
                "agent_role": edge.provenance.agent_role.value,
                "action": AuditAction.CREATE_EDGE.value,
                "target_table": relation.value,
                "payload_json": payload_json,
                "timestamp": self._next_audit_timestamp(),
            }
            result = await self._store.run_query(database, query, params)
            return parse_created_audit_entry(result[2])

    async def write_edge_by_name(  # noqa: PLR0913, PLR0917
        self,
        database: str,
        relation_name: str,
        source_kind: NodeKind,
        source_key: str,
        target_kind: NodeKind,
        target_key: str,
        *,
        weight: float = 1.0,
        provenance: Provenance,
        transaction_id: str,
    ) -> AuditLogEntry:
        relation = validate_relation_name(relation_name)
        edge = MemoryEdge(
            relation=relation,
            source_kind=source_kind,
            source_key=source_key,
            target_kind=target_kind,
            target_key=target_key,
            weight=weight,
            provenance=provenance,
        )
        return await self.write_edge(database, edge, transaction_id=transaction_id)

    async def close_edge(  # noqa: PLR0913
        self,
        database: str,
        relation: RelationType,
        edge_id: str,
        *,
        valid_to: datetime,
        provenance: Provenance,
        transaction_id: str,
    ) -> AuditLogEntry:
        _require_non_empty(transaction_id, "transaction_id")
        validate_write_provenance(provenance)
        if valid_to.tzinfo is None:
            raise MemoryValidationError("valid_to must include timezone information.")
        edge_rid = _parse_edge_record_id(relation.value, edge_id)
        async with self._lock_for(database):
            select_result = await self._store.run_query(
                database,
                "SELECT * FROM $edge_id;",
                {"edge_id": edge_rid},
            )
            rows = (
                extract_query_rows(select_result[0], "close_edge_select") if select_result else ()
            )
            if not rows:
                raise MemoryStorageError(f"Edge record {edge_rid} not found")
            before_edge = parse_edge_record(rows[0])
            if valid_to < before_edge.provenance.valid_from:
                raise MemoryValidationError("valid_to must be greater than or equal to valid_from.")
            after_provenance = before_edge.provenance.model_copy(update={"valid_to": valid_to})
            after_edge = before_edge.model_copy(update={"provenance": after_provenance})
            entry = AuditLogEntry(
                transaction_id=transaction_id,
                session_id=provenance.session_id,
                agent_id=provenance.agent_id,
                agent_role=provenance.agent_role,
                action=AuditAction.CLOSE_EDGE,
                target_table=relation.value,
                target_id=f"{edge_rid.table_name}:{edge_rid.id}",
                payload_json=encode_audit_snapshot(
                    before_json=before_edge.model_dump_json(),
                    after_json=after_edge.model_dump_json(),
                ),
                timestamp=self._next_audit_timestamp(),
            )
            query = (
                "BEGIN TRANSACTION;\n"
                "UPDATE $edge_id SET valid_to = $valid_to;\n"
                "CREATE audit_log CONTENT $audit_data;\n"
                "COMMIT TRANSACTION;"
            )
            params: dict[str, object] = {
                "edge_id": edge_rid,
                "valid_to": valid_to,
                "audit_data": audit_payload(entry),
            }
            result = await self._store.run_query(database, query, params)
            return parse_created_audit_entry(result[2])

    async def _rollback_entries(
        self,
        database: str,
        scope: str,
        target_id: str,
        entries: tuple[AuditLogEntry, ...],
    ) -> RollbackResult:
        if not entries:
            return RollbackResult(
                scope=scope,
                target_id=target_id,
                reverted_entries=0,
                reverted_transaction_ids=(),
            )
        reversed_entries = tuple(reversed(entries))
        query, params = _build_rollback_query(reversed_entries)
        await self._store.run_query(database, query, params)
        reverted_tx_ids = tuple(dict.fromkeys(entry.transaction_id for entry in reversed_entries))
        return RollbackResult(
            scope=scope,
            target_id=target_id,
            reverted_entries=len(reversed_entries),
            reverted_transaction_ids=reverted_tx_ids,
        )

    async def rollback_transaction(self, database: str, transaction_id: str) -> RollbackResult:
        _require_non_empty(transaction_id, "transaction_id")
        async with self._lock_for(database):
            entries = await self._store.list_audit_entries(
                database,
                transaction_id=transaction_id,
            )
            return await self._rollback_entries(database, "transaction", transaction_id, entries)

    async def rollback_session(self, database: str, session_id: str) -> RollbackResult:
        _require_non_empty(session_id, "session_id")
        async with self._lock_for(database):
            entries = await self._store.list_audit_entries(
                database,
                session_id=session_id,
            )
            return await self._rollback_entries(database, "session", session_id, entries)

    async def export_audit_log(
        self,
        database: str,
        *,
        session_id: str | None = None,
        transaction_id: str | None = None,
    ) -> str:
        entries = await self._store.list_audit_entries(
            database,
            transaction_id=transaction_id,
            session_id=session_id,
        )
        return format_audit_log_report(entries)
