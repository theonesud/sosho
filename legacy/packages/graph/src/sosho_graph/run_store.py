from dataclasses import dataclass
from typing import Literal

import aiosqlite

from sosho_graph.schema import GraphDefinition

type RunStatus = Literal["running", "waiting_checkpoint", "completed", "failed", "cancelled"]

TERMINAL_STATUSES: frozenset[str] = frozenset({"completed", "failed", "cancelled"})

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    graph_id TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

_UPSERT = """
INSERT INTO runs (run_id, thread_id, graph_id, graph_json, status, error, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (run_id) DO UPDATE SET
    status = excluded.status,
    error = excluded.error,
    updated_at = excluded.updated_at
"""

_SELECT_ONE = """
SELECT run_id, thread_id, graph_json, status, error, created_at, updated_at
FROM runs WHERE run_id = ?
"""

_SELECT_RECENT = """
SELECT run_id, thread_id, graph_json, status, error, created_at, updated_at
FROM runs ORDER BY created_at DESC LIMIT ?
"""


@dataclass(frozen=True)
class RunRow:
    run_id: str
    thread_id: str
    graph: GraphDefinition
    status: RunStatus
    error: str | None
    created_at: str
    updated_at: str


def _row_from_tuple(values: tuple[object, ...]) -> RunRow:
    run_id, thread_id, graph_json, status, error, created_at, updated_at = values
    if not isinstance(run_id, str) or not isinstance(graph_json, str):
        raise TypeError("stored run row has an unexpected column type")
    return RunRow(
        run_id=run_id,
        thread_id=str(thread_id),
        graph=GraphDefinition.model_validate_json(graph_json),
        status=_status(status),
        error=error if isinstance(error, str) else None,
        created_at=str(created_at),
        updated_at=str(updated_at),
    )


def _status(value: object) -> RunStatus:
    allowed: dict[str, RunStatus] = {
        "running": "running",
        "waiting_checkpoint": "waiting_checkpoint",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
    }
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"unknown run status in store: {value!r}")
    return allowed[value]


class RunStore:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def init(self) -> None:
        await self._conn.execute(_SCHEMA)
        await self._conn.commit()

    async def save(self, row: RunRow) -> None:
        params = (
            row.run_id,
            row.thread_id,
            row.graph.id,
            row.graph.model_dump_json(by_alias=True),
            row.status,
            row.error,
            row.created_at,
            row.updated_at,
        )
        await self._conn.execute(_UPSERT, params)
        await self._conn.commit()

    async def get(self, run_id: str) -> RunRow | None:
        cursor = await self._conn.execute(_SELECT_ONE, (run_id,))
        values = await cursor.fetchone()
        return None if values is None else _row_from_tuple(tuple(values))

    async def list_recent(self, limit: int) -> list[RunRow]:
        cursor = await self._conn.execute(_SELECT_RECENT, (limit,))
        rows = await cursor.fetchall()
        return [_row_from_tuple(tuple(values)) for values in rows]

    async def fail_unfinished(self, message: str, now: str) -> int:
        cursor = await self._conn.execute(
            "UPDATE runs SET status = 'failed', error = ?, updated_at = ? WHERE status = 'running'",
            (message, now),
        )
        await self._conn.commit()
        return cursor.rowcount
