import asyncio

from dbos import DBOS

from sosho_engine import runtime
from sosho_engine.errors import ConflictError
from sosho_engine.run_status import PENDING, RUNNING, engine_status
from sosho_engine.runs import CHUNK, get_status

ACTIVE = (PENDING, RUNNING)


async def _descendants(run_id: str) -> list[tuple[str, str]]:
    children = await DBOS.list_workflows_async(parent_workflow_id=run_id, load_input=False)
    found: list[tuple[str, str]] = []
    for child in children:
        found.append((child.workflow_id, child.status))
        found.extend(await _descendants(child.workflow_id))
    return found


async def _delete_trees(run_ids: list[str]) -> None:
    tree: list[tuple[str, str]] = []
    for run_id in run_ids:
        tree.append((run_id, (await get_status(run_id)).status))
        tree.extend(await _descendants(run_id))
    active = [name for name, status in tree if engine_status(status) in ACTIVE]
    if active:
        raise ConflictError(
            f"run {active[0]} is not finished, cancel it first ({len(active)} active runs)"
        )
    if run_ids:
        await DBOS.delete_workflows_async(run_ids, delete_children=True)
    store = runtime.current().store
    await asyncio.to_thread(store.forget_runs, [name for name, _ in tree])


async def delete_run(run_id: str) -> None:
    await _delete_trees([run_id])


async def indexed_run_ids(workflow_id: str) -> list[str]:
    store = runtime.current().store
    found: list[str] = []
    while ids := await asyncio.to_thread(store.run_ids, workflow_id, CHUNK, len(found)):
        found.extend(ids)
    return found


async def delete_workflow_runs(run_ids: list[str]) -> None:
    await _delete_trees(run_ids)
