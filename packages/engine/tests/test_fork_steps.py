import pytest
from engine_support import Api, dig, publish, run_to_end, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine.errors import NotFoundError
from sosho_engine.run_models import StepSummary
from sosho_engine.step_lookup import locate_step


def _node(kind: str) -> Spec:
    if kind == "wait":
        return {"id": "n", "kind": "wait", "seconds": 0}
    if kind == "human":
        return {"id": "n", "kind": "human", "prompt": "ok?", "wait_seconds": 0.1}
    return {"id": "n", "kind": "agent", "role": "agent", "prompt": "go", "tools": ["echo"]}


def _fork(api: Api, run_id: str, node: str, occurrence: int) -> int:
    return api.post(f"/runs/{run_id}/fork", {"node_id": node, "occurrence": occurrence}).status


@pytest.mark.parametrize("kind", ["wait", "human", "agent"])
def test_a_child_node_in_a_single_pass_run_has_one_execution(api: Api, kind: str) -> None:
    wid = unique(f"fk{kind}")
    nodes: list[JsonValue] = [trigger(), _node(kind), tool("t", "echo", value="x")]
    edges: list[JsonValue] = [edge("start", "n"), edge("n", "t")]
    if kind == "human":
        edges = [edge("start", "n"), edge("n", "t", "reject")]
    publish(api, draft(nodes, edges), wid)
    detail = run_to_end(api, wid)
    run_id = str(dig(detail, "summary", "run_id"))
    assert dig(detail, "summary", "status") == "SUCCESS"
    assert _fork(api, run_id, "n", 2) == 404
    assert _fork(api, run_id, "n", 1) == 202


def test_second_execution_of_a_looped_node_can_be_forked(api: Api) -> None:
    wid = unique("fkloop")
    again: Spec = {"path": "loop.iteration", "op": "lt", "value": 3}
    done: Spec = {"path": "loop.iteration", "op": "gte", "value": 3}
    branches: list[JsonValue] = [{"name": "again", "when": again}, {"name": "done", "when": done}]
    router: Spec = {"id": "gate", "kind": "router", "branches": branches}
    nodes: list[JsonValue] = [trigger(), _node("wait"), router]
    edges: list[JsonValue] = [
        edge("start", "n"),
        edge("n", "gate"),
        edge("gate", "n", "again", loop=True, max_iterations=5),
    ]
    publish(api, draft(nodes, edges), wid)
    run_id = str(dig(run_to_end(api, wid), "summary", "run_id"))
    assert _fork(api, run_id, "n", 5) == 404
    forked = api.post(f"/runs/{run_id}/fork", {"node_id": "n", "occurrence": 2})
    assert forked.status == 202
    assert wait_terminal(api, str(dig(forked.body, "run_id"))) == "SUCCESS"
    assert _fork(api, run_id, "n", 4) == 202


def test_fork_from_a_map_node_runs_the_map_again(api: Api) -> None:
    child = unique("fkchild")
    leaf = tool("a", "echo", value="{{input.item}}")
    publish(api, draft([trigger(), leaf], [edge("start", "a")]), child)
    wid = unique("fkmap")
    fan: Spec = {
        "id": "fan",
        "kind": "map",
        "items": "input.items",
        "workflow_id": child,
        "version": 1,
    }
    publish(api, draft([trigger(), fan], [edge("start", "fan")]), wid)
    run_id = str(dig(run_to_end(api, wid, {"items": [1, 2, 3]}), "summary", "run_id"))
    assert _fork(api, run_id, "fan", 2) == 404
    forked = api.post(f"/runs/{run_id}/fork", {"node_id": "fan"})
    assert forked.status == 202
    fork_id = str(dig(forked.body, "run_id"))
    assert wait_terminal(api, fork_id) == "SUCCESS"
    assert dig(api.get(f"/runs/{fork_id}").body, "output", "output", "fan", "count") == 3


def _step(number: int, name: str, child: str | None = None) -> StepSummary:
    return StepSummary(
        step=number, name=name, child_run_id=child, error=None, started_at=None, completed_at=None
    )


def test_locate_step_counts_only_the_start_step_of_a_child() -> None:
    steps = [
        _step(5, "node_workflow", "r:n:1"),
        _step(6, "DBOS.getResult", "r:n:1"),
        _step(9, "node_workflow", "r:n:2"),
        _step(10, "DBOS.getResult", "r:n:2"),
    ]
    assert locate_step("r", "n", steps, 1) == 5
    assert locate_step("r", "n", steps, 2) == 9
    with pytest.raises(NotFoundError):
        locate_step("r", "n", steps, 3)
