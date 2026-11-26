from engine_support import Api, dig, publish, run_to_end
from fault_proxy import routed
from flows import SHORT, Spec, draft, edge, llm, trigger, unique
from pydantic import JsonValue

PARALLEL = 5


def test_parallel_nodes_cannot_pass_the_llm_budget_together(live_api: Api) -> None:
    wid = unique("wavebud")
    nodes: list[JsonValue] = [trigger()]
    nodes.extend(llm(f"l{index}", SHORT, continue_on_error=True) for index in range(PARALLEL))
    edges: list[JsonValue] = [edge("start", f"l{index}") for index in range(PARALLEL)]
    publish(live_api, draft(nodes, edges, policy={"max_llm_calls": 2}), wid)
    with routed() as proxy:
        detail = run_to_end(live_api, wid)
    assert dig(detail, "summary", "status") == "succeeded"
    assert proxy.requests == 2
    assert dig(detail, "output", "llm_calls") == 2


def test_failed_nodes_and_retries_use_the_llm_budget(live_api: Api) -> None:
    wid = unique("failbud")
    retry: Spec = {"max_attempts": 2, "interval_seconds": 0.0, "backoff_rate": 1.0}
    nodes: list[JsonValue] = [
        trigger(),
        llm("bad", SHORT, retry=retry, continue_on_error=True),
        llm("a", SHORT),
        llm("b", SHORT, continue_on_error=True),
    ]
    edges: list[JsonValue] = [edge("start", "bad"), edge("bad", "a"), edge("a", "b")]
    publish(live_api, draft(nodes, edges, policy={"max_llm_calls": 3}), wid)
    with routed(fail_first=2) as proxy:
        detail = run_to_end(live_api, wid)
    assert dig(detail, "summary", "status") == "succeeded"
    assert proxy.requests == 3
    assert proxy.failed == 2
    assert "budget" in str(dig(detail, "output", "output", "b", "error"))
    assert dig(detail, "output", "llm_calls") == 3


def test_retried_llm_node_counts_every_attempt(live_api: Api) -> None:
    wid = unique("retrybud")
    retry: Spec = {"max_attempts": 3, "interval_seconds": 0.0, "backoff_rate": 1.0}
    nodes: list[JsonValue] = [trigger(), llm("a", SHORT, retry=retry)]
    publish(live_api, draft(nodes, [edge("start", "a")]), wid)
    with routed(fail_first=2) as proxy:
        detail = run_to_end(live_api, wid)
    assert dig(detail, "summary", "status") == "succeeded"
    assert proxy.requests == 3
    assert proxy.failed == 2
    assert str(dig(detail, "output", "output", "a", "text")).strip()
    assert dig(detail, "output", "llm_calls") == 3
