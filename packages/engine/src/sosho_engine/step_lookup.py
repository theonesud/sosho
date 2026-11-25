import re

from sosho_engine.errors import NotFoundError
from sosho_engine.run_models import StepSummary

INLINE_KINDS = ("llm", "tool", "router", "join")
CHILD_SUFFIX = re.compile(r"^\d+(?::(\d+))?$")
RESULT_STEP = "DBOS.getResult"


def _child_item(run_id: str, node_id: str, step: StepSummary) -> int | None:
    prefix = f"{run_id}:{node_id}:"
    child = step.child_run_id
    if step.name == RESULT_STEP or child is None or not child.startswith(prefix):
        return None
    match = CHILD_SUFFIX.match(child[len(prefix) :])
    if match is None:
        return None
    return int(match.group(1) or 0)


def _matches(run_id: str, node_id: str, step: StepSummary, item: int | None) -> bool:
    if step.name in {f"{kind}:{node_id}" for kind in INLINE_KINDS}:
        return item is None
    return _child_item(run_id, node_id, step) == (item or 0)


def locate_step(
    run_id: str, node_id: str, steps: list[StepSummary], occurrence: int, item: int | None = None
) -> int:
    matches = [step for step in steps if _matches(run_id, node_id, step, item)]
    if occurrence < 1 or len(matches) < occurrence:
        raise NotFoundError(f"node {node_id} has no execution number {occurrence} in run {run_id}")
    return matches[occurrence - 1].step
