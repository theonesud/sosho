import pytest
from engine_support import Api, dig, publish, start
from flows import Spec, draft, edge, tool, unique
from pydantic import JsonValue


def _spec(mode: Spec) -> Spec:
    start_node: Spec = {"id": "start", "kind": "trigger", **mode}
    nodes: list[JsonValue] = [start_node, tool("a", "echo", value=1)]
    return draft(nodes, [edge("start", "a")])


@pytest.mark.parametrize(
    "mode",
    [
        {"mode": "cron", "cron": "0 0 0 1 1 *"},
        {"mode": "webhook"},
        {"mode": "workflow_finished", "source_workflow_id": "other"},
    ],
)
def test_run_route_refuses_a_trigger_that_is_not_manual(api: Api, mode: Spec) -> None:
    wid = unique("modeno")
    publish(api, _spec(mode), wid)
    response = api.post(f"/workflows/{wid}/runs", {})
    assert response.status == 409
    assert str(mode["mode"]) in str(dig(response.body, "error"))
    assert api.get("/runs", workflow_id=wid).body == []


def test_run_route_starts_a_manual_trigger(api: Api) -> None:
    wid = unique("modeok")
    publish(api, _spec({}), wid)
    assert start(api, wid)


def test_webhook_route_refuses_a_manual_trigger(api: Api) -> None:
    wid = unique("hookman")
    publish(api, _spec({}), wid)
    api.post(f"/workflows/{wid}/activate", {})
    response = api.post_as(f"/webhooks/{wid}/start", {}, {"X-Sosho-Token": "x"})
    assert response.status == 404
    assert api.get("/runs", workflow_id=wid).body == []
