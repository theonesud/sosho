from engine_support import Api, dig, publish, run_to_end
from fault_proxy import routed
from flows import PI_ROLE, SHORT, Spec, draft, edge, llm, tool, trigger, unique
from pydantic import JsonValue
from worker_support import WorkerHandle, worker_with

ITEMS = 10
HOST_ITEMS = 2


def _status(detail: JsonValue) -> JsonValue:
    return dig(detail, "summary", "status")


def _queued_tool_child(api: Api) -> str:
    wid = unique("qchild")
    node = tool("t", "echo", value="{{input.item}}")
    node["queue"] = "cloud-io"
    publish(api, draft([trigger(), node], [edge("start", "t")]), wid)
    return wid


def _agent_child(api: Api) -> str:
    wid = unique("agchild")
    agent: Spec = {"id": "ag", "kind": "agent", "role": PI_ROLE, "prompt": SHORT, "thinking": "off"}
    publish(api, draft([trigger(), agent], [edge("start", "ag")]), wid)
    return wid


def _map_node(child: str) -> Spec:
    return {"id": "fan", "kind": "map", "items": "input.items", "workflow_id": child, "version": 1}


def _sub_node(child: str) -> Spec:
    return {"id": "inner", "kind": "subworkflow", "workflow_id": child, "version": 1}


def test_map_over_queued_nodes_does_not_deadlock_the_queue(api: Api) -> None:
    parent = unique("mapq")
    nodes: list[JsonValue] = [trigger(), _map_node(_queued_tool_child(api))]
    publish(api, draft(nodes, [edge("start", "fan")]), parent)
    detail = run_to_end(api, parent, {"items": list(range(ITEMS))})
    assert _status(detail) == "succeeded"
    assert dig(detail, "output", "output", "fan", "count") == ITEMS


def test_nested_subworkflow_with_agent_nodes_does_not_deadlock(
    live_host_api: Api, worker: WorkerHandle
) -> None:
    middle = unique("mid")
    publish(
        live_host_api,
        draft([trigger(), _sub_node(_agent_child(live_host_api))], [edge("start", "inner")]),
        middle,
    )
    parent = unique("top")
    publish(live_host_api, draft([trigger(), _map_node(middle)], [edge("start", "fan")]), parent)
    with worker_with(worker, {"SOSHO_TEST_HOST_SLOTS": "1"}):
        detail = run_to_end(live_host_api, parent, {"items": list(range(HOST_ITEMS))})
    assert _status(detail) == "succeeded"
    assert dig(detail, "output", "output", "fan", "count") == HOST_ITEMS


def _llm_chain(api: Api, **policy: JsonValue) -> str:
    wid = unique("chain")
    nodes: list[JsonValue] = [trigger(), *[llm(f"l{i}", SHORT) for i in range(3)]]
    edges: list[JsonValue] = [edge("start", "l0"), edge("l0", "l1"), edge("l1", "l2")]
    publish(api, draft(nodes, edges, policy=policy), wid)
    return wid


def test_child_run_inherits_the_remaining_llm_budget(live_api: Api) -> None:
    child = _llm_chain(live_api)
    parent = unique("budget")
    publish(
        live_api,
        draft([trigger(), _sub_node(child)], [edge("start", "inner")], policy={"max_llm_calls": 2}),
        parent,
    )
    with routed() as proxy:
        detail = run_to_end(live_api, parent)
    assert _status(detail) == "failed"
    assert proxy.requests == 2


def test_parent_counts_the_llm_calls_of_its_child_runs(live_api: Api) -> None:
    child = _llm_chain(live_api)
    parent = unique("count")
    publish(live_api, draft([trigger(), _sub_node(child)], [edge("start", "inner")]), parent)
    with routed() as proxy:
        detail = run_to_end(live_api, parent)
    assert _status(detail) == "succeeded"
    assert dig(detail, "output", "llm_calls") == 3
    assert proxy.requests == 3


def _tool_child(api: Api, tool_name: str, **policy: JsonValue) -> str:
    wid = unique("polchild")
    nodes: list[JsonValue] = [trigger(), tool("t", tool_name, value=1)]
    publish(api, draft(nodes, [edge("start", "t")], policy=policy), wid)
    return wid


def test_child_run_cannot_use_a_tool_the_parent_policy_denies(api: Api) -> None:
    child = _tool_child(api, "count", allowed_tools=["count", "echo"])
    parent = unique("poltool")
    publish(
        api,
        draft(
            [trigger(), _sub_node(child)],
            [edge("start", "inner")],
            policy={"allowed_tools": ["echo"]},
        ),
        parent,
    )
    detail = run_to_end(api, parent)
    assert _status(detail) == "failed"
    assert "policy denies tool count" in str(dig(detail, "error"))


def test_child_run_cannot_use_a_node_kind_the_parent_policy_denies(api: Api) -> None:
    child = _tool_child(api, "echo")
    parent = unique("polkind")
    kinds: list[JsonValue] = ["trigger", "subworkflow"]
    publish(
        api,
        draft(
            [trigger(), _sub_node(child)], [edge("start", "inner")], policy={"allowed_kinds": kinds}
        ),
        parent,
    )
    detail = run_to_end(api, parent)
    assert _status(detail) == "failed"
    assert "policy denies tool nodes" in str(dig(detail, "error"))
