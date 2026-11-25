from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai.models import Model

from sosho_engine.ratelimit import RateLimiter
from sosho_engine.settings import Settings
from sosho_engine.store import Store
from sosho_engine.tools import ToolRegistry

ModelFactory = Callable[[str], Model]


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    store: Store
    tools: ToolRegistry
    models: ModelFactory
    webhook_limiter: RateLimiter


class RuntimeNotInstalledError(RuntimeError):
    pass


_installed: list[Runtime] = []


def install(runtime: Runtime) -> None:
    _installed.clear()
    _installed.append(runtime)


def current() -> Runtime:
    if not _installed:
        raise RuntimeNotInstalledError("the engine runtime is not installed")
    return _installed[0]
