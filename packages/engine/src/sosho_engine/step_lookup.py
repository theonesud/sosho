import re

from sosho_engine.errors import NotFoundError
from sosho_engine.run_models import StepSummary

INLINE_KINDS = ("llm", "tool", "router", "join")
CHILD_SUFFIX = re.compile(r"^\d+(:0)?$")
RESULT_STEP = "DBOS.getResult"


def _matches(run_id: str, node_id: str, step: StepSummary) -> bool:
    if step.name in {f"{kind}:{node_id}" for kind in INLINE_KINDS}:
        return True
    prefix = f"{run_id}:{node_id}:"
    child = step.child_run_id
    return (
        step.name != RESULT_STEP
        and child is not None
        and child.startswith(prefix)
        and bool(CHILD_SUFFIX.match(child[len(prefix) :]))
    )


def locate_step(run_id: str, node_id: str, steps: list[StepSummary], occurrence: int) -> int:
    matches = [step for step in steps if _matches(run_id, node_id, step)]
    if occurrence < 1 or len(matches) < occurrence:
        raise NotFoundError(f"node {node_id} has no execution number {occurrence} in run {run_id}")
    return matches[occurrence - 1].step
