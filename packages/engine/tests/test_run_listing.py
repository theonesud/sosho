import sqlite3
from contextlib import closing
from pathlib import Path

from engine_support import Api, dig, publish, start, wait_terminal
from flows import draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine import runtime

NOISE = 520
STATUS_TABLE = "workflow_status"


def _simple() -> dict[str, JsonValue]:
    return draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])


def _clone_runs(db_path: Path, source: str, noise: str) -> None:
    with closing(sqlite3.connect(db_path)) as conn, conn:
        columns = [row[1] for row in conn.execute(f"PRAGMA table_info({STATUS_TABLE})")]
        values = [
            {
                "workflow_uuid": "'n' || n.i || '-' || w.workflow_uuid",
                "created_at": "w.created_at + 1000000 + n.i",
            }.get(column, f"w.{column}")
            for column in columns
        ]
        statement = (
            f"WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {NOISE}) "  # noqa: S608
            f"INSERT INTO {STATUS_TABLE} ({', '.join(columns)}) "
            f"SELECT {', '.join(values)} FROM {STATUS_TABLE} w, n WHERE w.workflow_uuid = ?"
        )
        conn.execute(statement, (source,))
    store = runtime.current().store
    for number in range(1, NOISE + 1):
        store.register_run(f"n{number}-{source}", noise)


def test_workflow_filter_pages_past_the_newest_five_hundred_runs(api: Api, db_path: Path) -> None:
    target, noise = unique("pagea"), unique("pageb")
    publish(api, _simple(), target)
    publish(api, _simple(), noise)
    wanted = [start(api, target) for _ in range(3)]
    for run_id in wanted:
        assert wait_terminal(api, run_id) == "succeeded"
    _clone_runs(db_path, wanted[0], noise)
    newest: list[str] = []
    for offset in ("0", "200", "400"):
        page = api.get("/runs", limit="200", offset=offset).body
        assert isinstance(page, list)
        newest += [str(dig(item, "run_id")) for item in page]
    assert not set(newest[:500]) & set(wanted)
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
    assert wait_terminal(api, run_id) == "succeeded"
    done = api.get("/runs", workflow_id=wid, status="succeeded").body
    other = api.get("/runs", workflow_id=wid, status="failed").body
    assert isinstance(done, list)
    assert [dig(item, "run_id") for item in done] == [run_id]
    assert other == []
