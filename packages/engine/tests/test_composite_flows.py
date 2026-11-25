from engine_support import Api, dig, publish, run_to_end
from flows import Spec, draft, edge, llm, tool, trigger, unique
from pydantic import JsonValue


def _status(detail: JsonValue) -> JsonValue:
    return dig(detail, "summary", "status")


def _child_flow(api: Api, **extra: JsonValue) -> str:
    wid = unique("child")
    nodes: list[JsonValue] = [
        trigger(),
        tool("shout", "text_join", parts=["item:", "{{input.item}}"]),
    ]
    publish(api, draft(nodes, [edge("start", "shout")], **extra), wid)
    return wid


def _map_node(child: str, **extra: JsonValue) -> Spec:
    return {
        "id": "fan",
        "kind": "map",
        "items": "input.names",
        "workflow_id": child,
        "version": 1,
        **extra,
    }


def test_map_node_runs_a_child_workflow_for_each_item(api: Api) -> None:
    wid = unique("map")
    nodes: list[JsonValue] = [trigger(), _map_node(_child_flow(api))]
    publish(api, draft(nodes, [edge("start", "fan")]), wid)
    detail = run_to_end(api, wid, {"names": ["a", "b", "c"]})
    fan = dig(detail, "output", "output", "fan")
    results = dig(fan, "results")
    assert _status(detail) == "succeeded"
    assert dig(fan, "count") == 3
    assert isinstance(results, list)
    assert [dig(item, "shout", "text") for item in results] == ["item:a", "item:b", "item:c"]


def test_map_node_rejects_more_items_than_its_limit(api: Api) -> None:
    wid = unique("maplim")
    nodes: list[JsonValue] = [trigger(), _map_node(_child_flow(api), max_items=2)]
    publish(api, draft(nodes, [edge("start", "fan")]), wid)
    detail = run_to_end(api, wid, {"names": [1, 2, 3]})
    assert _status(detail) == "failed"
    assert "above 2" in str(dig(detail, "error"))


def test_subworkflow_node_returns_the_child_output(api: Api) -> None:
    wid = unique("sub")
    node: Spec = {
        "id": "inner",
        "kind": "subworkflow",
        "workflow_id": _child_flow(api),
        "version": 1,
        "input": {"item": "{{input.name}}"},
    }
    publish(api, draft([trigger(), node], [edge("start", "inner")]), wid)
    detail = run_to_end(api, wid, {"name": "zed"})
    assert dig(detail, "output", "output", "inner", "output", "shout", "text") == "item:zed"


def _loop_flow(
    max_iterations: int, always: bool, on_limit: str = "exit"
) -> tuple[list[JsonValue], list[JsonValue]]:
    again: Spec = {"path": "input", "op": "exists"}
    if not always:
        again = {"path": "loop.iteration", "op": "lt", "value": 3}
    branches: list[JsonValue] = [{"name": "again", "when": again}]
    if not always:
        branches.append(
            {"name": "done", "when": {"path": "loop.iteration", "op": "gte", "value": 3}}
        )
    router: Spec = {"id": "gate", "kind": "router", "branches": branches}
    nodes: list[JsonValue] = [trigger(), tool("work", "count"), router]
    edges: list[JsonValue] = [
        edge("start", "work"),
        edge("work", "gate"),
        edge("gate", "work", "again", loop=True, max_iterations=max_iterations, on_limit=on_limit),
    ]
    return nodes, edges


def test_loop_edge_repeats_until_condition_ends_it(api: Api) -> None:
    wid = unique("loop")
    publish(api, draft(*_loop_flow(5, always=False)), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "succeeded"
    assert dig(detail, "output", "steps") == 8


def test_loop_limit_stops_a_loop_that_never_ends(api: Api) -> None:
    wid = unique("loopmax")
    publish(api, draft(*_loop_flow(2, always=True, on_limit="fail")), wid)
    detail = run_to_end(api, wid, {"go": True})
    assert _status(detail) == "failed"
    assert "passed 2" in str(dig(detail, "error"))


def test_wait_node_sleeps_then_continues(api: Api) -> None:
    wid = unique("wait")
    nodes: list[JsonValue] = [
        trigger(),
        {"id": "nap", "kind": "wait", "seconds": 0.2},
        tool("after", "echo", value="ok"),
    ]
    publish(api, draft(nodes, [edge("start", "nap"), edge("nap", "after")]), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "succeeded"
    assert dig(detail, "output", "output", "after") == {"value": "ok"}


def test_max_steps_policy_stops_the_run(api: Api) -> None:
    wid = unique("steps")
    nodes: list[JsonValue] = [trigger(), tool("a", "echo", value=1), tool("b", "echo", value=2)]
    edges: list[JsonValue] = [edge("start", "a"), edge("a", "b")]
    publish(api, draft(nodes, edges, policy={"max_steps": 1}), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "failed"
    assert "passed 1 node executions" in str(dig(detail, "error"))


def test_llm_budget_policy_stops_the_run(api: Api) -> None:
    wid = unique("budget")
    nodes: list[JsonValue] = [trigger(), llm("a", "one"), llm("b", "two")]
    edges: list[JsonValue] = [edge("start", "a"), edge("a", "b")]
    publish(api, draft(nodes, edges, policy={"max_llm_calls": 1}), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "failed"
    assert "budget" in str(dig(detail, "error"))


def test_policy_denying_a_tool_rejects_the_version(api: Api) -> None:
    wid = unique("deny")
    api.post("/workflows", {"id": wid, "name": wid})
    nodes: list[JsonValue] = [trigger(), tool("a", "count")]
    spec = draft(nodes, [edge("start", "a")], policy={"allowed_tools": ["echo"]})
    response = api.post(f"/workflows/{wid}/versions", spec)
    assert response.status == 422
    assert dig(response.body, "issues", 0, "code") == "tool_denied"


def test_run_depth_policy_blocks_recursive_chains(api: Api) -> None:
    child = _child_flow(api, policy={"max_depth": 0})
    wid = unique("deep")
    node: Spec = {"id": "inner", "kind": "subworkflow", "workflow_id": child, "version": 1}
    publish(api, draft([trigger(), node], [edge("start", "inner")]), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "failed"
    assert "depth 1 is above 0" in str(dig(detail, "error"))


def test_run_events_stream_lists_node_events_in_order(api: Api) -> None:
    wid = unique("sse")
    nodes: list[JsonValue] = [trigger(), tool("a", "echo", value=1)]
    publish(api, draft(nodes, [edge("start", "a")]), wid)
    run_id = dig(run_to_end(api, wid), "summary", "run_id")
    response = api.get(f"/runs/{run_id}/events")
    lines = [line for line in response.text.splitlines() if line.startswith("data: ")]
    types = [line.split('"type": "')[1].split('"')[0] for line in lines if '"type"' in line]
    assert response.status == 200
    assert types == ["run_started", "node_started", "node_finished", "run_finished"]
    assert "event: end" in response.text
