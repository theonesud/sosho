"""Start and stop the runtime. It owns the SQLite connection, store, and run manager."""

import asyncio
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from sosho_graph.registry import NodeRegistry, Services
from sosho_graph.run_store import RunStore
from sosho_graph.runs import RunDeps, RunManager
from sosho_graph.settings import Settings
from sosho_graph.tracing import Tracing, close_tracing, open_tracing


def utc_now() -> str:
    """Return the current time in ISO 8601 with UTC offset."""
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    """Return a random identifier."""
    return uuid.uuid4().hex


@asynccontextmanager
async def open_runtime(
    settings: Settings, services: Services, registry: NodeRegistry
) -> AsyncGenerator[RunManager]:
    """Open the checkpoint database and yield a run manager. Close everything on exit."""
    db_path = settings.sosho_graph_db
    await asyncio.to_thread(db_path.parent.mkdir, parents=True, exist_ok=True)
    tracing: Tracing = open_tracing(settings)
    conn = await aiosqlite.connect(str(db_path))
    manager: RunManager | None = None
    try:
        store = RunStore(conn)
        await store.init()
        checkpointer = AsyncSqliteSaver(conn)
        await checkpointer.setup()
        deps = RunDeps(
            store=store,
            checkpointer=checkpointer,
            registry=registry,
            services=services,
            callbacks=tracing.callbacks,
        )
        manager = RunManager(deps, clock=utc_now, new_id=new_id)
        await manager.fail_unfinished()
        yield manager
    finally:
        if manager is not None:
            await manager.shutdown()
        await conn.close()
        close_tracing(tracing)
