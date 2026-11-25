import time

from engine_support import Api, dig, publish, start, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue

SLOW = 30
SHORT_NAP = 3
LIMIT = 1


def _slow(extra: Spec | None = None, nap_seconds: int = SLOW, limit: int = LIMIT) -> Spec:
    start_node: Spec = {"id": "start", "kind": "trigger", **(extra or {})}
    nap: Spec = {"id": "nap", "kind": "wait", "seconds": nap_seconds}
    nodes: list[JsonValue] = [start_node, nap]
    return draft(nodes, [edge("start", "nap")], policy={"max_run_seconds": limit})


def _first_run(api: Api, wid: str) -> str:
    for _ in range(200):
        runs = api.get("/runs", workflow_id=wid).body
        if isinstance(runs, list) and runs:
            return str(dig(runs, 0, "run_id"))
        time.sleep(0.05)
    return ""


def _stopped(api: Api, run_id: str) -> bool:
    return wait_terminal(api, run_id, attempts=160) == "CANCELLED"


def test_scheduled_run_stops_at_the_run_time_limit(api: Api) -> None:
    wid = unique("tmsched")
    publish(api, _slow({"mode": "cron", "cron": "0 0 0 1 1 *"}), wid)
    name = str(dig(api.post(f"/workflows/{wid}/activate", {}).body, "schedules", 0))
    assert api.post(f"/schedules/{name}/trigger").status == 202
    assert _stopped(api, _first_run(api, wid))
    api.delete(f"/workflows/{wid}/activate")


def test_workflow_finished_run_stops_at_the_run_time_limit(api: Api) -> None:
    source, follower = unique("tmsrc"), unique("tmfol")
    publish(api, draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")]), source)
    publish(api, _slow({"mode": "workflow_finished", "source_workflow_id": source}), follower)
    assert api.post(f"/workflows/{follower}/activate", {}).status == 200
    start(api, source)
    assert _stopped(api, _first_run(api, follower))
    api.delete(f"/workflows/{follower}/activate")


def _parent_of(api: Api, child: str, limit: int) -> str:
    parent = unique("tmpar")
    node: Spec = {"id": "inner", "kind": "subworkflow", "workflow_id": child, "version": 1}
    policy: Spec = {"max_run_seconds": limit}
    publish(api, draft([trigger(), node], [edge("start", "inner")], policy=policy), parent)
    return start(api, parent)


def _status_of(api: Api, wid: str) -> JsonValue:
    return dig(api.get("/runs", workflow_id=wid).body, 0, "status")


def test_child_run_stops_at_its_own_limit_when_the_parent_has_more_time(api: Api) -> None:
    child = unique("tmkid")
    publish(api, _slow(nap_seconds=SHORT_NAP), child)
    run_id = _parent_of(api, child, limit=3600)
    assert wait_terminal(api, run_id, attempts=200) == "ERROR"
    assert _status_of(api, child) == "CANCELLED"


def test_child_run_stops_at_the_parent_deadline_when_its_own_limit_is_larger(api: Api) -> None:
    child = unique("tmlong")
    publish(api, _slow(nap_seconds=SHORT_NAP, limit=3600), child)
    run_id = _parent_of(api, child, limit=LIMIT)
    wait_terminal(api, run_id, attempts=200)
    assert _status_of(api, child) == "CANCELLED"
