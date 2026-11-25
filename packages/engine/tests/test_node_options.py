import pytest
from engine_support import Api, dig, publish, run_to_end, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, llm, tool, trigger, unique
from pydantic import JsonValue

Nodes = list[JsonValue]


def _join_flow(require_all: bool) -> Spec:
    pick_a: Spec = {"path": "input.pick", "op": "eq", "value": "a"}
    pick_b: Spec = {"path": "input.pick", "op": "eq", "value": "b"}
    branches: Nodes = [{"name": "a", "when": pick_a}, {"name": "b", "when": pick_b}]
    router: Spec = {"id": "r", "kind": "router", "branches": branches}
    join: Spec = {"id": "j", "kind": "join", "require_all": require_all}
    nodes: Nodes = [trigger(), router, tool("p", "echo", value="P"), tool("q", "echo", value="Q")]
    edges: Nodes = [
        edge("start", "r"),
        edge("r", "p", "a"),
        edge("r", "q", "b"),
        edge("p", "j"),
        edge("q", "j"),
    ]
    return draft([*nodes, join], edges)


def test_join_without_require_all_runs_with_a_dead_branch(api: Api) -> None:
    wid = unique("joinopen")
    publish(api, _join_flow(False), wid)
    detail = run_to_end(api, wid, {"pick": "a"})
    assert dig(detail, "summary", "status") == "succeeded"
    assert dig(detail, "output", "output", "j", "dead") == ["q"]
    assert dig(detail, "output", "output", "j", "inputs", "p") == {"value": "P"}


def test_join_with_require_all_fails_when_a_branch_is_dead(api: Api) -> None:
    wid = unique("joinall")
    publish(api, _join_flow(True), wid)
    detail = run_to_end(api, wid, {"pick": "a"})
    assert dig(detail, "summary", "status") == "failed"
    assert "lacks inputs from ['q']" in str(dig(detail, "error"))


def _human(**extra: JsonValue) -> Spec:
    return {"id": "ask", "kind": "human", "prompt": "ok?", **extra}


def test_human_timeout_gives_the_default_value(api: Api) -> None:
    wid = unique("humanval")
    ask = _human(
        actions=["input", "approve"],
        default_action="input",
        default_value="fallback",
        wait_seconds=0.3,
    )
    nodes: Nodes = [trigger(), ask, tool("t", "echo", value="{{nodes.ask.value}}")]
    publish(api, draft(nodes, [edge("start", "ask"), edge("ask", "t", "input")]), wid)
    detail = run_to_end(api, wid)
    assert dig(detail, "output", "output", "t") == {"value": "fallback"}
    assert dig(detail, "output", "nodes", "ask") == "done"


def test_human_show_text_is_rendered_into_the_pending_request(api: Api) -> None:
    wid = unique("humanshow")
    ask = _human(show="Details: {{input.what}}", wait_seconds=60)
    publish(api, draft([trigger(), ask], [edge("start", "ask")]), wid)
    run_id = start(api, wid, {"what": "release 4"})
    assert dig(wait_pending(api, run_id), 0, "show") == "Details: release 4"
    api.post(f"/runs/{run_id}/cancel")
    assert wait_terminal(api, run_id) == "cancelled"


def _timed_node(kind: str) -> Spec:
    if kind == "llm":
        return llm("n", "slow:x", timeout_seconds=1)
    if kind == "tool":
        return {**tool("n", "slow", value=1), "timeout_seconds": 1}
    return {
        "id": "n",
        "kind": "agent",
        "role": "main",
        "prompt": "sleep:{{input.tag}}",
        "timeout_seconds": 1,
    }


@pytest.mark.parametrize("kind", ["llm", "tool", "agent"])
def test_timeout_seconds_stops_a_slow_node_at_run_time(host_api: Api, kind: str) -> None:
    wid = unique(f"tm{kind}")
    publish(host_api, draft([trigger(), _timed_node(kind)], [edge("start", "n")]), wid)
    detail = run_to_end(host_api, wid, {"tag": wid})
    assert dig(detail, "summary", "status") == "failed"
    assert dig(detail, "output", "output") is None


def test_agent_instructions_are_rendered_and_sent_to_the_model(host_api: Api) -> None:
    wid = unique("agentins")
    node: Spec = {
        "id": "n",
        "kind": "agent",
        "role": "main",
        "prompt": "ins:go",
        "instructions": "Be {{input.tone}}",
    }
    publish(host_api, draft([trigger(), node], [edge("start", "n")]), wid)
    detail = run_to_end(host_api, wid, {"tone": "calm"})
    assert dig(detail, "output", "output", "n", "text") == "instructions:Be calm"
