import asyncio

import psycopg
from dbos import DBOS, DBOSConfig
from psycopg import sql
from sqlalchemy.engine import make_url

from sosho_engine import runtime
from sosho_engine.catalog import QUEUES
from sosho_engine.ratelimit import RateLimiter
from sosho_engine.runtime import AgentPool, ModelFactory, Runtime
from sosho_engine.settings import Settings
from sosho_engine.store import Store
from sosho_engine.tools import ToolRegistry, builtin_tools
from sosho_engine.tracing import start_tracing

APP_NAME = "sosho-engine"


def ensure_database(url: str) -> None:
    parsed = make_url(url)
    if not parsed.drivername.startswith("postgresql") or parsed.database is None:
        return
    admin = parsed.set(drivername="postgresql", database="postgres")
    with psycopg.connect(admin.render_as_string(hide_password=False), autocommit=True) as conn:
        query = "SELECT 1 FROM pg_database WHERE datname = %s"
        if conn.execute(query, (parsed.database,)).fetchone() is None:
            statement = sql.SQL("CREATE DATABASE {}").format(sql.Identifier(parsed.database))
            conn.execute(statement)


def dbos_config(settings: Settings) -> DBOSConfig:
    return {
        "name": APP_NAME,
        "system_database_url": settings.db_url,
        "application_version": settings.app_version,
        "log_level": "WARNING",
        "run_migrations": True,
    }


def build_runtime(
    settings: Settings, models: ModelFactory, tools: ToolRegistry | None = None
) -> Runtime:
    registry = tools if tools is not None else builtin_tools()
    limiter = RateLimiter(settings.webhook_rate_per_minute)
    return Runtime(settings, Store(settings.db_url), registry, models, AgentPool(models), limiter)


async def launch(active: Runtime) -> None:
    sqlite = active.settings.sqlite_path()
    if sqlite is not None:
        await asyncio.to_thread(sqlite.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(ensure_database, active.settings.db_url)
    await asyncio.to_thread(active.store.create_tables)
    runtime.install(active)
    start_tracing(active.settings)
    DBOS(config=dbos_config(active.settings))
    await asyncio.to_thread(DBOS.launch)
    for name, limits in QUEUES.items():
        await DBOS.register_queue_async(
            name,
            global_concurrency=limits["global_concurrency"],
            worker_concurrency=limits["worker_concurrency"],
        )


async def shutdown(active: Runtime) -> None:
    DBOS.destroy()
    active.store.close()
