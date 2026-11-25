import pytest
from flows import Spec, draft, edge, llm, tool, trigger
from pydantic import JsonValue, ValidationError
from sosho_engine.spec import Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.validation import SpecInvalidError, assert_valid, validate_workflow

Nodes = list[JsonValue]


def _workflow(nodes: Nodes, edges: Nodes, **extra: JsonValue) -> Workflow:
    return draft_to_workflow(WorkflowDraft.model_validate(draft(nodes, edges, **extra)), "wf", 1)


def _issues(
    nodes: Nodes, edges: Nodes, known: set[str] | None = None, **extra: JsonValue
) -> set[str]:
    return {issue.code for issue in validate_workflow(_workflow(nodes, edges, **extra), known)}


def _router() -> Spec:
    branch: Spec = {"name": "x", "when": {"path": "input.a"}}
    return {"id": "r", "kind": "router", "branches": [branch]}


def _chain() -> tuple[Nodes, Nodes]:
    nodes: Nodes = [trigger(), tool("a", "echo"), tool("b", "echo")]
    return nodes, [edge("start", "a"), edge("a", "b")]


def test_valid_linear_workflow_has_no_issues() -> None:
    nodes: Nodes = [trigger(), tool("a", "echo")]
    assert _issues(nodes, [edge("start", "a")], {"echo"}) == set()


def test_unknown_entry_and_non_trigger_entry_are_reported() -> None:
    nodes: Nodes = [trigger("t"), tool("start", "echo")]
    assert "entry_not_trigger" in _issues(nodes, [edge("t", "start")])
    assert "unknown_entry" in _issues([trigger("t")], [])


def test_duplicate_node_ids_are_reported() -> None:
    nodes: Nodes = [trigger(), tool("a", "echo"), tool("a", "echo")]
    assert "duplicate_node" in _issues(nodes, [])


def test_dangling_edge_is_reported() -> None:
    assert "dangling_edge" in _issues([trigger()], [edge("start", "ghost")])


def test_unreachable_node_is_reported() -> None:
    nodes: Nodes = [trigger(), tool("a", "echo"), tool("b", "echo")]
    assert "unreachable" in _issues(nodes, [edge("start", "a")])


def test_cycle_without_loop_edge_is_reported() -> None:
    nodes, edges = _chain()
    assert "cycle" in _issues(nodes, [*edges, edge("b", "a")])


def test_loop_edge_needs_a_cap_and_must_point_back() -> None:
    nodes, edges = _chain()
    assert "loop_unbounded" in _issues(nodes, [*edges, edge("b", "a", loop=True)])
    assert _issues(nodes, [*edges, edge("b", "a", loop=True, max_iterations=3)]) == set()
    assert "loop_not_back" in _issues(nodes, [*edges, edge("a", "b", loop=True, max_iterations=2)])


def test_loop_cap_above_the_limit_is_refused() -> None:
    edges: Nodes = [edge("start", "start", loop=True, max_iterations=51)]
    with pytest.raises(ValidationError):
        WorkflowDraft.model_validate(draft([trigger()], edges))


def test_join_needs_two_inputs_and_other_nodes_may_not_merge() -> None:
    join: Spec = {"id": "j", "kind": "join"}
    assert "join_inputs" in _issues([trigger(), join], [edge("start", "j")])
    nodes: Nodes = [trigger(), tool("a", "echo"), tool("b", "echo"), tool("c", "echo")]
    edges: Nodes = [edge("start", "a"), edge("start", "b"), edge("a", "c"), edge("b", "c")]
    assert "missing_join" in _issues(nodes, edges)


def test_branch_names_are_checked() -> None:
    nodes: Nodes = [trigger(), _router(), tool("a", "echo")]
    assert "unknown_branch" in _issues(nodes, [edge("start", "r"), edge("r", "a", "nope")])
    plain: Nodes = [trigger(), tool("a", "echo")]
    assert "when_source" in _issues(plain, [edge("start", "a", "x")])
    router: Spec = {**_router(), "default": "ghost"}
    assert "unknown_default" in _issues([trigger(), router], [edge("start", "r")])


def test_queue_and_timeout_only_fit_work_nodes() -> None:
    wait: Spec = {
        "id": "w",
        "kind": "wait",
        "seconds": 1,
        "queue": "cloud-io",
        "timeout_seconds": 5,
    }
    codes = _issues([trigger(), wait], [edge("start", "w")])
    assert {"queue_kind", "timeout_kind"} <= codes


def test_policy_denies_kinds_and_tools() -> None:
    nodes: Nodes = [trigger(), llm("a", "hi"), tool("b", "echo")]
    edges: Nodes = [edge("start", "a"), edge("a", "b")]
    policy: Spec = {"allowed_kinds": ["trigger", "tool"], "allowed_tools": []}
    assert {"kind_denied", "tool_denied"} <= _issues(nodes, edges, policy=policy)


def test_unknown_tool_and_unknown_template_reference_are_reported() -> None:
    nodes: Nodes = [trigger(), tool("a", "ghost", value="{{nodes.zzz.out}}")]
    codes = _issues(nodes, [edge("start", "a")], {"echo"})
    assert {"unknown_tool", "unknown_reference"} <= codes


def test_trigger_modes_need_their_fields() -> None:
    with pytest.raises(ValidationError):
        WorkflowDraft.model_validate(draft([trigger(mode="cron")], []))
    with pytest.raises(ValidationError):
        WorkflowDraft.model_validate(draft([trigger(mode="workflow_finished")], []))


def test_extra_fields_and_bad_ids_are_refused() -> None:
    with pytest.raises(ValidationError):
        WorkflowDraft.model_validate(draft([trigger(surprise=1)], []))
    with pytest.raises(ValidationError):
        WorkflowDraft.model_validate(draft([trigger("bad id")], []))


def test_assert_valid_raises_with_all_issues() -> None:
    spec = _workflow([trigger()], [edge("start", "ghost")])
    with pytest.raises(SpecInvalidError) as caught:
        assert_valid(spec)
    assert caught.value.issues[0].code == "dangling_edge"


def test_workflow_model_round_trips_through_json() -> None:
    spec = draft_to_workflow(WorkflowDraft.model_validate(draft([trigger()], [])), "wf", 3)
    assert Workflow.model_validate_json(spec.model_dump_json()) == spec
