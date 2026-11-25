from engine_support import CALLS, Api, dig, publish, run_to_end
from flows import Spec, draft, edge, llm, trigger, unique
from pydantic import JsonValue

PARALLEL = 5


def _prompts(prefix: str, count: int) -> list[str]:
    return [f"{prefix}-{index}" for index in range(count)]


def _calls(prompts: list[str]) -> int:
    return sum(CALLS[f"llm:{text}"] for text in prompts)


def test_parallel_nodes_cannot_pass_the_llm_budget_together(api: Api) -> None:
    wid = unique("wavebud")
    prompts = _prompts(unique("par"), PARALLEL)
    nodes: list[JsonValue] = [trigger()]
    for index, text in enumerate(prompts):
        nodes.append(llm(f"l{index}", text, continue_on_error=True))
    edges: list[JsonValue] = [edge("start", f"l{index}") for index in range(PARALLEL)]
    publish(api, draft(nodes, edges, policy={"max_llm_calls": 2}), wid)
    detail = run_to_end(api, wid)
    assert dig(detail, "summary", "status") == "SUCCESS"
    assert _calls(prompts) == 2
    assert dig(detail, "output", "llm_calls") == 2


def test_failed_nodes_and_retries_use_the_llm_budget(api: Api) -> None:
    wid = unique("failbud")
    flaky = unique("flaky:")
    retry: Spec = {"max_attempts": 2, "interval_seconds": 0.0, "backoff_rate": 1.0}
    nodes: list[JsonValue] = [
        trigger(),
        llm("bad", flaky, retry=retry, continue_on_error=True),
        llm("a", unique("ok-a")),
        llm("b", unique("ok-b"), continue_on_error=True),
    ]
    edges: list[JsonValue] = [edge("start", "bad"), edge("bad", "a"), edge("a", "b")]
    publish(api, draft(nodes, edges, policy={"max_llm_calls": 3}), wid)
    detail = run_to_end(api, wid)
    assert dig(detail, "summary", "status") == "SUCCESS"
    assert CALLS[f"llm:{flaky}"] == 2
    assert "budget" in str(dig(detail, "output", "output", "b", "error"))
    assert dig(detail, "output", "llm_calls") == 3


def test_retried_llm_node_counts_every_attempt(api: Api) -> None:
    wid = unique("retrybud")
    flaky = unique("flaky:")
    retry: Spec = {"max_attempts": 3, "interval_seconds": 0.0, "backoff_rate": 1.0}
    nodes: list[JsonValue] = [trigger(), llm("a", flaky, retry=retry)]
    publish(api, draft(nodes, [edge("start", "a")]), wid)
    detail = run_to_end(api, wid)
    assert dig(detail, "summary", "status") == "SUCCESS"
    assert CALLS[f"llm:{flaky}"] == 3
    assert dig(detail, "output", "llm_calls") == 3
