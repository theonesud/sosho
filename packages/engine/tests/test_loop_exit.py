import time

import pytest
from engine_support import Api, dig, publish, run_to_end, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine.spec import Edge, Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.validation import validate_workflow

Nodes = list[JsonValue]


def _router_flow(on_limit: str | None, cap: int = 2) -> Spec:
    again: Spec = {"path": "input", "op": "exists"}
    done: Spec = {"path": "nodes.work", "op": "exists"}
    branches: Nodes = [{"name": "again", "when": again}, {"name": "done", "when": done}]
    router: Spec = {"id": "gate", "kind": "router", "branches": branches}
    extra: Spec = {} if on_limit is None else {"on_limit": on_limit}
    nodes: Nodes = [trigger(), tool("work", "count"), router, tool("after", "echo", value="out")]
    edges: Nodes = [
        edge("start", "work"),
        edge("work", "gate"),
        edge("gate", "work", "again", loop=True, max_iterations=cap, **extra),
        edge("gate", "after", "done"),
    ]
    return draft(nodes, edges)


def test_loop_edge_defaults_to_exit_at_the_cap() -> None:
    assert Edge(source="a", target="b").on_limit == "exit"


def test_router_loop_at_the_cap_continues_on_the_other_branch(api: Api) -> None:
    wid = unique("loopexit")
    publish(api, _router_flow(None), wid)
    detail = run_to_end(api, wid, {"go": True})
    assert dig(detail, "summary", "status") == "succeeded"
    assert dig(detail, "output", "output", "after") == {"value": "out"}
    assert dig(detail, "output", "steps") == 7


def test_loop_edge_with_on_limit_fail_still_fails_the_run(api: Api) -> None:
    wid = unique("loopfail")
    publish(api, _router_flow("fail"), wid)
    detail = run_to_end(api, wid, {"go": True})
    assert dig(detail, "summary", "status") == "failed"
    assert "passed 2" in str(dig(detail, "error"))


def test_loop_without_a_branch_at_the_cap_continues_on_the_other_edge(api: Api) -> None:
    wid = unique("loopplain")
    nodes: Nodes = [trigger(), tool("a", "echo", value=1), tool("b", "echo", value=2)]
    nodes.append(tool("c", "echo", value=3))
    edges: Nodes = [
        edge("start", "a"),
        edge("a", "b"),
        edge("b", "a", loop=True, max_iterations=2),
        edge("b", "c"),
    ]
    publish(api, draft(nodes, edges), wid)
    detail = run_to_end(api, wid)
    assert dig(detail, "summary", "status") == "succeeded"
    assert dig(detail, "output", "output") == {"c": {"value": 3}}
    assert dig(detail, "output", "steps") == 7


def test_router_with_no_other_branch_cannot_exit_the_loop() -> None:
    branch: Spec = {"name": "again", "when": {"path": "input.go"}}
    router: Spec = {"id": "gate", "kind": "router", "branches": [branch]}
    nodes: Nodes = [trigger(), tool("work", "echo"), router]
    edges: Nodes = [
        edge("start", "work"),
        edge("work", "gate"),
        edge("gate", "work", "again", loop=True, max_iterations=2),
    ]
    codes = {i.code for i in validate_workflow(_workflow(draft(nodes, edges)))}
    assert "loop_no_exit" in codes
    capped = edge("gate", "work", "again", loop=True, max_iterations=2, on_limit="fail")
    failing: Nodes = [*edges[:2], capped]
    assert "loop_no_exit" not in {
        i.code for i in validate_workflow(_workflow(draft(nodes, failing)))
    }


def _workflow(spec: Spec) -> Workflow:
    return draft_to_workflow(WorkflowDraft.model_validate(spec), "wf", 1)


def _human_loop() -> Spec:
    human: Spec = {
        "id": "ask",
        "kind": "human",
        "prompt": "again?",
        "actions": ["approve", "edit"],
        "default_action": "approve",
        "wait_seconds": 60,
    }
    nodes: Nodes = [trigger(), human, tool("ship", "echo", value="shipped")]
    edges: Nodes = [
        edge("start", "ask"),
        edge("ask", "ship", "approve"),
        edge("ask", "ask", "edit", loop=True, max_iterations=1),
    ]
    return draft(nodes, edges)


def _actions_now(api: Api, run_id: str) -> JsonValue:
    return dig(api.get(f"/runs/{run_id}").body, "pending_human", 0, "actions")


def _wait_actions(api: Api, run_id: str, wanted: list[str]) -> bool:
    for _ in range(200):
        if _actions_now(api, run_id) == wanted:
            return True
        time.sleep(0.05)
    return False


def _reply(api: Api, run_id: str, action: str) -> int:
    body: Spec = {"node_id": "ask", "reply": {"action": action}}
    return api.post(f"/runs/{run_id}/input", body).status


def test_human_loop_at_the_cap_offers_only_the_other_actions(api: Api) -> None:
    wid = unique("humanexit")
    publish(api, _human_loop(), wid)
    run_id = start(api, wid)
    assert dig(wait_pending(api, run_id), 0, "actions") == ["approve", "edit"]
    assert _reply(api, run_id, "edit") == 202
    assert _wait_actions(api, run_id, ["approve"])
    assert _reply(api, run_id, "edit") == 409
    assert _reply(api, run_id, "approve") == 202
    assert wait_terminal(api, run_id) == "succeeded"


def test_edge_refuses_an_unknown_on_limit_value() -> None:
    with pytest.raises(ValueError, match="on_limit"):
        Edge.model_validate({"source": "a", "target": "b", "on_limit": "stop"})
