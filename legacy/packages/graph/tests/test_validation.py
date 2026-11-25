from pathlib import Path

import pytest
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver
from sosho_graph.compiler import GraphBuildError, compile_graph, validate_graph
from sosho_graph.nodes import default_registry
from sosho_graph.registry import Services
from sosho_graph.schema import GraphDefinition
from support import agent, build_graph, node_of


def _valid_graph() -> GraphDefinition:
    return build_graph(
        nodes=[node_of("start", "start"), agent("work", "Do {{topic}}", "draft")],
        edges=[("start", "work", None)],
        entry="start",
    )


def test_valid_graph_has_no_errors() -> None:
    assert validate_graph(_valid_graph(), default_registry()) == []


def test_unknown_node_type_is_reported_as_not_in_catalog() -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            node_of("tool", "skill", skillName="x", promptTemplate="p"),
        ],
        edges=[("start", "tool", None)],
        entry="start",
    )
    errors = validate_graph(graph, default_registry())
    assert any("type 'skill' is not in the catalog" in error for error in errors)


def test_decision_condition_must_be_a_branch() -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            node_of("route", "decision", promptTemplate="p", branches=["a", "b"]),
            node_of("end", "end"),
        ],
        edges=[("start", "route", None), ("route", "end", "c")],
        entry="start",
    )
    errors = validate_graph(graph, default_registry())
    assert any("condition 'c' is not a branch of 'route'" in error for error in errors)


def test_condition_on_agent_is_rejected() -> None:
    graph = build_graph(
        nodes=[node_of("start", "start"), agent("work", "p", "draft"), node_of("end", "end")],
        edges=[("start", "work", None), ("work", "end", "approve")],
        entry="start",
    )
    errors = validate_graph(graph, default_registry())
    assert any("'approve' is not allowed on 'work'" in error for error in errors)


def test_mixed_conditional_and_plain_edges_are_rejected() -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            node_of("gate", "checkpoint", message="Review"),
            node_of("end", "end"),
        ],
        edges=[("start", "gate", None), ("gate", "end", "approve"), ("gate", "start", None)],
        entry="start",
    )
    errors = validate_graph(graph, default_registry())
    assert any("mixes conditional and unconditional" in error for error in errors)


def test_bad_node_config_reports_the_node_and_field() -> None:
    graph = build_graph(
        nodes=[node_of("start", "start"), node_of("work", "agent", outputKey="draft")],
        edges=[("start", "work", None)],
        entry="start",
    )
    errors = validate_graph(graph, default_registry())
    assert any(
        error.startswith("node 'work' config:") and "promptTemplate" in error for error in errors
    )


def test_compile_refuses_an_invalid_graph(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[node_of("start", "start"), node_of("tool", "shell")],
        edges=[("start", "tool", None)],
        entry="start",
    )
    services = Services(model_for=_never_called)
    with pytest.raises(GraphBuildError) as raised:
        compile_graph(graph, default_registry(), services, InMemorySaver())
    assert raised.value.errors


def _never_called(role: str) -> BaseChatModel:
    raise AssertionError(f"no model call expected for {role}")
