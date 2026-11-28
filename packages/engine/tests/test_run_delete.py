from engine_support import Api, dig, publish, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue


def _human_spec() -> Spec:
    human: Spec = {
        "id": "ask",
        "kind": "human",
        "prompt": "Ship?",
        "actions": ["approve", "reject"],
        "wait_seconds": 60.0,
        "default_action": "reject",
    }
    nodes: list[JsonValue] = [trigger(), human, tool("ship", "echo", value=1)]
    edges: list[JsonValue] = [edge("start", "ask"), edge("ask", "ship", "approve")]
    return draft(nodes, edges)


def _approve(api: Api, run_id: str) -> str:
    pending = wait_pending(api, run_id)
    child = str(dig(pending, 0, "run_id"))
    body: Spec = {"node_id": "ask", "reply": {"action": "approve", "value": None}}
    assert api.post(f"/runs/{run_id}/input", body).status == 202
    assert wait_terminal(api, run_id) == "succeeded"
    return child


def _listed(api: Api, run_id: str) -> bool:
    runs = api.get("/runs", limit="200").body
    return isinstance(runs, list) and any(dig(item, "run_id") == run_id for item in runs)


def test_run_delete_removes_run_and_children_and_rejects_unknown(api: Api) -> None:
    wid = unique("rdel")
    publish(api, _human_spec(), wid)
    run_id = start(api, wid)
    child = _approve(api, run_id)
    assert api.get(f"/runs/{child}").status == 200
    assert api.delete(f"/runs/{run_id}").status == 204
    assert api.get(f"/runs/{run_id}").status == 404
    assert api.get(f"/runs/{child}").status == 404
    assert not _listed(api, run_id)
    assert api.get("/runs", workflow_id=wid).body == []
    assert api.delete(f"/runs/{run_id}").status == 404
    assert api.delete("/runs/no-such-run").status == 404


def test_active_run_blocks_run_and_workflow_delete_until_cancelled(api: Api) -> None:
    wid = unique("radel")
    publish(api, _human_spec(), wid)
    run_id = start(api, wid)
    wait_pending(api, run_id)
    assert api.delete(f"/runs/{run_id}").status == 409
    assert api.delete(f"/workflows/{wid}").status == 409
    assert api.get(f"/workflows/{wid}").status == 200
    assert api.post(f"/runs/{run_id}/cancel").status == 202
    assert wait_terminal(api, run_id) == "cancelled"
    assert api.delete(f"/runs/{run_id}").status == 204


def test_workflow_delete_removes_its_runs(api: Api) -> None:
    wid, other = unique("wdel"), unique("wkeep")
    spec = draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])
    publish(api, spec, wid)
    publish(api, spec, other)
    mine = [start(api, wid) for _ in range(2)]
    kept = start(api, other)
    for run_id in [*mine, kept]:
        assert wait_terminal(api, run_id) == "succeeded"
    assert api.delete(f"/workflows/{wid}").status == 204
    for run_id in mine:
        assert api.get(f"/runs/{run_id}").status == 404
        assert not _listed(api, run_id)
    assert api.get(f"/runs/{kept}").status == 200
