"""The catalog lists node kinds, and a new kind runs without any compiler change."""

from pathlib import Path

import pytest
from pydantic import Field
from sosho_graph.nodes import default_kinds, default_registry
from sosho_graph.nodes.builtin import START_KIND
from sosho_graph.registry import (
    NodeConfig,
    NodeContext,
    NodeRegistry,
    NodeRegistryError,
    TypedNodeKind,
)
from sosho_graph.state import NodeUpdate
from support import FakeModels, build_graph, node_of, runtime


def test_catalog_lists_the_built_in_kinds_with_config_schemas() -> None:
    entries = default_registry().catalog()
    assert [entry.type_id for entry in entries] == [
        "agent",
        "checkpoint",
        "decision",
        "end",
        "start",
        "subagent",
    ]
    agent_entry = next(entry for entry in entries if entry.type_id == "agent")
    properties = agent_entry.config_schema.get("properties")
    assert isinstance(properties, dict)
    assert "promptTemplate" in properties


def test_registry_rejects_a_duplicate_type_id() -> None:
    registry = default_registry()
    with pytest.raises(NodeRegistryError):
        registry.register(START_KIND)


class EchoConfig(NodeConfig):
    """Config for the test-only echo kind."""

    text: str = Field(min_length=1)


async def run_echo(ctx: NodeContext, node: EchoConfig) -> NodeUpdate:
    """Write the configured text to the run data."""
    return {"data": {"echo": node.text}}


ECHO_KIND = TypedNodeKind(
    type_id="echo",
    display_name="Echo",
    description="Test only.",
    config_model=EchoConfig,
    output_schema={"type": "object"},
    runner=run_echo,
)


@pytest.mark.anyio
async def test_a_registered_kind_runs_without_compiler_change(tmp_path: Path) -> None:
    registry = NodeRegistry([*default_kinds(), ECHO_KIND])
    graph = build_graph(
        nodes=[node_of("start", "start"), node_of("say", "echo", text="hello")],
        edges=[("start", "say", None)],
        entry="start",
    )
    async with runtime(tmp_path / "echo.sqlite", FakeModels({}).services(), registry) as manager:
        record = await manager.start(graph, {}, None)
        await manager.wait(record.run_id)
        detail = await manager.detail(record.run_id)
    assert detail.status == "completed"
    assert detail.data["echo"] == "hello"
