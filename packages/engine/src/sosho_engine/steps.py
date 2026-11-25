from dbos import DBOS, StepOptions
from pydantic import JsonValue

from sosho_engine.executors import execute_inline
from sosho_engine.jobs import NodeJob
from sosho_engine.spec_nodes import NodeBase


def step_options(node: NodeBase, name: str) -> StepOptions:
    options = StepOptions(name=name)
    retry = node.retry
    if retry.max_attempts > 1:
        options["retries_allowed"] = True
        options["max_attempts"] = retry.max_attempts
        options["interval_seconds"] = retry.interval_seconds
        options["backoff_rate"] = retry.backoff_rate
    if node.timeout_seconds is not None:
        options["timeout_seconds"] = node.timeout_seconds
    return options


async def inline_body(job: dict[str, JsonValue]) -> dict[str, JsonValue]:
    result = await execute_inline(NodeJob.model_validate(job))
    return result.model_dump(mode="json")


async def run_inline_step(job: NodeJob) -> dict[str, JsonValue]:
    options = step_options(job.node, f"{job.node.kind}:{job.node.id}")
    payload = job.model_dump(mode="json")
    return await DBOS.run_step_async(options, inline_body, payload)
