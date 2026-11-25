import time

from engine_support import Api, dig, publish, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue

PATIENCE = 8.0


def _failing() -> Spec:
    return tool("bad", "flaky", tag=unique("ff"), fail_times=9)


def _children(api: Api, run_id: str) -> list[JsonValue]:
    runs = api.get("/runs").body
    assert isinstance(runs, list)
    return [item for item in runs if dig(item, "parent_run_id") == run_id]


def _settle(api: Api, run_id: str) -> str:
    deadline = time.monotonic() + PATIENCE
    status = ""
    while time.monotonic() < deadline:
        status = wait_terminal(api, run_id, attempts=1)
        if status == "ERROR":
            break
        time.sleep(0.05)
    return status


def test_failed_node_fails_the_run_without_waiting_for_a_human(api: Api) -> None:
    wid = unique("ffhuman")
    human: Spec = {"id": "ask", "kind": "human", "prompt": "ok?", "wait_seconds": 3600}
    nodes: list[JsonValue] = [trigger(), human, _failing()]
    publish(api, draft(nodes, [edge("start", "ask"), edge("start", "bad")]), wid)
    run_id = start(api, wid)
    assert _settle(api, run_id) == "ERROR"
    detail = api.get(f"/runs/{run_id}").body
    assert "node bad failed" in str(dig(detail, "error"))
    assert wait_pending(api, run_id, attempts=1) == []
    statuses = {str(dig(child, "status")) for child in _children(api, run_id)}
    assert statuses <= {"CANCELLED"}


def test_failed_node_cancels_sibling_child_runs_of_a_map(api: Api) -> None:
    child = unique("ffkid")
    sleepy: Spec = {"id": "nap", "kind": "wait", "seconds": 30}
    publish(api, draft([trigger(), sleepy], [edge("start", "nap")]), child)
    wid = unique("ffmap")
    fan: Spec = {
        "id": "fan",
        "kind": "map",
        "items": "input.items",
        "workflow_id": child,
        "version": 1,
    }
    nodes: list[JsonValue] = [trigger(), fan, _failing()]
    publish(api, draft(nodes, [edge("start", "fan"), edge("start", "bad")]), wid)
    run_id = start(api, wid, {"items": [1, 2]})
    assert _settle(api, run_id) == "ERROR"
    found = _children(api, run_id)
    deadline = time.monotonic() + PATIENCE
    while time.monotonic() < deadline:
        found = _children(api, run_id)
        if found and all(dig(item, "status") == "CANCELLED" for item in found):
            break
        time.sleep(0.1)
    assert found
    assert all(dig(item, "status") == "CANCELLED" for item in found)
