import pytest
from engine_support import Api, dig, publish, run_to_end
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine.conditions import evaluate
from sosho_engine.spec import WorkflowDraft, draft_to_workflow
from sosho_engine.spec_nodes import Condition
from sosho_engine.validation import validate_workflow

Nodes = list[JsonValue]


def _codes(nodes: Nodes, edges: Nodes) -> set[str]:
    spec = draft_to_workflow(WorkflowDraft.model_validate(draft(nodes, edges)), "wf", 1)
    return {issue.code for issue in validate_workflow(spec)}


def _router(path: str, value: JsonValue = None, op: str = "exists") -> Spec:
    when: Spec = {"path": path, "op": op, "value": value}
    return {"id": "r", "kind": "router", "branches": [{"name": "x", "when": when}]}


def _flow(router: Spec) -> tuple[Nodes, Nodes]:
    nodes: Nodes = [trigger(), tool("a", "echo"), router, tool("late", "echo")]
    edges: Nodes = [edge("start", "a"), edge("a", "r"), edge("r", "late")]
    return nodes, edges


def test_condition_path_naming_an_unknown_node_is_an_error() -> None:
    assert "unknown_reference" in _codes(*_flow(_router("nodes.ghost.ok")))


def test_condition_path_naming_a_node_that_is_not_upstream_is_an_error() -> None:
    assert "not_upstream" in _codes(*_flow(_router("nodes.late.value")))


def test_condition_path_naming_an_upstream_node_is_valid() -> None:
    assert _codes(*_flow(_router("nodes.a.value"))) == set()


def test_condition_path_with_an_unknown_root_is_an_error() -> None:
    assert "bad_condition_path" in _codes(*_flow(_router("nodez.a.value")))


def test_condition_value_placeholder_must_name_an_upstream_node() -> None:
    codes = _codes(*_flow(_router("input.n", "{{nodes.late.value}}", "eq")))
    assert "not_upstream" in codes
    assert "unknown_reference" in _codes(*_flow(_router("input.n", "{{nodes.ghost.v}}", "eq")))


def test_condition_value_is_rendered_from_the_data() -> None:
    data: dict[str, JsonValue] = {"input": {"limit": 5, "n": 7, "name": "x"}}
    assert evaluate(Condition(path="input.n", op="gt", value="{{input.limit}}"), data)
    assert not evaluate(Condition(path="input.n", op="lt", value="{{input.limit}}"), data)
    assert evaluate(Condition(path="input.name", op="eq", value="{{ input.name }}"), data)


def test_router_compares_to_a_value_from_the_run_input(api: Api) -> None:
    wid = unique("condval")
    big: Spec = {"path": "input.n", "op": "gte", "value": "{{input.threshold}}"}
    small: Spec = {"path": "input.n", "op": "lt", "value": "{{input.threshold}}"}
    branches: Nodes = [{"name": "big", "when": big}, {"name": "small", "when": small}]
    router: Spec = {"id": "r", "kind": "router", "branches": branches}
    nodes: Nodes = [trigger(), router, tool("yes", "echo", value=1), tool("no", "echo", value=0)]
    edges: Nodes = [edge("start", "r"), edge("r", "yes", "big"), edge("r", "no", "small")]
    publish(api, draft(nodes, edges), wid)
    over = run_to_end(api, wid, {"n": 9, "threshold": 5})
    assert dig(over, "output", "output") == {"yes": {"value": 1}}
    under = run_to_end(api, wid, {"n": 1, "threshold": 5})
    assert dig(under, "output", "output") == {"no": {"value": 0}}


@pytest.mark.parametrize("kind", ["human", "wait", "map", "subworkflow", "trigger"])
def test_retry_on_a_kind_that_ignores_it_is_an_error(kind: str) -> None:
    node = _node_of(kind)
    nodes: Nodes = [trigger(), node] if kind != "trigger" else [trigger(retry=_RETRY)]
    edges: Nodes = [edge("start", "n")] if kind != "trigger" else []
    assert "retry_kind" in _codes(nodes, edges)


_RETRY: Spec = {"max_attempts": 3}


def _node_of(kind: str) -> Spec:
    nodes: dict[str, Spec] = {
        "human": {"id": "n", "kind": "human", "prompt": "ok?"},
        "wait": {"id": "n", "kind": "wait", "seconds": 1},
        "map": {"id": "n", "kind": "map", "items": "input.x", "workflow_id": "w", "version": 1},
        "subworkflow": {"id": "n", "kind": "subworkflow", "workflow_id": "w", "version": 1},
        "trigger": trigger("n"),
    }
    return {**nodes[kind], "retry": _RETRY}


@pytest.mark.parametrize("kind", ["agent", "tool", "llm", "router", "join"])
def test_retry_on_a_kind_that_uses_it_is_valid(kind: str) -> None:
    nodes: dict[str, Spec] = {
        "agent": {"id": "n", "kind": "agent", "role": "main", "prompt": "go"},
        "tool": tool("n", "echo"),
        "llm": {"id": "n", "kind": "llm", "role": "fast", "prompt": "hi"},
        "router": _router("input.a") | {"id": "n"},
        "join": {"id": "n", "kind": "join"},
    }
    chosen: Spec = {**nodes[kind], "retry": _RETRY}
    if kind == "join":
        extra: Nodes = [tool("p", "echo"), tool("q", "echo")]
        edges: Nodes = [edge("start", "p"), edge("start", "q"), edge("p", "n"), edge("q", "n")]
        assert _codes([trigger(), *extra, chosen], edges) == set()
    else:
        assert _codes([trigger(), chosen], [edge("start", "n")]) == set()


def test_agent_retry_runs_the_agent_again_after_a_failure(host_api: Api) -> None:
    wid = unique("agentretry")
    node: Spec = {
        "id": "n",
        "kind": "agent",
        "role": "main",
        "prompt": "flaky:{{input.tag}}",
        "max_turns": 3,
        "retry": {"max_attempts": 2, "interval_seconds": 0},
    }
    publish(host_api, draft([trigger(), node], [edge("start", "n")]), wid)
    detail = run_to_end(host_api, wid, {"tag": wid})
    assert dig(detail, "summary", "status") == "succeeded"
    assert str(dig(detail, "output", "output", "n", "text")).startswith("fake done:")
    assert dig(detail, "output", "llm_calls") == 4


def test_agent_without_retry_fails_on_the_first_error(host_api: Api) -> None:
    wid = unique("agentnoretry")
    node: Spec = {"id": "n", "kind": "agent", "role": "main", "prompt": "flaky:{{input.tag}}"}
    publish(host_api, draft([trigger(), node], [edge("start", "n")]), wid)
    detail = run_to_end(host_api, wid, {"tag": wid})
    assert dig(detail, "summary", "status") == "failed"
