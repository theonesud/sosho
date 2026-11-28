import time

import pytest
from engine_support import Api, dig, publish, start, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue

SETTLE_SECONDS = 1.0


def _source(api: Api, ends: str) -> str:
    wid = unique(f"src{ends}")
    node = tool("a", "echo", value=1) if ends == "ok" else tool("a", "flaky", tag=wid, fail_times=9)
    publish(api, draft([trigger(), node], [edge("start", "a")]), wid)
    return wid


def _follower(api: Api, source: str, on_status: str | None) -> str:
    wid = unique("fol")
    extra: Spec = {} if on_status is None else {"on_status": on_status}
    watcher: Spec = {
        "id": "start",
        "kind": "trigger",
        "mode": "workflow_finished",
        "source_workflow_id": source,
        **extra,
    }
    nodes: list[JsonValue] = [watcher, tool("b", "echo", value="{{input.status}}")]
    publish(api, draft(nodes, [edge("start", "b")]), wid)
    return wid


def _runs(api: Api, wid: str) -> list[JsonValue]:
    for _ in range(100):
        runs = api.get("/runs", workflow_id=wid).body
        if isinstance(runs, list) and runs:
            return runs
        time.sleep(0.05)
    return []


@pytest.mark.parametrize(
    ("ends", "on_status", "follows"),
    [
        ("ok", None, True),
        ("ok", "succeeded", True),
        ("ok", "failed", False),
        ("ok", "any", True),
        ("bad", None, False),
        ("bad", "succeeded", False),
        ("bad", "failed", True),
        ("bad", "any", True),
    ],
)
def test_on_status_decides_which_source_runs_start_the_follower(
    api: Api, ends: str, on_status: str | None, follows: bool
) -> None:
    source = _source(api, ends)
    follower = _follower(api, source, on_status)
    run_id = start(api, source)
    wait_terminal(api, run_id)
    if not follows:
        time.sleep(SETTLE_SECONDS)
        assert api.get("/runs", workflow_id=follower).body == []
        return
    runs = _runs(api, follower)
    assert len(runs) == 1
    follow_id = str(dig(runs, 0, "run_id"))
    assert wait_terminal(api, follow_id) == "succeeded"
    seen = dig(api.get(f"/runs/{follow_id}").body, "output", "output", "b", "value")
    assert seen == ("succeeded" if ends == "ok" else "failed")


def test_chained_run_input_holds_the_source_run_id(api: Api) -> None:
    source = _source(api, "ok")
    wid = unique("folid")
    watcher = trigger(mode="workflow_finished", source_workflow_id=source)
    nodes: list[JsonValue] = [watcher, tool("b", "echo", value="{{input.source_run_id}}")]
    publish(api, draft(nodes, [edge("start", "b")]), wid)
    source_run = start(api, source)
    follow_id = str(dig(_runs(api, wid), 0, "run_id"))
    wait_terminal(api, follow_id)
    detail = api.get(f"/runs/{follow_id}").body
    assert dig(detail, "output", "output", "b", "value") == source_run
