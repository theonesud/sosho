from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from itertools import count
from pathlib import Path

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from pydantic import JsonValue, SecretStr
from sosho_graph.nodes import default_registry
from sosho_graph.registry import NodeRegistry, Services
from sosho_graph.runs import RunManager
from sosho_graph.runtime import open_runtime
from sosho_graph.schema import GraphDefinition
from sosho_graph.settings import Settings

FIXED_TIME = "2026-01-01T00:00:00+00:00"


def fixed_clock() -> str:
    return FIXED_TIME


def sequential_ids() -> Callable[[], str]:
    counter = count(1)

    def new_id() -> str:
        return f"id-{next(counter)}"

    return new_id


class FakeModels:
    def __init__(self, replies: dict[str, list[str]]) -> None:
        self._replies = replies
        self._models: dict[str, FakeListChatModel] = {}

    def model_for(self, role: str) -> FakeListChatModel:
        if role not in self._models:
            self._models[role] = FakeListChatModel(responses=self._replies.get(role, ["ok"]))
        return self._models[role]

    def services(self) -> Services:
        return Services(model_for=self.model_for)


def make_settings(db_path: Path) -> Settings:
    return Settings(
        litellm_api_key=SecretStr("test-key"),
        sosho_graph_db=db_path,
        langfuse_host=None,
        langfuse_public_key=None,
        langfuse_secret_key=None,
    )


@asynccontextmanager
async def runtime(
    db_path: Path, services: Services, registry: NodeRegistry | None = None
) -> AsyncGenerator[RunManager]:
    chosen = registry or default_registry()
    async with open_runtime(make_settings(db_path), services, chosen) as manager:
        yield manager


def build_graph(
    *,
    nodes: list[dict[str, JsonValue]],
    edges: list[tuple[str, str, str | None]],
    entry: str,
    max_steps: int = 50,
) -> GraphDefinition:
    edge_dicts: list[JsonValue] = []
    for index, (source, target, condition) in enumerate(edges, start=1):
        edge: dict[str, JsonValue] = {"id": f"e{index}", "source": source, "target": target}
        if condition is not None:
            edge["condition"] = condition
        edge_dicts.append(edge)
    payload: dict[str, JsonValue] = {
        "id": "test-graph",
        "name": "Test graph",
        "entryNode": entry,
        "maxSteps": max_steps,
        "nodes": list(nodes),
        "edges": edge_dicts,
    }
    return GraphDefinition.model_validate(payload)


def agent(node_id: str, prompt: str, output_key: str, **extra: JsonValue) -> dict[str, JsonValue]:
    node: dict[str, JsonValue] = {
        "id": node_id,
        "type": "agent",
        "label": node_id,
        "promptTemplate": prompt,
        "outputKey": output_key,
    }
    node.update(extra)
    return node


def node_of(node_id: str, node_type: str, **extra: JsonValue) -> dict[str, JsonValue]:
    node: dict[str, JsonValue] = {"id": node_id, "type": node_type, "label": node_id}
    node.update(extra)
    return node
