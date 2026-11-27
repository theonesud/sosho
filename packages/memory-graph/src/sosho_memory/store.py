from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from types import TracebackType
from typing import Self, TypeIs

from surrealdb import AsyncSurreal, AsyncSurrealConnection, RecordID
from surrealdb.errors import SurrealError
from surrealdb.types import Value

from sosho_memory.config import MemorySettings
from sosho_memory.errors import MemoryStorageError, MemoryValidationError
from sosho_memory.models import (
    AgentRole,
    AuditAction,
    AuditLogEntry,
    ConceptNetRelation,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    OntologyMetadata,
    Provenance,
    RelationType,
    WorkflowRelation,
)
from sosho_memory.schema import (
    AUDIT_LOG_TABLE,
    EDGE_TABLES,
    ONTOLOGY_METADATA_TABLE,
    build_schema_statements,
)

_LOGGER = logging.getLogger(__name__)


def _is_mapping(value: object) -> TypeIs[Mapping[object, object]]:
    return isinstance(value, Mapping)


def _is_list(value: object) -> TypeIs[list[object]]:
    return isinstance(value, list)


def _is_sequence(value: object) -> TypeIs[list[object] | tuple[object, ...]]:
    return isinstance(value, (list, tuple))


def _require_mapping(raw: object, context: str) -> dict[str, object]:
    if not _is_mapping(raw):
        raise MemoryStorageError(f"Expected mapping for {context}, got {type(raw).__name__}")
    result: dict[str, object] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            raise MemoryStorageError(f"Expected string key in {context}")
        result[key] = value
    return result


def _require_str(row: Mapping[str, object], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str):
        raise MemoryStorageError(f"Expected string for field {field!r}")
    return value


def _require_float(row: Mapping[str, object], field: str) -> float:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MemoryStorageError(f"Expected float for field {field!r}")
    return float(value)


def _require_int(row: Mapping[str, object], field: str) -> int:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, int):
        raise MemoryStorageError(f"Expected int for field {field!r}")
    return value


def _require_datetime(row: Mapping[str, object], field: str) -> datetime:
    value = row.get(field)
    if not isinstance(value, datetime):
        raise MemoryStorageError(f"Expected datetime for field {field!r}")
    return value


def _optional_datetime(row: Mapping[str, object], field: str) -> datetime | None:
    value = row.get(field)
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise MemoryStorageError(f"Expected optional datetime for field {field!r}")
    return value


def _optional_float_tuple(row: Mapping[str, object], field: str) -> tuple[float, ...] | None:
    value = row.get(field)
    if value is None:
        return None
    if not _is_sequence(value):
        raise MemoryStorageError(f"Expected sequence for field {field!r}")
    items: list[float] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise MemoryStorageError(f"Expected numeric item in field {field!r}")
        items.append(float(item))
    return tuple(items)


def _require_record_id(row: Mapping[str, object], field: str) -> RecordID:
    value = row.get(field)
    if not isinstance(value, RecordID):
        raise MemoryStorageError(f"Expected RecordID for field {field!r}")
    return value


def _record_key(record_id: RecordID) -> str:
    if not isinstance(record_id.id, str):
        raise MemoryStorageError(f"Expected string record key, got {type(record_id.id).__name__}")
    return record_id.id


def _parse_node_kind(value: str) -> NodeKind:
    try:
        return NodeKind(value)
    except ValueError as error:
        raise MemoryStorageError(f"Unknown node kind: {value!r}") from error


def _parse_relation(value: str) -> RelationType:
    try:
        return ConceptNetRelation(value)
    except ValueError:
        try:
            return WorkflowRelation(value)
        except ValueError as error:
            raise MemoryStorageError(f"Unknown relation type: {value!r}") from error


def _parse_agent_role(value: str) -> AgentRole:
    try:
        return AgentRole(value)
    except ValueError as error:
        raise MemoryStorageError(f"Unknown agent role: {value!r}") from error


def _parse_audit_action(value: str) -> AuditAction:
    try:
        return AuditAction(value)
    except ValueError as error:
        raise MemoryStorageError(f"Unknown audit action: {value!r}") from error


def _parse_provenance(row: Mapping[str, object]) -> Provenance:
    try:
        return Provenance(
            valid_from=_require_datetime(row, "valid_from"),
            valid_to=_optional_datetime(row, "valid_to"),
            confidence=_require_float(row, "confidence"),
            agent_id=_require_str(row, "agent_id"),
            agent_role=_parse_agent_role(_require_str(row, "agent_role")),
            session_id=_require_str(row, "session_id"),
            timestamp=_require_datetime(row, "timestamp"),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid provenance fields: {error}") from error


def _parse_node(raw: object, expected_kind: NodeKind | None = None) -> MemoryNode:
    row = _require_mapping(raw, "node")
    record_id = _require_record_id(row, "id")
    kind = expected_kind if expected_kind is not None else _parse_node_kind(record_id.table_name)
    try:
        return MemoryNode(
            kind=kind,
            key=_require_str(row, "key"),
            label=_require_str(row, "label"),
            content=_require_str(row, "content"),
            embedding=_optional_float_tuple(row, "embedding"),
            provenance=_parse_provenance(row),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid node fields: {error}") from error


def parse_edge_record(raw: object) -> MemoryEdge:
    row = _require_mapping(raw, "edge")
    record_id = _require_record_id(row, "id")
    source = _require_record_id(row, "in")
    target = _require_record_id(row, "out")
    try:
        return MemoryEdge(
            relation=_parse_relation(record_id.table_name),
            source_kind=_parse_node_kind(source.table_name),
            source_key=_record_key(source),
            target_kind=_parse_node_kind(target.table_name),
            target_key=_record_key(target),
            weight=_require_float(row, "weight"),
            provenance=_parse_provenance(row),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid edge fields: {error}") from error


def _parse_audit_entry(raw: object) -> AuditLogEntry:
    row = _require_mapping(raw, "audit_log")
    try:
        return AuditLogEntry(
            transaction_id=_require_str(row, "transaction_id"),
            session_id=_require_str(row, "session_id"),
            agent_id=_require_str(row, "agent_id"),
            agent_role=_parse_agent_role(_require_str(row, "agent_role")),
            action=_parse_audit_action(_require_str(row, "action")),
            target_table=_require_str(row, "target_table"),
            target_id=_require_str(row, "target_id"),
            payload_json=_require_str(row, "payload_json"),
            timestamp=_require_datetime(row, "timestamp"),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid audit log fields: {error}") from error


def _parse_ontology_metadata(raw: object) -> OntologyMetadata:
    row = _require_mapping(raw, "ontology_metadata")
    try:
        return OntologyMetadata(
            dataset_version=_require_str(row, "dataset_version"),
            filter_fingerprint=_require_str(row, "filter_fingerprint"),
            concept_count=_require_int(row, "concept_count"),
            spine_edge_count=_require_int(row, "spine_edge_count"),
            lateral_edge_count=_require_int(row, "lateral_edge_count"),
            loaded_at=_require_datetime(row, "loaded_at"),
            session_id=_require_str(row, "session_id"),
        )
    except ValueError as error:
        raise MemoryStorageError(f"Invalid ontology metadata fields: {error}") from error


def _provenance_payload(provenance: Provenance) -> dict[str, Value]:
    return {
        "valid_from": provenance.valid_from,
        "valid_to": provenance.valid_to,
        "confidence": provenance.confidence,
        "agent_id": provenance.agent_id,
        "agent_role": provenance.agent_role.value,
        "session_id": provenance.session_id,
        "timestamp": provenance.timestamp,
    }


def node_payload(node: MemoryNode) -> dict[str, Value]:
    embedding: list[Value] | None = (
        [float(item) for item in node.embedding] if node.embedding is not None else None
    )
    return {
        "key": node.key,
        "label": node.label,
        "content": node.content,
        "embedding": embedding,
        **_provenance_payload(node.provenance),
    }


def edge_payload(edge: MemoryEdge) -> dict[str, Value]:
    return {
        "weight": edge.weight,
        **_provenance_payload(edge.provenance),
    }


def audit_payload(entry: AuditLogEntry) -> dict[str, Value]:
    return {
        "transaction_id": entry.transaction_id,
        "session_id": entry.session_id,
        "agent_id": entry.agent_id,
        "agent_role": entry.agent_role.value,
        "action": entry.action.value,
        "target_table": entry.target_table,
        "target_id": entry.target_id,
        "payload_json": entry.payload_json,
        "timestamp": entry.timestamp,
    }


def _ontology_metadata_payload(metadata: OntologyMetadata) -> dict[str, Value]:
    return {
        "dataset_version": metadata.dataset_version,
        "filter_fingerprint": metadata.filter_fingerprint,
        "concept_count": metadata.concept_count,
        "spine_edge_count": metadata.spine_edge_count,
        "lateral_edge_count": metadata.lateral_edge_count,
        "loaded_at": metadata.loaded_at,
        "session_id": metadata.session_id,
    }


def extract_query_rows(raw: object, context: str) -> tuple[object, ...]:
    if raw is None:
        return ()
    if not _is_list(raw):
        raise MemoryStorageError(f"Expected list for {context}, got {type(raw).__name__}")
    return tuple(raw)


def _parse_delete_result(raw: object) -> bool:
    if raw is None:
        return False
    if _is_list(raw):
        return len(raw) > 0
    if _is_mapping(raw):
        return True
    raise MemoryStorageError(f"Unexpected delete result type: {type(raw).__name__}")


def parse_created_audit_entry(raw: object) -> AuditLogEntry:
    if _is_list(raw):
        if len(raw) != 1:
            raise MemoryStorageError(f"Expected 1 audit entry row, got {len(raw)}")
        return _parse_audit_entry(raw[0])
    return _parse_audit_entry(raw)


def _to_surreal_value(value: object) -> Value:
    if value is None or isinstance(value, (bool, int, float, str, datetime, RecordID)):
        return value
    if _is_sequence(value):
        return [_to_surreal_value(item) for item in value]
    if _is_mapping(value):
        converted: dict[str, Value] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise MemoryValidationError("Query parameter dict keys must be strings")
            converted[key] = _to_surreal_value(item)
        return converted
    raise MemoryValidationError(f"Unsupported query parameter type: {type(value).__name__}")


def _to_surreal_params(params: Mapping[str, object] | None) -> dict[str, Value] | None:
    if params is None:
        return None
    return {key: _to_surreal_value(value) for key, value in params.items()}


class SurrealMemoryStore:
    def __init__(self, settings: MemorySettings) -> None:
        self._settings = settings
        self._conn: AsyncSurrealConnection | None = None
        self._initialized_scopes: set[str] = set()

    @property
    def settings(self) -> MemorySettings:
        return self._settings

    async def run_query(
        self,
        database: str,
        query: str,
        params: dict[str, object] | None = None,
    ) -> list[object]:
        conn = await self._use_database(database)
        converted = _to_surreal_params(params)
        try:
            raw = await conn.query(query, converted)
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to execute query on {database}: {error}") from error
        return [*raw]

    async def connect(self) -> None:
        if self._conn is not None:
            return
        try:
            conn = AsyncSurreal(self._settings.surreal_url)
            await conn.connect()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to connect to SurrealDB at {self._settings.surreal_url}: {error}"
            ) from error
        self._conn = conn
        _LOGGER.debug("Connected to SurrealDB at %s", self._settings.surreal_url)

    async def close(self) -> None:
        if self._conn is None:
            return
        conn = self._conn
        self._conn = None
        self._initialized_scopes.clear()
        try:
            await conn.close()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to close SurrealDB connection: {error}") from error
        _LOGGER.debug("Closed SurrealDB connection")

    async def __aenter__(self) -> Self:
        await self.connect()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.close()

    def _require_connection(self) -> AsyncSurrealConnection:
        if self._conn is None:
            raise MemoryStorageError("SurrealMemoryStore is not connected")
        return self._conn

    async def _use_database(self, database: str) -> AsyncSurrealConnection:
        conn = self._require_connection()
        try:
            await conn.use(self._settings.namespace, database)
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to switch to {self._settings.namespace}/{database}: {error}"
            ) from error
        return conn

    async def ensure_scope(self, database: str) -> None:
        conn = await self._use_database(database)
        if database in self._initialized_scopes:
            return
        statements = build_schema_statements(self._settings.embedding_dimensions)
        try:
            for statement in statements:
                await conn.query(statement)
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to initialize schema for {self._settings.namespace}/{database}: {error}"
            ) from error
        self._initialized_scopes.add(database)
        _LOGGER.debug("Initialized schema for %s/%s", self._settings.namespace, database)

    async def ensure_user_scope(self) -> str:
        await self.ensure_scope(self._settings.user_database)
        return self._settings.user_database

    async def ensure_project_scope(self, project_id: str) -> str:
        database = self._settings.project_database_name(project_id)
        await self.ensure_scope(database)
        return database

    async def upsert_node(self, database: str, node: MemoryNode) -> MemoryNode:
        conn = await self._use_database(database)
        if (
            node.embedding is not None
            and len(node.embedding) != self._settings.embedding_dimensions
        ):
            raise MemoryValidationError(
                f"Expected embedding length {self._settings.embedding_dimensions}, "
                f"got {len(node.embedding)}"
            )
        record_id = RecordID(node.kind.value, node.key)
        try:
            raw: object = await conn.upsert(record_id, node_payload(node))
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to upsert node {record_id}: {error}") from error
        return _parse_node(raw, expected_kind=node.kind)

    async def get_node(self, database: str, kind: NodeKind, key: str) -> MemoryNode | None:
        conn = await self._use_database(database)
        record_id = RecordID(kind.value, key)
        try:
            raw: object = await conn.select(record_id)
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to get node {record_id}: {error}") from error
        if raw is None:
            return None
        return _parse_node(raw, expected_kind=kind)

    async def delete_node(self, database: str, kind: NodeKind, key: str) -> bool:
        conn = await self._use_database(database)
        record_id = RecordID(kind.value, key)
        try:
            return _parse_delete_result(await conn.delete(record_id))
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to delete node {record_id}: {error}") from error

    async def create_edge(self, database: str, edge: MemoryEdge) -> MemoryEdge:
        conn = await self._use_database(database)
        relation_table = edge.relation.value
        if relation_table not in EDGE_TABLES:
            raise MemoryValidationError(f"Unsupported edge relation: {relation_table!r}")
        source_id = RecordID(edge.source_kind.value, edge.source_key)
        target_id = RecordID(edge.target_kind.value, edge.target_key)
        query = f"RELATE $source->{relation_table}->$target CONTENT $data;"
        params: dict[str, Value] = {
            "source": source_id,
            "target": target_id,
            "data": edge_payload(edge),
        }
        try:
            raw: object = await conn.query(query, params).first()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to create edge {source_id}->{relation_table}->{target_id}: {error}"
            ) from error
        rows = extract_query_rows(raw, "create_edge")
        if len(rows) != 1:
            raise MemoryStorageError(f"Expected 1 edge row from RELATE, got {len(rows)}")
        return parse_edge_record(rows[0])

    async def ensure_edge(self, database: str, edge: MemoryEdge) -> tuple[MemoryEdge, bool]:
        conn = await self._use_database(database)
        relation_table = edge.relation.value
        if relation_table not in EDGE_TABLES:
            raise MemoryValidationError(f"Unsupported edge relation: {relation_table!r}")
        find_query = (
            "SELECT * FROM type::table($table) "
            "WHERE in = type::record($source_kind, $source_key) "
            "AND out = type::record($target_kind, $target_key) "
            "AND valid_to IS NONE LIMIT 1;"
        )
        find_params: dict[str, Value] = {
            "table": relation_table,
            "source_kind": edge.source_kind.value,
            "source_key": edge.source_key,
            "target_kind": edge.target_kind.value,
            "target_key": edge.target_key,
        }
        try:
            existing_raw: object = await conn.query(find_query, find_params).first()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to lookup edge {edge.source_kind.value}:{edge.source_key}"
                f"->{relation_table}->{edge.target_kind.value}:{edge.target_key}: {error}"
            ) from error
        existing_rows = extract_query_rows(existing_raw, "ensure_edge_select")
        if existing_rows:
            existing_row = _require_mapping(existing_rows[0], "edge")
            edge_id = _require_record_id(existing_row, "id")
            try:
                updated_raw: object = await conn.query(
                    "UPDATE $edge_id SET weight = $weight;",
                    {"edge_id": edge_id, "weight": edge.weight},
                ).first()
            except (SurrealError, OSError) as error:
                raise MemoryStorageError(
                    f"Failed to update edge weight for {edge_id}: {error}"
                ) from error
            updated_rows = extract_query_rows(updated_raw, "ensure_edge_update")
            if len(updated_rows) != 1:
                raise MemoryStorageError(
                    f"Expected 1 edge row from UPDATE, got {len(updated_rows)}"
                )
            return parse_edge_record(updated_rows[0]), False
        return await self.create_edge(database, edge), True

    async def list_outgoing_edges(
        self,
        database: str,
        source_kind: NodeKind,
        source_key: str,
        relation: RelationType | None = None,
    ) -> tuple[MemoryEdge, ...]:
        conn = await self._use_database(database)
        if relation is not None:
            if relation.value not in EDGE_TABLES:
                raise MemoryValidationError(f"Unsupported edge relation: {relation.value!r}")
            target_tables: tuple[str, ...] = (relation.value,)
        else:
            target_tables = EDGE_TABLES
        source_id = RecordID(source_kind.value, source_key)
        query = "SELECT * FROM type::table($table) WHERE in = $source;"
        edges: list[MemoryEdge] = []
        try:
            for table in target_tables:
                raw: object = await conn.query(query, {"table": table, "source": source_id}).first()
                edges.extend(
                    parse_edge_record(row) for row in extract_query_rows(raw, "list_outgoing_edges")
                )
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to list outgoing edges for {source_id}: {error}"
            ) from error
        return tuple(edges)

    async def append_audit_entry(self, database: str, entry: AuditLogEntry) -> AuditLogEntry:
        conn = await self._use_database(database)
        try:
            return parse_created_audit_entry(
                await conn.create(AUDIT_LOG_TABLE, audit_payload(entry))
            )
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to append audit entry: {error}") from error

    async def list_audit_entries(
        self,
        database: str,
        *,
        transaction_id: str | None = None,
        session_id: str | None = None,
    ) -> tuple[AuditLogEntry, ...]:
        conn = await self._use_database(database)
        params: dict[str, Value] = {"table": AUDIT_LOG_TABLE}
        if transaction_id is not None and session_id is not None:
            params["transaction_id"] = transaction_id
            params["session_id"] = session_id
            query = (
                "SELECT * FROM type::table($table) "
                "WHERE transaction_id = $transaction_id AND session_id = $session_id "
                "ORDER BY timestamp ASC;"
            )
        elif transaction_id is not None:
            params["transaction_id"] = transaction_id
            query = (
                "SELECT * FROM type::table($table) "
                "WHERE transaction_id = $transaction_id ORDER BY timestamp ASC;"
            )
        elif session_id is not None:
            params["session_id"] = session_id
            query = (
                "SELECT * FROM type::table($table) "
                "WHERE session_id = $session_id ORDER BY timestamp ASC;"
            )
        else:
            query = "SELECT * FROM type::table($table) ORDER BY timestamp ASC;"
        try:
            raw: object = await conn.query(query, params).first()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to list audit entries: {error}") from error
        rows = extract_query_rows(raw, "list_audit_entries")
        return tuple(_parse_audit_entry(row) for row in rows)

    async def get_ontology_metadata(
        self, database: str, dataset_version: str
    ) -> OntologyMetadata | None:
        conn = await self._use_database(database)
        query = (
            "SELECT * FROM type::table($table) WHERE dataset_version = $dataset_version LIMIT 1;"
        )
        params: dict[str, Value] = {
            "table": ONTOLOGY_METADATA_TABLE,
            "dataset_version": dataset_version,
        }
        try:
            raw: object = await conn.query(query, params).first()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to get ontology metadata for {dataset_version!r}: {error}"
            ) from error
        rows = extract_query_rows(raw, "get_ontology_metadata")
        if not rows:
            return None
        return _parse_ontology_metadata(rows[0])

    async def upsert_ontology_metadata(
        self, database: str, metadata: OntologyMetadata
    ) -> OntologyMetadata:
        conn = await self._use_database(database)
        select_query = (
            "SELECT * FROM type::table($table) WHERE dataset_version = $dataset_version LIMIT 1;"
        )
        select_params: dict[str, Value] = {
            "table": ONTOLOGY_METADATA_TABLE,
            "dataset_version": metadata.dataset_version,
        }
        payload = _ontology_metadata_payload(metadata)
        try:
            existing_raw: object = await conn.query(select_query, select_params).first()
            existing_rows = extract_query_rows(existing_raw, "upsert_ontology_metadata_select")
            if existing_rows:
                row = _require_mapping(existing_rows[0], "ontology_metadata")
                record_id = _require_record_id(row, "id")
            else:
                record_id = RecordID(ONTOLOGY_METADATA_TABLE, metadata.dataset_version)
            raw: object = await conn.upsert(record_id, payload)
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(
                f"Failed to upsert ontology metadata for {metadata.dataset_version!r}: {error}"
            ) from error
        return _parse_ontology_metadata(raw)

    async def table_names(self, database: str) -> frozenset[str]:
        conn = await self._use_database(database)
        try:
            raw: object = await conn.query("INFO FOR DB;").first()
        except (SurrealError, OSError) as error:
            raise MemoryStorageError(f"Failed to inspect database {database!r}: {error}") from error
        info = _require_mapping(raw, "INFO FOR DB")
        tables_raw = info.get("tables")
        if tables_raw is None:
            return frozenset()
        tables = _require_mapping(tables_raw, "INFO FOR DB tables")
        return frozenset(tables.keys())
