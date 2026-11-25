from flows import Spec, draft, edge, tool, trigger
from pydantic import JsonValue
from sosho_engine.conditions import evaluate
from sosho_engine.scheduler import complete, new_state, settle
from sosho_engine.spec import Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.spec_nodes import Condition
from sosho_engine.templating import render_template, render_value, resolve_path, template_paths

DATA: dict[str, JsonValue] = {
    "input": {"n": 5, "tags": ["a", "b"], "name": "Ann"},
    "nodes": {"x": {"out": [1, 2]}},
}


def test_resolve_path_walks_objects_and_list_indexes() -> None:
    assert resolve_path(DATA, "input.name") == "Ann"
    assert resolve_path(DATA, "nodes.x.out.1") == 2
    assert resolve_path(DATA, "input.missing.deeper") is None
    assert resolve_path(DATA, "nodes.x.out.9") is None


def test_render_template_fills_text_and_json_values() -> None:
    assert render_template("Hi {{ input.name }}!", DATA) == "Hi Ann!"
    assert render_template("{{input.nope}}|", DATA) == "|"
    assert render_template("{{nodes.x.out}}", DATA) == "[\n  1,\n  2\n]"


def test_render_value_keeps_types_for_whole_placeholders() -> None:
    template: JsonValue = {"a": "{{input.n}}", "b": ["{{input.name}}", "x{{input.n}}"]}
    assert render_value(template, DATA) == {"a": 5, "b": ["Ann", "x5"]}


def test_template_paths_finds_nested_references() -> None:
    template: JsonValue = {"a": ["{{nodes.x.out}}"], "b": "{{input.n}}"}
    assert template_paths(template) == ["nodes.x.out", "input.n"]


def _check(path: str, op: str, value: JsonValue = None) -> bool:
    condition = Condition.model_validate({"path": path, "op": op, "value": value})
    return evaluate(condition, DATA)


def test_conditions_compare_numbers_and_equality() -> None:
    assert _check("input.n", "eq", 5)
    assert _check("input.n", "ne", 6)
    assert _check("input.n", "gt", 4)
    assert _check("input.n", "gte", 5)
    assert _check("input.n", "lt", 6)
    assert _check("input.n", "lte", 5)
    assert not _check("input.name", "gt", 1)


def test_conditions_test_membership_and_presence() -> None:
    assert _check("input.name", "in", "Ann Lee")
    assert _check("input.tags", "contains", "a")
    assert _check("input.n", "in", [5, 6])
    assert _check("input.name", "truthy")
    assert not _check("input.zero", "truthy")
    assert _check("input.n", "exists")
    assert not _check("input.zero", "exists")


def _workflow(nodes: list[JsonValue], edges: list[JsonValue]) -> Workflow:
    return draft_to_workflow(WorkflowDraft.model_validate(draft(nodes, edges)), "wf", 1)


def test_scheduler_marks_untaken_branches_and_their_children_skipped() -> None:
    branch: Spec = {"name": "a", "when": {"path": "input"}}
    router: Spec = {"id": "r", "kind": "router", "branches": [branch]}
    nodes: list[JsonValue] = [
        trigger(),
        router,
        tool("x", "echo"),
        tool("y", "echo"),
        tool("z", "echo"),
    ]
    edges: list[JsonValue] = [
        edge("start", "r"),
        edge("r", "x", "a"),
        edge("r", "y", "b"),
        edge("y", "z"),
    ]
    state = new_state(_workflow(nodes, edges), "start", {})
    assert settle(state) == ["r"]
    complete(state, "r", {"branch": "a"})
    assert settle(state) == ["x"]
    assert state.statuses["y"] == "skipped"
    assert state.statuses["z"] == "skipped"


def test_scheduler_runs_ready_nodes_in_sorted_order() -> None:
    nodes: list[JsonValue] = [trigger(), tool("b", "echo"), tool("a", "echo")]
    edges: list[JsonValue] = [edge("start", "b"), edge("start", "a")]
    state = new_state(_workflow(nodes, edges), "start", {})
    assert settle(state) == ["a", "b"]
