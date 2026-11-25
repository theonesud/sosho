from engine_support import Api, dig, publish, run_to_end, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue


def _approval_spec(wait_seconds: float = 60.0) -> Spec:
    human: Spec = {
        "id": "ask",
        "kind": "human",
        "prompt": "Ship {{input.what}}?",
        "actions": ["approve", "reject", "edit"],
        "wait_seconds": wait_seconds,
        "default_action": "reject",
    }
    nodes: list[JsonValue] = [
        trigger(),
        human,
        tool("ship", "echo", value="shipped"),
        tool("stop", "echo", value="stopped"),
    ]
    edges: list[JsonValue] = [
        edge("start", "ask"),
        edge("ask", "ship", "approve"),
        edge("ask", "stop", "reject"),
    ]
    return draft(nodes, edges)


def _answer(api: Api, run_id: str, action: str, value: JsonValue = None) -> int:
    body: Spec = {"node_id": "ask", "reply": {"action": action, "value": value}}
    return api.post(f"/runs/{run_id}/input", body).status


def _output(api: Api, run_id: str) -> JsonValue:
    return dig(api.get(f"/runs/{run_id}").body, "output")


def test_human_node_waits_then_approve_continues(api: Api) -> None:
    wid = unique("approve")
    publish(api, _approval_spec(), wid)
    run_id = start(api, wid, {"what": "release"})
    pending = wait_pending(api, run_id)
    assert dig(pending, 0, "prompt") == "Ship release?"
    assert dig(pending, 0, "actions") == ["approve", "reject", "edit"]
    assert _answer(api, run_id, "approve") == 202
    assert wait_terminal(api, run_id) == "SUCCESS"
    expected = {"start": "done", "ask": "done", "ship": "done", "stop": "skipped"}
    assert dig(_output(api, run_id), "nodes") == expected


def test_human_reject_takes_the_reject_branch(api: Api) -> None:
    wid = unique("reject")
    publish(api, _approval_spec(), wid)
    run_id = start(api, wid, {"what": "x"})
    wait_pending(api, run_id)
    assert _answer(api, run_id, "reject") == 202
    assert wait_terminal(api, run_id) == "SUCCESS"
    assert dig(_output(api, run_id), "output") == {"stop": {"value": "stopped"}}


def test_human_timeout_uses_the_default_action(api: Api) -> None:
    wid = unique("timeout")
    publish(api, _approval_spec(wait_seconds=0.3), wid)
    detail = run_to_end(api, wid, {"what": "x"})
    assert dig(detail, "summary", "status") == "SUCCESS"
    assert dig(detail, "output", "output") == {"stop": {"value": "stopped"}}


def test_input_with_a_disallowed_action_is_refused(api: Api) -> None:
    wid = unique("badact")
    publish(api, _approval_spec(), wid)
    run_id = start(api, wid, {"what": "x"})
    wait_pending(api, run_id)
    assert _answer(api, run_id, "input") == 409
    assert _answer(api, run_id, "reject") == 202
    assert wait_terminal(api, run_id) == "SUCCESS"


def test_input_to_a_finished_run_is_refused(api: Api) -> None:
    wid = unique("late")
    publish(api, _approval_spec(wait_seconds=0.2), wid)
    run_id = str(dig(run_to_end(api, wid, {"what": "x"}), "summary", "run_id"))
    assert _answer(api, run_id, "approve") == 409


def test_cancel_stops_a_waiting_run_and_its_child(api: Api) -> None:
    wid = unique("cancel")
    publish(api, _approval_spec(), wid)
    run_id = start(api, wid, {"what": "x"})
    pending = wait_pending(api, run_id)
    assert api.post(f"/runs/{run_id}/cancel").status == 202
    assert wait_terminal(api, run_id) == "CANCELLED"
    child = api.get(f"/runs/{dig(pending, 0, 'run_id')}")
    assert dig(child.body, "summary", "status") == "CANCELLED"


def test_resume_restarts_a_cancelled_run_and_it_finishes(api: Api) -> None:
    wid = unique("resume")
    publish(api, _approval_spec(), wid)
    run_id = start(api, wid, {"what": "x"})
    wait_pending(api, run_id)
    api.post(f"/runs/{run_id}/cancel")
    assert wait_terminal(api, run_id) == "CANCELLED"
    assert api.post(f"/runs/{run_id}/resume").status == 202
    wait_pending(api, run_id)
    assert _answer(api, run_id, "approve") == 202
    assert wait_terminal(api, run_id) == "SUCCESS"


def test_fork_from_a_node_replays_earlier_nodes_only(api: Api) -> None:
    wid = unique("fork")
    nodes: list[JsonValue] = [
        trigger(),
        tool("one", "count"),
        tool("two", "count"),
        tool("three", "count"),
    ]
    edges: list[JsonValue] = [edge("start", "one"), edge("one", "two"), edge("two", "three")]
    publish(api, draft(nodes, edges), wid)
    original = run_to_end(api, wid)
    first = int(str(dig(original, "output", "output", "three", "calls")))
    run_id = str(dig(original, "summary", "run_id"))
    forked = api.post(f"/runs/{run_id}/fork", {"node_id": "two"})
    assert forked.status == 202, forked.text
    fork_id = str(dig(forked.body, "run_id"))
    assert wait_terminal(api, fork_id) == "SUCCESS"
    result = api.get(f"/runs/{fork_id}").body
    assert dig(result, "summary", "forked_from") == run_id
    assert dig(result, "output", "output", "three", "calls") == first + 2
    assert dig(result, "summary", "app_version") == "test"


def test_fork_from_an_unknown_node_is_not_found(api: Api) -> None:
    wid = unique("forkbad")
    publish(api, draft([trigger(), tool("one", "count")], [edge("start", "one")]), wid)
    run_id = str(dig(run_to_end(api, wid), "summary", "run_id"))
    assert api.post(f"/runs/{run_id}/fork", {"node_id": "nope"}).status == 404
