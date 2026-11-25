import asyncio

from engine_support import fake_models, test_tools
from sosho_engine.worker import serve, worker_settings

asyncio.run(serve(worker_settings(), fake_models, test_tools()))
