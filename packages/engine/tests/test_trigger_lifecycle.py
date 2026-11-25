from engine_support import Api, dig, publish
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine import runtime


def _cron(expression: str = "0 0 0 1 1 *", zone: str | None = None) -> Spec:
    start_node: Spec = {"id": "start", "kind": "trigger", "mode": "cron", "cron": expression}
    if zone is not None:
        start_node["cron_timezone"] = zone
    nodes: list[JsonValue] = [start_node, tool("a", "echo", value=1)]
    return draft(nodes, [edge("start", "a")])


def _names(api: Api, wid: str) -> list[str]:
    listed = api.get("/schedules").body
    assert isinstance(listed, list)
    return [str(dig(item, "name")) for item in listed if f".{wid}." in str(dig(item, "name"))]


def _activate(api: Api, wid: str) -> int:
    return api.post(f"/workflows/{wid}/activate", {}).status


def test_deleting_a_workflow_removes_its_schedules(api: Api) -> None:
    wid = unique("delsched")
    publish(api, _cron(), wid)
    assert _activate(api, wid) == 200
    assert len(_names(api, wid)) == 1
    assert api.delete(f"/workflows/{wid}").status == 204
    assert _names(api, wid) == []


def test_deleting_an_unknown_workflow_is_not_found(api: Api) -> None:
    assert api.delete("/workflows/nothere").status == 404


def test_a_bad_cron_keeps_the_triggers_of_the_active_version(api: Api) -> None:
    wid = unique("badcron")
    publish(api, _cron(), wid)
    assert _activate(api, wid) == 200
    before = _names(api, wid)
    assert api.post(f"/workflows/{wid}/versions", _cron("99 99 99 99 99 99")).status == 201
    refused = api.post(f"/workflows/{wid}/activate", {"version": 2})
    assert refused.status == 422
    assert _names(api, wid) == before
    assert len(runtime.current().store.list_triggers(wid)) == 1


def test_a_bad_timezone_keeps_the_triggers_of_the_active_version(api: Api) -> None:
    wid = unique("badzone")
    publish(api, _cron(), wid)
    assert _activate(api, wid) == 200
    before = _names(api, wid)
    assert api.post(f"/workflows/{wid}/versions", _cron(zone="Mars/Olympus")).status == 201
    assert api.post(f"/workflows/{wid}/activate", {"version": 2}).status == 422
    assert _names(api, wid) == before


def test_activation_replaces_an_untracked_schedule_of_the_same_name(api: Api) -> None:
    wid = unique("untracked")
    publish(api, _cron(), wid)
    assert _activate(api, wid) == 200
    runtime.current().store.replace_triggers(wid, [])
    assert _activate(api, wid) == 200
    assert len(_names(api, wid)) == 1
    assert len(runtime.current().store.list_triggers(wid)) == 1


def test_activation_removes_the_schedule_of_a_dropped_cron_node(api: Api) -> None:
    wid = unique("dropped")
    publish(api, _cron(), wid)
    assert _activate(api, wid) == 200
    plain: Spec = draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])
    assert api.post(f"/workflows/{wid}/versions", plain).status == 201
    assert _activate(api, wid) == 200
    assert _names(api, wid) == []
