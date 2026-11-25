import asyncio
import contextvars
from collections.abc import Coroutine, Generator
from contextlib import contextmanager

from dbos import DBOS, SetWorkflowID, SetWorkflowTimeout

ACTIVE_STATUSES = ["PENDING", "ENQUEUED", "DELAYED"]
MIN_TIMEOUT_SECONDS = 0.001


@contextmanager
def run_options(run_id: str, timeout_seconds: float | None) -> Generator[None]:
    with SetWorkflowID(run_id), SetWorkflowTimeout(timeout_seconds):
        yield


def remaining_seconds(deadline_ms: int | None, now_ms: int) -> float | None:
    if deadline_ms is None:
        return None
    return max((deadline_ms - now_ms) / 1000, MIN_TIMEOUT_SECONDS)


def limit_seconds(own: float | None, remaining: float | None) -> float | None:
    limits = [value for value in (own, remaining) if value is not None]
    return min(limits) if limits else None


async def outside_workflow[T](work: Coroutine[None, None, T]) -> T:
    return await asyncio.create_task(work, context=contextvars.Context())


async def cancel_children(run_id: str) -> None:
    children = await outside_workflow(
        DBOS.list_workflows_async(
            parent_workflow_id=run_id,
            status=ACTIVE_STATUSES,
            load_input=False,
            load_output=False,
        )
    )
    for child in children:
        await outside_workflow(DBOS.cancel_workflow_async(child.workflow_id, cancel_children=True))
