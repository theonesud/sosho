import asyncio
import uuid
from collections.abc import AsyncIterator

from dbos import DBOS, WorkflowStatus
from pydantic import JsonValue, TypeAdapter, ValidationError

from sosho_engine import runtime
from sosho_engine.errors import BadRequestError, ConflictError, NotFoundError
from sosho_engine.events import LOG_STREAM, PROGRESS_EVENT
from sosho_engine.human import HUMAN_TOPIC, PENDING_EVENT, HumanReply, PendingEvent, ProgressView
from sosho_engine.jobs import RunParams
from sosho_engine.launch import run_options
from sosho_engine.run_models import PendingHuman, RunDetail, RunSummary, StepSummary
from sosho_engine.run_status import RUNNING, STATUS_NAMES, WAITING, dbos_statuses, engine_status
from sosho_engine.runflow import run_workflow
from sosho_engine.spec_nodes import TriggerNode
from sosho_engine.step_lookup import locate_step

RUN_WORKFLOW_NAME = run_workflow.__qualname__
CHUNK = 200
JSON_ADAPTER: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


def _json_or_repr(value: object) -> JsonValue:
    try:
        return JSON_ADAPTER.validate_python(value)
    except ValidationError:
        return repr(value)[:200]


def _params(status: WorkflowStatus) -> RunParams | None:
    if status.input is None or not status.input["args"]:
        return None
    first = status.input["args"][0]
    if not isinstance(first, dict) or "workflow_id" not in first:
        return None
    return RunParams.model_validate(first)


def summarize(status: WorkflowStatus, waiting: bool = False) -> RunSummary:
    params = _params(status)
    return RunSummary(
        run_id=status.workflow_id,
        status=engine_status(status.status, waiting),
        dbos_status=status.status,
        workflow_id=params.workflow_id if params else None,
        version=params.version if params else None,
        created_at=status.created_at,
        updated_at=status.updated_at,
        app_version=status.app_version,
        forked_from=status.forked_from,
        parent_run_id=params.parent_run_id if params else None,
    )


async def start_run(params: RunParams, mode: str) -> str:
    store = runtime.current().store
    spec = await asyncio.to_thread(store.get_version, params.workflow_id, params.version)
    trigger = spec.node_map().get(params.trigger_node or spec.entry)
    if not isinstance(trigger, TriggerNode):
        raise NotFoundError(f"trigger node {params.trigger_node} not found")
    if trigger.mode != mode:
        raise ConflictError(
            f"trigger node {trigger.id} has mode {trigger.mode} but this route needs {mode}"
        )
    pinned = params.model_copy(update={"version": spec.version})
    run_id = uuid.uuid4().hex
    await asyncio.to_thread(store.register_run, run_id, params.workflow_id)
    with run_options(run_id, spec.policy.max_run_seconds):
        await DBOS.start_workflow_async(run_workflow, pinned.model_dump(mode="json"))
    return run_id


async def _indexed_runs(
    workflow_id: str, statuses: list[str] | None, need: int | None
) -> list[WorkflowStatus]:
    store = runtime.current().store
    matches: list[WorkflowStatus] = []
    cursor = 0
    while need is None or len(matches) < need:
        ids = await asyncio.to_thread(store.run_ids, workflow_id, CHUNK, cursor)
        if not ids:
            break
        cursor += len(ids)
        matches.extend(
            await DBOS.list_workflows_async(
                workflow_ids=ids, name=RUN_WORKFLOW_NAME, status=statuses, sort_desc=True
            )
        )
    return matches


async def _is_waiting(status: WorkflowStatus) -> bool:
    if engine_status(status.status) != RUNNING:
        return False
    progress = await DBOS.get_event_async(status.workflow_id, PROGRESS_EVENT, timeout_seconds=0)
    return bool(await _pending_humans(_json_or_repr(progress)))


async def _found_runs(
    status: str | None, workflow_id: str | None, limit: int, offset: int
) -> list[WorkflowStatus]:
    statuses = dbos_statuses(status) if status is not None else None
    needs_all = status in (RUNNING, WAITING)
    if workflow_id is not None:
        return await _indexed_runs(workflow_id, statuses, None if needs_all else offset + limit)
    if needs_all:
        return await DBOS.list_workflows_async(
            name=RUN_WORKFLOW_NAME, status=statuses, sort_desc=True
        )
    return await DBOS.list_workflows_async(
        name=RUN_WORKFLOW_NAME, status=statuses, sort_desc=True, limit=limit, offset=offset
    )


async def list_runs(
    status: str | None, workflow_id: str | None, limit: int, offset: int
) -> list[RunSummary]:
    if status is not None and status not in STATUS_NAMES:
        raise BadRequestError(f"status {status} is unknown, use one of {', '.join(STATUS_NAMES)}")
    found = await _found_runs(status, workflow_id, limit, offset)
    summaries = [summarize(item, await _is_waiting(item)) for item in found]
    if status in (RUNNING, WAITING):
        summaries = [item for item in summaries if item.status == status]
    if workflow_id is not None or status in (RUNNING, WAITING):
        return summaries[offset : offset + limit]
    return summaries


async def get_status(run_id: str) -> WorkflowStatus:
    status = await DBOS.get_workflow_status_async(run_id)
    if status is None:
        raise NotFoundError(f"run {run_id} not found")
    return status


async def list_steps(run_id: str) -> list[StepSummary]:
    await get_status(run_id)
    steps = await DBOS.list_workflow_steps_async(run_id)
    return [
        StepSummary(
            step=item["function_id"],
            name=item["function_name"],
            child_run_id=item.get("child_workflow_id"),
            error=str(item["error"]) if item.get("error") else None,
            started_at=item.get("started_at_epoch_ms"),
            completed_at=item.get("completed_at_epoch_ms"),
            output=_json_or_repr(item.get("output")),
        )
        for item in steps
    ]


async def _pending_humans(progress: JsonValue) -> list[PendingHuman]:
    waiting = ProgressView.model_validate(progress).waiting if isinstance(progress, dict) else {}
    result: list[PendingHuman] = []
    for child in waiting.values():
        event = await DBOS.get_event_async(child, PENDING_EVENT, timeout_seconds=0)
        if event is not None:
            pending = PendingEvent.model_validate(event)
            result.append(PendingHuman(run_id=child, **pending.model_dump()))
    return result


async def run_detail(run_id: str) -> RunDetail:
    status = await get_status(run_id)
    progress = await DBOS.get_event_async(run_id, PROGRESS_EVENT, timeout_seconds=0)
    pending = await _pending_humans(_json_or_repr(progress))
    return RunDetail(
        summary=summarize(status, bool(pending) and engine_status(status.status) == RUNNING),
        output=_json_or_repr(status.output),
        error=str(status.error) if status.error else None,
        progress=_json_or_repr(progress),
        pending_human=pending,
        steps=await list_steps(run_id),
    )


async def stream_events(run_id: str, offset: int) -> AsyncIterator[JsonValue]:
    await get_status(run_id)
    async for item in DBOS.read_stream_async(run_id, LOG_STREAM, offset=offset):
        yield _json_or_repr(item)


async def send_input(run_id: str, node_id: str, reply: HumanReply) -> None:
    detail = await run_detail(run_id)
    match = [item for item in detail.pending_human if item.node_id == node_id]
    if not match:
        raise ConflictError(f"node {node_id} of run {run_id} does not wait for input")
    if reply.action not in match[0].actions:
        raise ConflictError(f"action {reply.action} is not allowed")
    child = match[0].run_id
    store = runtime.current().store
    if not await asyncio.to_thread(store.claim_reply, child):
        raise ConflictError(f"node {node_id} of run {run_id} has a reply already")
    try:
        await DBOS.send_async(child, reply.model_dump(mode="json"), HUMAN_TOPIC)
    except Exception:
        await asyncio.to_thread(store.release_reply, child)
        raise


async def cancel_run(run_id: str) -> None:
    await get_status(run_id)
    await DBOS.cancel_workflow_async(run_id, cancel_children=True)


async def _cancelled_descendants(run_id: str) -> list[str]:
    children = await DBOS.list_workflows_async(parent_workflow_id=run_id, load_input=False)
    found: list[str] = []
    for child in children:
        found.extend(await _cancelled_descendants(child.workflow_id))
        if child.status == "CANCELLED":
            found.append(child.workflow_id)
    return found


async def resume_run(run_id: str) -> str:
    await get_status(run_id)
    for child_id in await _cancelled_descendants(run_id):
        await DBOS.resume_workflow_async(child_id)
    handle = await DBOS.resume_workflow_async(run_id)
    return handle.workflow_id


async def fork_run(run_id: str, node_id: str, occurrence: int, item: int | None = None) -> str:
    steps = await list_steps(run_id)
    start = locate_step(run_id, node_id, steps, occurrence, item)
    version = runtime.current().settings.app_version
    handle = await DBOS.fork_workflow_async(run_id, start, application_version=version)
    params = _params(await get_status(run_id))
    if params is not None:
        await asyncio.to_thread(
            runtime.current().store.register_run, handle.workflow_id, params.workflow_id
        )
    return handle.workflow_id
