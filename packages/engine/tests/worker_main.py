import asyncio
import os

from engine_support import test_tools
from sosho_engine.catalog import QUEUES
from sosho_engine.models import litellm_models
from sosho_engine.worker import serve, worker_settings

slots = os.environ.get("SOSHO_TEST_HOST_SLOTS")
if slots is not None:
    QUEUES["host"] = {"global_concurrency": int(slots), "worker_concurrency": int(slots)}

settings = worker_settings()
asyncio.run(serve(settings, litellm_models(settings), test_tools()))
