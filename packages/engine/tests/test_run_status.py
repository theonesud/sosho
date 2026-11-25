import json

import pytest
from engine_support import Api, dig, publish, run_to_end, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine.run_status import dbos_statuses, engine_status


@pytest.mark.parametrize(
    ("raw", "waiting", "expected"),
    [
        ("ENQUEUED", False, "pending"),
        ("DELAYED", False, "pending"),
        ("PENDING", False, "running"),
        ("PENDING", True, "waiting"),
        ("SUCCESS", False, "succeeded"),
        ("ERROR", False, "failed"),
        ("MAX_RECOVERY_ATTEMPTS_EXCEEDED", False, "failed"),
        ("CANCELLED", True, "cancelled"),
    ],
)
def test_engine_status_maps_the_dbos_status(raw: str, waiting: bool, expected: str) -> None:
    assert engine_status(raw, waiting) == expected


def test_each_engine_status_maps_back_to_dbos_statuses() -> None:
    assert dbos_statuses("failed") == ["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]
    assert dbos_statuses("waiting") == dbos_statuses("running") == ["PENDING"]


def _event_types(api: Api, run_id: str) -> list[dict[str, JsonValue]]:
    text = api.get(f"/runs/{run_id}/events").text
    lines = [line[6:] for line in text.splitlines() if line.startswith("data: ")]
    return [item for item in map(json.loads, lines) if isinstance(item, dict) and "type" in item]


def test_detail_and_events_use_the_engine_status_names(api: Api) -> None:
    wid = unique("stok")
    publish(api, draft([trigger(), tool("a", "echo")], [edge("start", "a")]), wid)
    detail = run_to_end(api, wid)
    assert dig(detail, "summary", "status") == "succeeded"
    assert dig(detail, "summary", "dbos_status") == "SUCCESS"
    assert dig(detail, "progress", "status") == "succeeded"
    run_id = str(dig(detail, "summary", "run_id"))
    finished = [item for item in _event_types(api, run_id) if item["type"] == "run_finished"]
    assert finished[0]["status"] == "succeeded"


def test_a_failed_run_reports_failed_everywhere(api: Api) -> None:
    wid = unique("stbad")
    publish(
        api,
        draft([trigger(), tool("a", "flaky", tag=wid, fail_times=9)], [edge("start", "a")]),
        wid,
    )
    detail = run_to_end(api, wid)
    run_id = str(dig(detail, "summary", "run_id"))
    assert dig(detail, "summary", "status") == "failed"
    assert dig(detail, "summary", "dbos_status") == "ERROR"
    finished = [item for item in _event_types(api, run_id) if item["type"] == "run_finished"]
    assert finished[0]["status"] == "failed"
    listed = api.get("/runs", workflow_id=wid, status="failed").body
    assert dig(listed, 0, "run_id") == run_id
    assert api.get("/runs", workflow_id=wid, status="succeeded").body == []


def test_a_run_that_waits_for_a_human_is_waiting_then_cancelled(api: Api) -> None:
    wid = unique("stwait")
    ask: Spec = {"id": "ask", "kind": "human", "prompt": "ok?", "wait_seconds": 60}
    publish(api, draft([trigger(), ask], [edge("start", "ask")]), wid)
    run_id = start(api, wid)
    wait_pending(api, run_id)
    assert dig(api.get(f"/runs/{run_id}").body, "summary", "status") == "waiting"
    waiting = api.get("/runs", workflow_id=wid, status="waiting").body
    assert dig(waiting, 0, "run_id") == run_id
    assert api.get("/runs", workflow_id=wid, status="running").body == []
    assert api.post(f"/runs/{run_id}/cancel").status == 202
    assert wait_terminal(api, run_id) == "cancelled"
    assert dig(api.get(f"/runs/{run_id}").body, "summary", "dbos_status") == "CANCELLED"


def test_run_list_refuses_a_dbos_status_name(api: Api) -> None:
    response = api.get("/runs", status="SUCCESS")
    assert response.status == 400
    assert "succeeded" in str(dig(response.body, "error"))
