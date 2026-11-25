from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai import Agent
from pydantic_ai.durable_exec.dbos import DBOSDurability
from pydantic_ai.models import Model

from sosho_engine.ratelimit import RateLimiter
from sosho_engine.settings import Settings
from sosho_engine.store import Store
from sosho_engine.tools import ToolRegistry

ModelFactory = Callable[[str], Model]


class AgentPool:
    def __init__(self, models: ModelFactory) -> None:
        self._models = models
        self._agents: dict[str, Agent[None, str]] = {}

    def get(self, role: str) -> Agent[None, str]:
        if role not in self._agents:
            self._agents[role] = Agent(
                self._models(role), name=f"role-{role}", capabilities=[DBOSDurability()]
            )
        return self._agents[role]


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    store: Store
    tools: ToolRegistry
    models: ModelFactory
    agents: AgentPool
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
