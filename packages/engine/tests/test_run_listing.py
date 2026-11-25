from engine_support import Api, dig, publish, start, wait_terminal
from flows import draft, edge, tool, trigger, unique
from pydantic import JsonValue

NOISE = 520


def _simple() -> dict[str, JsonValue]:
    return draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])


def test_workflow_filter_pages_past_the_newest_five_hundred_runs(api: Api) -> None:
    target, noise = unique("pagea"), unique("pageb")
    publish(api, _simple(), target)
    publish(api, _simple(), noise)
    wanted = [start(api, target) for _ in range(3)]
    last = ""
    for _ in range(NOISE):
        last = start(api, noise)
    assert wait_terminal(api, last, attempts=1200) == "SUCCESS"
    first_page = api.get("/runs", workflow_id=target, limit="2").body
    second_page = api.get("/runs", workflow_id=target, limit="2", offset="2").body
    assert isinstance(first_page, list)
    assert isinstance(second_page, list)
    ids = [str(dig(item, "run_id")) for item in [*first_page, *second_page]]
    assert sorted(ids) == sorted(wanted)
    assert len(first_page) == 2
    assert len(second_page) == 1


def test_status_and_workflow_filters_work_together(api: Api) -> None:
    wid = unique("pagec")
    publish(api, _simple(), wid)
    run_id = start(api, wid)
    assert wait_terminal(api, run_id) == "SUCCESS"
    done = api.get("/runs", workflow_id=wid, status="SUCCESS").body
    other = api.get("/runs", workflow_id=wid, status="ERROR").body
    assert isinstance(done, list)
    assert [dig(item, "run_id") for item in done] == [run_id]
    assert other == []
