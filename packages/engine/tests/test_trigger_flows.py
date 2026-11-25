import time

from engine_support import Api, dig, publish, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue


def _runs_of(api: Api, workflow_id: str, attempts: int = 200) -> list[JsonValue]:
    for _ in range(attempts):
        runs = api.get("/runs", workflow_id=workflow_id).body
        if isinstance(runs, list) and runs:
            return runs
        time.sleep(0.05)
    return []


def _cron_spec() -> Spec:
    nodes: list[JsonValue] = [trigger(mode="cron", cron="0 0 0 1 1 *"), tool("a", "echo", value=1)]
    return draft(nodes, [edge("start", "a")])


def _webhook_spec() -> Spec:
    nodes: list[JsonValue] = [trigger(mode="webhook"), tool("a", "echo", value="{{input.msg}}")]
    return draft(nodes, [edge("start", "a")])


def _activate(api: Api, workflow_id: str) -> JsonValue:
    response = api.post(f"/workflows/{workflow_id}/activate", {})
    assert response.status == 200, response.text
    return response.body


def _schedule_names(api: Api) -> dict[str, JsonValue]:
    listed = api.get("/schedules").body
    assert isinstance(listed, list)
    return {str(dig(item, "name")): item for item in listed}


def _hook(token: str) -> dict[str, str]:
    return {"X-Sosho-Token": token}


def test_activation_creates_a_cron_schedule_and_runs_it_on_trigger(api: Api) -> None:
    wid = unique("cron")
    publish(api, _cron_spec(), wid)
    name = str(dig(_activate(api, wid), "schedules", 0))
    listed = _schedule_names(api)[name]
    assert dig(listed, "schedule") == "0 0 0 1 1 *"
    assert dig(listed, "status") == "ACTIVE"
    assert api.post(f"/schedules/{name}/trigger").status == 202
    runs = _runs_of(api, wid)
    assert dig(runs, 0, "workflow_id") == wid
    assert wait_terminal(api, str(dig(runs, 0, "run_id"))) == "succeeded"


def test_schedule_can_pause_resume_and_delete(api: Api) -> None:
    wid = unique("sched")
    publish(api, _cron_spec(), wid)
    name = str(dig(_activate(api, wid), "schedules", 0))
    assert api.post(f"/schedules/{name}/pause").status == 202
    assert dig(_schedule_names(api)[name], "status") == "PAUSED"
    assert api.post(f"/schedules/{name}/resume").status == 202
    assert api.delete(f"/schedules/{name}").status == 204
    assert name not in _schedule_names(api)
    assert api.post(f"/schedules/{name}/pause").status == 404


def test_schedule_routes_need_the_bearer_token(api: Api) -> None:
    assert api.send("POST", "/schedules/wf.x.y/pause", headers={}).status == 401
    assert api.send("DELETE", "/schedules/wf.x.y", headers={}).status == 401


def test_deactivation_removes_the_schedule(api: Api) -> None:
    wid = unique("deact")
    publish(api, _cron_spec(), wid)
    name = str(dig(_activate(api, wid), "schedules", 0))
    assert api.delete(f"/workflows/{wid}/activate").status == 204
    assert name not in _schedule_names(api)


def test_webhook_with_the_right_token_starts_a_run(api: Api) -> None:
    wid = unique("hook")
    publish(api, _webhook_spec(), wid)
    token = str(dig(_activate(api, wid), "webhook_tokens", "start"))
    response = api.post_as(f"/webhooks/{wid}/start", {"msg": "from hook"}, _hook(token))
    assert response.status == 202, response.text
    run_id = str(dig(response.body, "run_id"))
    assert wait_terminal(api, run_id) == "succeeded"
    output = dig(api.get(f"/runs/{run_id}").body, "output", "output")
    assert output == {"a": {"value": "from hook"}}


def test_webhook_rejects_a_wrong_or_missing_token(api: Api) -> None:
    wid = unique("hookbad")
    publish(api, _webhook_spec(), wid)
    _activate(api, wid)
    wrong = api.post_as(f"/webhooks/{wid}/start", {}, _hook("nope"))
    missing = api.post_as(f"/webhooks/{wid}/start", {}, {})
    assert wrong.status == 404
    assert missing.status == 422
    assert api.get("/runs", workflow_id=wid).body == []


def test_webhook_for_an_inactive_workflow_is_not_found(api: Api) -> None:
    wid = unique("hookoff")
    publish(api, _webhook_spec(), wid)
    assert api.post_as(f"/webhooks/{wid}/start", {}, _hook("x")).status == 404


def test_new_activation_replaces_the_old_webhook_token(api: Api) -> None:
    wid = unique("rotate")
    publish(api, _webhook_spec(), wid)
    first = str(dig(_activate(api, wid), "webhook_tokens", "start"))
    second = str(dig(_activate(api, wid), "webhook_tokens", "start"))
    assert first != second
    assert api.post_as(f"/webhooks/{wid}/start", {}, _hook(first)).status == 404


def test_workflow_finished_trigger_starts_a_follow_up_run(api: Api) -> None:
    source = unique("src")
    follower = unique("fol")
    source_nodes: list[JsonValue] = [trigger(), tool("a", "echo", value="done")]
    publish(api, draft(source_nodes, [edge("start", "a")]), source)
    watcher = trigger(mode="workflow_finished", source_workflow_id=source)
    nodes: list[JsonValue] = [watcher, tool("b", "echo", value="{{input.status}}")]
    publish(api, draft(nodes, [edge("start", "b")]), follower)
    _activate(api, follower)
    source_run = dig(api.post(f"/workflows/{source}/runs", {}).body, "run_id")
    runs = _runs_of(api, follower)
    follow_id = str(dig(runs, 0, "run_id"))
    assert wait_terminal(api, follow_id) == "succeeded"
    detail = api.get(f"/runs/{follow_id}").body
    assert dig(detail, "output", "output") == {"b": {"value": "succeeded"}}
    assert dig(detail, "summary", "parent_run_id") == source_run
