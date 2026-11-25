import time

from engine_support import Api, dig, publish, run_to_end, start, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue


def _watcher(source: str) -> Spec:
    return trigger("f", mode="workflow_finished", source_workflow_id=source)


def _follower(source: str, **policy: JsonValue) -> Spec:
    nodes: list[JsonValue] = [
        trigger(),
        _watcher(source),
        tool("t", "echo", value=1),
        tool("u", "echo", value=2),
    ]
    return draft(nodes, [edge("start", "t"), edge("f", "u")], policy=policy)


def _plain(**policy: JsonValue) -> Spec:
    return draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")], policy=policy)


def _activate(api: Api, wid: str) -> int:
    return api.post(f"/workflows/{wid}/activate", {}).status


def _runs(api: Api, wid: str) -> list[JsonValue]:
    runs = api.get("/runs", workflow_id=wid).body
    assert isinstance(runs, list)
    return runs


def _wait_runs(api: Api, wid: str) -> list[JsonValue]:
    runs = _runs(api, wid)
    for _ in range(200):
        if runs:
            break
        time.sleep(0.05)
        runs = _runs(api, wid)
    return runs


def test_a_workflow_cannot_be_triggered_by_its_own_end(api: Api) -> None:
    wid = unique("selfrun")
    api.post("/workflows", {"id": wid, "name": wid})
    response = api.post(f"/workflows/{wid}/versions", _follower(wid))
    assert response.status == 422
    assert dig(response.body, "issues", 0, "code") == "finished_self"


def test_activation_refuses_a_cycle_between_active_workflows(api: Api) -> None:
    first, second = unique("cyca"), unique("cycb")
    publish(api, _follower(second), first)
    publish(api, _follower(first), second)
    assert _activate(api, first) == 200
    refused = api.post(f"/workflows/{second}/activate", {})
    assert refused.status == 409
    assert "cycle" in refused.text
    api.delete(f"/workflows/{first}/activate")


def test_a_chain_stops_when_the_depth_passes_max_depth(api: Api) -> None:
    head, middle, tail = unique("head"), unique("mid"), unique("tail")
    publish(api, _plain(), head)
    publish(api, _follower(head, max_depth=1), middle)
    publish(api, _follower(middle, max_depth=1), tail)
    assert _activate(api, middle) == 200
    assert _activate(api, tail) == 200
    start(api, head)
    second = _wait_runs(api, middle)
    assert len(second) == 1
    assert dig(second, 0, "parent_run_id") is not None
    assert wait_terminal(api, str(dig(second, 0, "run_id"))) == "SUCCESS"
    assert _runs(api, tail) == []
    api.delete(f"/workflows/{middle}/activate")
    api.delete(f"/workflows/{tail}/activate")


def test_child_runs_of_a_map_do_not_fire_finished_triggers(api: Api) -> None:
    source, watcher = unique("kid"), unique("watch")
    child: Spec = draft(
        [trigger(), tool("a", "echo", value="{{input.item}}")], [edge("start", "a")]
    )
    publish(api, child, source)
    publish(api, _follower(source), watcher)
    assert _activate(api, watcher) == 200
    run_to_end(api, source, {"item": 1})
    assert len(_wait_runs(api, watcher)) == 1
    parent = unique("fan")
    fan: Spec = {
        "id": "fan",
        "kind": "map",
        "items": "input.items",
        "workflow_id": source,
        "version": 1,
    }
    publish(api, draft([trigger(), fan], [edge("start", "fan")]), parent)
    assert dig(run_to_end(api, parent, {"items": [1, 2]}), "summary", "status") == "SUCCESS"
    assert len(_runs(api, watcher)) == 1
    api.delete(f"/workflows/{watcher}/activate")
