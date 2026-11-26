from engine_support import CALLS, Api, dig, publish, run_to_end
from flows import SHORT, Spec, draft, edge, llm, tool, trigger, unique
from pydantic import JsonValue


def _status(detail: JsonValue) -> JsonValue:
    return dig(detail, "summary", "status")


def test_linear_flow_templates_outputs_between_nodes(live_api: Api) -> None:
    wid = unique("linear")
    nodes: list[JsonValue] = [
        trigger(),
        tool("a", "echo", value="{{input.msg}}"),
        llm("b", "Reply with exactly this word and nothing else: {{nodes.a.value}}"),
    ]
    publish(live_api, draft(nodes, [edge("start", "a"), edge("a", "b")]), wid)
    detail = run_to_end(live_api, wid, {"msg": "hello"})
    assert _status(detail) == "succeeded"
    assert "hello" in str(dig(detail, "output", "output", "b", "text")).lower()
    assert dig(detail, "summary", "version") == 1


def test_llm_json_output_is_parsed(live_api: Api) -> None:
    wid = unique("json")
    prompt = 'Reply with only this JSON and no other text: {"answer": 42, "label": "big"}'
    nodes: list[JsonValue] = [trigger(), llm("a", prompt, json_output=True)]
    publish(live_api, draft(nodes, [edge("start", "a")]), wid)
    detail = run_to_end(live_api, wid)
    assert _status(detail) == "succeeded"
    assert dig(detail, "output", "output", "a", "data") == {"answer": 42, "label": "big"}


def _router_spec() -> tuple[list[JsonValue], list[JsonValue]]:
    router: Spec = {
        "id": "pick",
        "kind": "router",
        "branches": [
            {"name": "big", "when": {"path": "input.n", "op": "gt", "value": 10}},
            {"name": "small", "when": {"path": "input.n", "op": "lte", "value": 10}},
        ],
    }
    nodes: list[JsonValue] = [
        trigger(),
        router,
        tool("big_path", "echo", value="big"),
        tool("small_path", "echo", value="small"),
    ]
    edges: list[JsonValue] = [
        edge("start", "pick"),
        edge("pick", "big_path", "big"),
        edge("pick", "small_path", "small"),
    ]
    return nodes, edges


def test_router_takes_only_the_matching_branch(api: Api) -> None:
    wid = unique("route")
    publish(api, draft(*_router_spec()), wid)
    big = run_to_end(api, wid, {"n": 50})
    small = run_to_end(api, wid, {"n": 3})
    assert dig(big, "output", "nodes", "big_path") == "done"
    assert dig(big, "output", "nodes", "small_path") == "skipped"
    assert dig(small, "output", "output") == {"small_path": {"value": "small"}}


def test_parallel_branches_run_and_join_merges_inputs(api: Api) -> None:
    wid = unique("join")
    nodes: list[JsonValue] = [
        trigger(),
        tool("left", "echo", value="L"),
        tool("right", "echo", value="R"),
        {"id": "merge", "kind": "join"},
    ]
    edges: list[JsonValue] = [
        edge("start", "left"),
        edge("start", "right"),
        edge("left", "merge"),
        edge("right", "merge"),
    ]
    publish(api, draft(nodes, edges), wid)
    detail = run_to_end(api, wid)
    inputs = dig(detail, "output", "output", "merge", "inputs")
    assert inputs == {"left": {"value": "L"}, "right": {"value": "R"}}


def test_join_after_router_waits_only_for_live_branches(api: Api) -> None:
    wid = unique("joinr")
    nodes, edges = _router_spec()
    nodes.append({"id": "merge", "kind": "join"})
    edges.extend([edge("big_path", "merge"), edge("small_path", "merge")])
    publish(api, draft(nodes, edges), wid)
    merged = dig(run_to_end(api, wid, {"n": 1}), "output", "output", "merge")
    assert dig(merged, "inputs") == {"small_path": {"value": "small"}}
    assert dig(merged, "dead") == ["big_path"]


def test_step_retries_until_the_tool_succeeds(api: Api) -> None:
    wid = unique("retry")
    tag = unique("tag")
    node = tool("a", "flaky", tag=tag, fail_times=2)
    node["retry"] = {"max_attempts": 4, "interval_seconds": 0.01, "backoff_rate": 1.0}
    publish(api, draft([trigger(), node], [edge("start", "a")]), wid)
    assert _status(run_to_end(api, wid)) == "succeeded"
    assert CALLS[f"tool:{tag}"] == 3


def test_node_fails_run_when_retries_are_used_up(api: Api) -> None:
    wid = unique("fail")
    node = tool("a", "flaky", tag=unique("t"), fail_times=5)
    publish(api, draft([trigger(), node], [edge("start", "a")]), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "failed"
    assert "node a failed" in str(dig(detail, "error"))


def test_continue_on_error_lets_the_flow_go_on(api: Api) -> None:
    wid = unique("cont")
    bad = tool("bad", "flaky", tag=unique("t"), fail_times=5)
    bad["continue_on_error"] = True
    nodes: list[JsonValue] = [trigger(), bad, tool("after", "echo", value="{{nodes.bad.error}}")]
    publish(api, draft(nodes, [edge("start", "bad"), edge("bad", "after")]), wid)
    detail = run_to_end(api, wid)
    assert _status(detail) == "succeeded"
    assert "tool failed" in str(dig(detail, "output", "output", "after", "value"))


def test_queued_llm_node_runs_as_child_workflow(live_api: Api) -> None:
    wid = unique("queue")
    nodes: list[JsonValue] = [trigger(), llm("a", SHORT, queue="cloud-io")]
    publish(live_api, draft(nodes, [edge("start", "a")]), wid)
    detail = run_to_end(live_api, wid)
    run_id = dig(detail, "summary", "run_id")
    steps = dig(detail, "steps")
    assert _status(detail) == "succeeded"
    assert isinstance(steps, list)
    children = [dig(step, "child_run_id") for step in steps]
    assert any(str(child).startswith(f"{run_id}:a:") for child in children)
