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


def test_deleting_a_workflow_removes_its_schedules(api: Api) -> None:
    wid = unique("delsched")
    publish(api, _cron(), wid)
    assert len(_names(api, wid)) == 1
    assert api.delete(f"/workflows/{wid}").status == 204
    assert _names(api, wid) == []


def test_deleting_an_unknown_workflow_is_not_found(api: Api) -> None:
    assert api.delete("/workflows/nothere").status == 404


def test_a_bad_cron_save_keeps_the_triggers_of_the_bound_version(api: Api) -> None:
    wid = unique("badcron")
    publish(api, _cron(), wid)
    before = _names(api, wid)
    refused = api.post(f"/workflows/{wid}/versions", _cron("99 99 99 99 99 99"))
    assert refused.status == 422
    assert _names(api, wid) == before
    assert [r.version for r in runtime.current().store.list_triggers(wid)] == [1]


def test_a_bad_timezone_save_keeps_the_triggers_of_the_bound_version(api: Api) -> None:
    wid = unique("badzone")
    publish(api, _cron(), wid)
    before = _names(api, wid)
    assert api.post(f"/workflows/{wid}/versions", _cron(zone="Mars/Olympus")).status == 422
    assert _names(api, wid) == before


def test_a_save_replaces_an_untracked_schedule_of_the_same_name(api: Api) -> None:
    wid = unique("untracked")
    publish(api, _cron(), wid)
    runtime.current().store.replace_triggers(wid, [])
    assert api.post(f"/workflows/{wid}/versions", _cron()).status == 201
    assert len(_names(api, wid)) == 1
    assert len(runtime.current().store.list_triggers(wid)) == 1


def test_a_save_removes_the_schedule_of_a_dropped_cron_node(api: Api) -> None:
    wid = unique("dropped")
    publish(api, _cron(), wid)
    plain: Spec = draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])
    assert api.post(f"/workflows/{wid}/versions", plain).status == 201
    assert _names(api, wid) == []
    assert runtime.current().store.list_triggers(wid) == []


def test_save_refuses_a_bad_cron_text_or_time_zone(api: Api) -> None:
    wid = unique("savecron")
    assert api.post("/workflows", {"id": wid, "name": wid}).status == 201
    bad_text = api.post(f"/workflows/{wid}/versions", _cron("99 99 99 99 99 99"))
    bad_zone = api.post(f"/workflows/{wid}/versions", _cron(zone="Mars/Olympus"))
    assert (bad_text.status, dig(bad_text.body, "issues", 0, "code")) == (422, "bad_cron")
    assert (bad_zone.status, dig(bad_zone.body, "issues", 0, "code")) == (422, "bad_timezone")
    assert api.post(f"/workflows/{wid}/versions", _cron(zone="Europe/Paris")).status == 201


def test_validate_route_reports_a_bad_cron_text(api: Api) -> None:
    response = api.post("/validate", {"draft": _cron("99 99 99 99 99 99")})
    assert response.status == 200
    assert dig(response.body, "valid") is False
    assert dig(response.body, "issues", 0, "code") == "bad_cron"
