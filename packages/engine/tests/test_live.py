import pytest
from engine_support import Api, dig, publish
from fastapi.testclient import TestClient
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine import runtime, triggers
from sosho_engine.reconcile import reconcile_triggers
from sosho_engine.spec import WorkflowDraft
from sosho_engine.store_tables import TriggerRow


def _spec(cron: str = "0 0 0 1 1 *", zone: str | None = None) -> Spec:
    start: Spec = trigger(mode="cron", cron=cron)
    if zone:
        start["cron_timezone"] = zone
    nodes: list[JsonValue] = [
        start,
        trigger("hook", mode="webhook"),
        tool("a", "echo", value=1),
        tool("b", "echo", value=2),
    ]
    return draft(nodes, [edge("start", "a"), edge("hook", "b")])


def _plain() -> Spec:
    return draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])


def _state(api: Api, wid: str) -> JsonValue:
    response = api.get(f"/workflows/{wid}/triggers")
    assert response.status == 200, response.text
    return response.body


def _token(api: Api, wid: str) -> str:
    return str(dig(_state(api, wid), "webhooks", 0, "token"))


def _call(api: Api, wid: str, token: str) -> int:
    return api.post_as(f"/webhooks/{wid}/hook", {}, {"X-Sosho-Token": token}).status


def _schedules(api: Api, wid: str) -> list[str]:
    listed = api.get("/schedules").body
    assert isinstance(listed, list)
    return [str(dig(i, "name")) for i in listed if f".{wid}." in str(dig(i, "name"))]


def _reconcile(client: TestClient) -> None:
    assert client.portal is not None
    client.portal.call(reconcile_triggers)


def test_save_binds_a_cron_schedule_and_a_webhook(api: Api) -> None:
    wid = unique("bind")
    publish(api, _spec(), wid)
    state = _state(api, wid)
    assert dig(state, "version") == 1
    assert dig(state, "schedules", 0, "cron") == "0 0 0 1 1 *"
    assert dig(state, "schedules", 0, "next_fire") is not None
    assert dig(state, "webhooks", 0, "node_id") == "hook"
    assert str(dig(state, "webhooks", 0, "url")).endswith(f"/webhooks/{wid}/hook")
    assert dig(state, "followers") == []
    assert len(_schedules(api, wid)) == 1
    assert _call(api, wid, _token(api, wid)) == 202


def test_save_response_has_no_live_error(api: Api) -> None:
    wid = unique("noerr")
    assert api.post("/workflows", {"id": wid, "name": wid}).status == 201
    saved = api.post(f"/workflows/{wid}/versions", _spec())
    assert saved.status == 201
    assert isinstance(saved.body, dict)
    assert "live_error" not in saved.body


def test_second_save_rebinds_and_keeps_the_token(api: Api) -> None:
    wid = unique("resave")
    publish(api, _spec(), wid)
    token = _token(api, wid)
    assert api.post(f"/workflows/{wid}/versions", _spec("0 0 1 1 1 *")).status == 201
    state = _state(api, wid)
    assert (dig(state, "version"), dig(state, "schedules", 0, "cron")) == (2, "0 0 1 1 1 *")
    assert _token(api, wid) == token
    assert _call(api, wid, token) == 202
    assert len(_schedules(api, wid)) == 1


def test_save_that_removes_the_triggers_unbinds(api: Api) -> None:
    wid = unique("unbind")
    publish(api, _spec(), wid)
    token = _token(api, wid)
    assert api.post(f"/workflows/{wid}/versions", _plain()).status == 201
    state = _state(api, wid)
    assert (dig(state, "schedules"), dig(state, "webhooks")) == ([], [])
    assert _schedules(api, wid) == []
    assert _call(api, wid, token) == 404
    assert runtime.current().store.get_tokens(wid) == {}
    assert runtime.current().store.list_triggers(wid) == []


@pytest.mark.parametrize(
    ("cron", "zone", "code"),
    [
        ("99 99 99 99 99 99", None, "bad_cron"),
        ("0 0 0 1 1 *", "Mars/Olympus", "bad_timezone"),
    ],
)
def test_bad_cron_or_zone_on_save_returns_422_and_stores_nothing(
    api: Api, cron: str, zone: str | None, code: str
) -> None:
    wid = unique("badsave")
    assert api.post("/workflows", {"id": wid, "name": wid}).status == 201
    refused = api.post(f"/workflows/{wid}/versions", _spec(cron, zone))
    assert refused.status == 422
    assert dig(refused.body, "issues", 0, "code") == code
    assert dig(refused.body, "issues", 0, "node") == "start"
    assert api.get(f"/workflows/{wid}/versions").body == []
    assert _schedules(api, wid) == []


def test_failed_bind_rolls_the_saved_version_back(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    wid = unique("rollback")
    publish(api, _spec(), wid)
    original = triggers.bind_latest
    calls: list[str] = []

    async def failing_once(workflow_id: str) -> None:
        calls.append(workflow_id)
        if len(calls) == 1:
            raise RuntimeError("dbos down")
        await original(workflow_id)

    monkeypatch.setattr(triggers, "bind_latest", failing_once)
    with pytest.raises(RuntimeError, match="dbos down"):
        api.post(f"/workflows/{wid}/versions", _spec("0 0 1 1 1 *"))
    monkeypatch.undo()
    assert dig(api.get(f"/workflows/{wid}").body, "latest_version") == 1
    assert dig(_state(api, wid), "schedules", 0, "cron") == "0 0 0 1 1 *"
    assert len(_schedules(api, wid)) == 1


def test_startup_reconcile_binds_unbound_and_removes_stale_bindings(
    api: Api, client: TestClient
) -> None:
    unbound, stale, ghost = unique("recun"), unique("recstale"), unique("recghost")
    publish(api, _spec(), unbound)
    publish(api, _spec(), stale)
    assert client.portal is not None
    client.portal.call(triggers.unbind, unbound)
    store = runtime.current().store
    store.add_version(stale, WorkflowDraft.model_validate(_plain()))
    store.replace_triggers(
        ghost, [TriggerRow(workflow_id=ghost, node_id="x", version=1, mode="webhook", ref=None)]
    )
    assert _schedules(api, unbound) == []
    _reconcile(client)
    assert len(_schedules(api, unbound)) == 1
    assert dig(_state(api, unbound), "webhooks", 0, "token")
    assert _schedules(api, stale) == []
    assert (store.list_triggers(stale), store.get_tokens(stale)) == ([], {})
    assert store.list_triggers(ghost) == []
    token, names = _token(api, unbound), _schedules(api, unbound)
    _reconcile(client)
    assert (_token(api, unbound), _schedules(api, unbound)) == (token, names)


def test_triggers_route_lists_followers_and_manual_only_is_empty(api: Api) -> None:
    source, follower, plain = unique("tsrc"), unique("tfol"), unique("tplain")
    publish(api, _plain(), source)
    watcher = trigger(mode="workflow_finished", source_workflow_id=source, on_status="any")
    publish(api, draft([watcher, tool("b", "echo", value=1)], [edge("start", "b")]), follower)
    state = _state(api, follower)
    assert dig(state, "followers", 0) == {"source_workflow_id": source, "on_status": "any"}
    api.post("/workflows", {"id": plain, "name": plain})
    assert dig(_state(api, plain), "version") is None
    assert api.get("/workflows/nothere/triggers").status == 404


def test_old_live_routes_are_gone(api: Api) -> None:
    wid = unique("nolive")
    publish(api, _plain(), wid)
    assert api.get(f"/workflows/{wid}/live").status == 404
    assert api.put(f"/workflows/{wid}/live", {"live": True}).status in (404, 405)


def test_regenerate_invalidates_the_old_token(api: Api) -> None:
    wid = unique("regen")
    publish(api, _spec(), wid)
    old = _token(api, wid)
    fresh = api.post(f"/workflows/{wid}/webhooks/hook/token")
    assert fresh.status == 200
    new = str(dig(fresh.body, "token"))
    assert new != old
    assert _token(api, wid) == new
    assert (_call(api, wid, old), _call(api, wid, new)) == (404, 202)


def test_deleting_a_workflow_unbinds_it(api: Api) -> None:
    wid = unique("dellive")
    publish(api, _spec(), wid)
    assert api.delete(f"/workflows/{wid}").status == 204
    assert _schedules(api, wid) == []
    assert runtime.current().store.get_tokens(wid) == {}
    assert runtime.current().store.list_triggers(wid) == []
