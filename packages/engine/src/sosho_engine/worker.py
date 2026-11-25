import asyncio
import logging
import signal
from urllib.parse import quote

from sosho_engine import lifecycle, workflows
from sosho_engine.models import litellm_models
from sosho_engine.pi_process import terminate_all
from sosho_engine.queues import HOST_QUEUE
from sosho_engine.runtime import ModelFactory, Runtime
from sosho_engine.settings import WORKER_EXECUTOR, Settings
from sosho_engine.skills import discover_skills
from sosho_engine.tools import ToolRegistry

logger = logging.getLogger(__name__)
DATABASE = "sosho_engine"
LOOPBACK = "127.0.0.1"


def worker_settings() -> Settings:
    base = Settings()
    update: dict[str, object] = {}
    if "executor_id" not in base.model_fields_set:
        update["executor_id"] = WORKER_EXECUTOR
    if "db_url" not in base.model_fields_set and base.pg_password is not None:
        user = quote(base.pg_user, safe="")
        password = quote(base.pg_password.get_secret_value(), safe="")
        update["db_url"] = f"postgresql://{user}:{password}@{LOOPBACK}:{base.pg_port}/{DATABASE}"
    return base.model_copy(update=update)


def publish_skills(active: Runtime, published: list[str]) -> list[str]:
    names = discover_skills(active.settings.skills_path())
    if names != published:
        active.store.replace_skills(names)
        logger.info("skill catalog has %d skills", len(names))
    return names


async def _heartbeat(active: Runtime) -> None:
    settings = active.settings
    published: list[str] = []
    while True:
        try:
            published = await asyncio.to_thread(publish_skills, active, published)
            await asyncio.to_thread(active.store.beat, settings.executor_id, settings.app_version)
        except Exception:
            logger.exception("worker heartbeat failed")
        await asyncio.sleep(settings.worker_beat_seconds)


async def serve(
    settings: Settings, models: ModelFactory, tools: ToolRegistry | None = None
) -> None:
    active = lifecycle.build_runtime(settings, models, tools)
    logger.info("host worker has %d workflow functions", len(workflows.REGISTERED))
    await lifecycle.launch(active, [HOST_QUEUE])
    logger.info(
        "host worker started executor=%s app_version=%s queue=%s",
        settings.executor_id,
        settings.app_version,
        HOST_QUEUE,
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for number in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(number, stop.set)
    beat = asyncio.create_task(_heartbeat(active))
    try:
        await stop.wait()
    finally:
        beat.cancel()
        await asyncio.gather(beat, return_exceptions=True)
        terminate_all()
        await lifecycle.shutdown(active)
    logger.info("host worker stopped")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = worker_settings()
    asyncio.run(serve(settings, litellm_models(settings)))
