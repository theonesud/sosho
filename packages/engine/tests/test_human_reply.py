import time

from dbos import DBOS
from engine_support import Api, dig, publish, start, wait_pending, wait_terminal
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine.human import HUMAN_TOPIC


def _spec() -> Spec:
    human: Spec = {"id": "ask", "kind": "human", "prompt": "ok?", "actions": ["approve", "reject"]}
    nodes: list[JsonValue] = [trigger(), human, tool("go", "echo", value=1)]
    return draft(nodes, [edge("start", "ask"), edge("ask", "go", "approve")])


def _reply(api: Api, run_id: str, action: str) -> int:
    body: Spec = {"node_id": "ask", "reply": {"action": action}}
    return api.post(f"/runs/{run_id}/input", body).status


def test_second_reply_to_the_same_request_is_refused(api: Api) -> None:
    wid = unique("twice")
    publish(api, _spec(), wid)
    run_id = start(api, wid)
    wait_pending(api, run_id)
    assert _reply(api, run_id, "approve") == 202
    assert _reply(api, run_id, "reject") == 409
    assert wait_terminal(api, run_id) == "SUCCESS"
    assert _reply(api, run_id, "approve") == 409


def test_invalid_action_does_not_end_the_wait(api: Api) -> None:
    wid = unique("badnode")
    publish(api, _spec(), wid)
    run_id = start(api, wid)
    pending = wait_pending(api, run_id)
    child = str(dig(pending, 0, "run_id"))
    DBOS.send(child, {"action": "input", "value": None}, HUMAN_TOPIC)
    time.sleep(1.0)
    detail = api.get(f"/runs/{run_id}").body
    assert dig(detail, "summary", "status") == "PENDING"
    still = dig(detail, "pending_human")
    assert isinstance(still, list)
    assert len(still) == 1
    assert _reply(api, run_id, "approve") == 202
    assert wait_terminal(api, run_id) == "SUCCESS"
