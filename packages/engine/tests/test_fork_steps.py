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
    return {"id": "n", "kind": "agent", "role": "main", "prompt": "go"}


def _fork(api: Api, run_id: str, node: str, occurrence: int) -> int:
    return api.post(f"/runs/{run_id}/fork", {"node_id": node, "occurrence": occurrence}).status


@pytest.mark.parametrize("kind", ["wait", "human", "agent"])
def test_a_child_node_in_a_single_pass_run_has_one_execution(host_api: Api, kind: str) -> None:
    wid = unique(f"fk{kind}")
    nodes: list[JsonValue] = [trigger(), _node(kind), tool("t", "echo", value="x")]
    edges: list[JsonValue] = [edge("start", "n"), edge("n", "t")]
    if kind == "human":
        edges = [edge("start", "n"), edge("n", "t", "reject")]
    publish(host_api, draft(nodes, edges), wid)
    detail = run_to_end(host_api, wid)
    run_id = str(dig(detail, "summary", "run_id"))
    assert dig(detail, "summary", "status") == "succeeded"
    assert _fork(host_api, run_id, "n", 2) == 404
    assert _fork(host_api, run_id, "n", 1) == 202


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
    assert wait_terminal(api, str(dig(forked.body, "run_id"))) == "succeeded"
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
    assert wait_terminal(api, fork_id) == "succeeded"
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


def _map_flow(api: Api, looped: bool) -> str:
    child = unique("fkitemchild")
    publish(
        api,
        draft([trigger(), tool("a", "echo", value="{{input.item}}")], [edge("start", "a")]),
        child,
    )
    wid = unique("fkitem")
    fan: Spec = {
        "id": "fan",
        "kind": "map",
        "items": "input.items",
        "workflow_id": child,
        "version": 1,
    }
    nodes: list[JsonValue] = [trigger(), fan]
    edges: list[JsonValue] = [edge("start", "fan")]
    if looped:
        again: Spec = {"path": "loop.iteration", "op": "lt", "value": 1}
        done: Spec = {"path": "loop.iteration", "op": "gte", "value": 1}
        branches: list[JsonValue] = [
            {"name": "again", "when": again},
            {"name": "done", "when": done},
        ]
        nodes.append({"id": "gate", "kind": "router", "branches": branches})
        edges += [edge("fan", "gate"), edge("gate", "fan", "again", loop=True, max_iterations=3)]
    publish(api, draft(nodes, edges), wid)
    return str(dig(run_to_end(api, wid, {"items": [1, 2, 3]}), "summary", "run_id"))


def _fork_item(api: Api, run_id: str, item: int, occurrence: int = 1) -> int:
    body: Spec = {"node_id": "fan", "item": item, "occurrence": occurrence}
    return api.post(f"/runs/{run_id}/fork", body).status


def test_fork_from_a_map_item_with_an_index_of_one_or_more(api: Api) -> None:
    run_id = _map_flow(api, looped=False)
    for item in (0, 1, 2):
        forked = api.post(f"/runs/{run_id}/fork", {"node_id": "fan", "item": item})
        assert forked.status == 202, forked.text
        fork_id = str(dig(forked.body, "run_id"))
        assert wait_terminal(api, fork_id) == "succeeded"
        assert dig(api.get(f"/runs/{fork_id}").body, "output", "output", "fan", "count") == 3
    assert _fork_item(api, run_id, 3) == 404
    assert _fork_item(api, run_id, 1, occurrence=2) == 404


def test_fork_from_a_map_item_counts_executions_of_the_map(api: Api) -> None:
    run_id = _map_flow(api, looped=True)
    assert _fork_item(api, run_id, 2, occurrence=2) == 202
    assert _fork_item(api, run_id, 2, occurrence=3) == 404


def test_locate_step_finds_a_later_item_of_a_map_execution() -> None:
    steps = [
        _step(5, "run_workflow", "r:fan:1:0"),
        _step(6, "run_workflow", "r:fan:1:1"),
        _step(7, "run_workflow", "r:fan:1:2"),
        _step(9, "run_workflow", "r:fan:2:0"),
        _step(10, "run_workflow", "r:fan:2:1"),
    ]
    assert locate_step("r", "fan", steps, 1) == 5
    assert locate_step("r", "fan", steps, 2) == 9
    assert locate_step("r", "fan", steps, 1, 1) == 6
    assert locate_step("r", "fan", steps, 2, 1) == 10
    assert locate_step("r", "fan", steps, 1, 2) == 7
    with pytest.raises(NotFoundError):
        locate_step("r", "fan", steps, 2, 2)
