import pytest
from engine_support import Api, dig, publish, run_to_end, start
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
def test_run_route_starts_a_trigger_of_any_mode_with_the_run_input(api: Api, mode: Spec) -> None:
    wid = unique("modeany")
    nodes: list[JsonValue] = [
        {"id": "start", "kind": "trigger", **mode},
        tool("a", "echo", value="{{input.x}}"),
    ]
    publish(api, draft(nodes, [edge("start", "a")]), wid)
    detail = run_to_end(api, wid, {"x": "hello"})
    assert dig(detail, "summary", "status") == "succeeded"
    assert dig(detail, "output", "output", "a") == {"value": "hello"}
    runs = api.get("/runs", workflow_id=wid).body
    assert isinstance(runs, list)
    assert len(runs) == 1


def test_run_route_starts_a_named_trigger_and_skips_the_others(api: Api) -> None:
    wid = unique("modenamed")
    nodes: list[JsonValue] = [
        {"id": "start", "kind": "trigger"},
        {"id": "hook", "kind": "trigger", "mode": "webhook"},
        tool("a", "echo", value="{{input.x}}"),
        tool("b", "echo", value=2),
    ]
    publish(api, draft(nodes, [edge("start", "b"), edge("hook", "a")]), wid)
    detail = run_to_end(api, wid, {"x": "hi"}, trigger_node="hook")
    assert dig(detail, "output", "output", "a") == {"value": "hi"}
    assert dig(detail, "output", "nodes", "start") == "skipped"
    assert dig(detail, "output", "nodes", "b") == "skipped"


def test_run_route_starts_a_manual_trigger(api: Api) -> None:
    wid = unique("modeok")
    publish(api, _spec({}), wid)
    assert start(api, wid)


def test_webhook_route_refuses_a_manual_trigger(api: Api) -> None:
    wid = unique("hookman")
    publish(api, _spec({}), wid)
    response = api.post_as(f"/webhooks/{wid}/start", {}, {"X-Sosho-Token": "x"})
    assert response.status == 404
    assert api.get("/runs", workflow_id=wid).body == []
