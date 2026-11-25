import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from dbos import DBOS, SetWorkflowID, SetWorkflowTimeout, WorkflowHandleAsync
from pydantic import JsonValue

from sosho_engine import runtime
from sosho_engine.budget import failure_charge, reserve, sum_calls
from sosho_engine.errors import NodeFailedError
from sosho_engine.fanout import Handle, Launcher, merge_fanout, plan_fanout, start_fanout
from sosho_engine.jobs import NodeJob, NodeResult, RunParams
from sosho_engine.launch import limit_seconds, remaining_seconds
from sosho_engine.nodeflow import node_workflow
from sosho_engine.queues import HOST_QUEUE, get_queue
from sosho_engine.scheduler import RunState, blocked_branches, join_inputs, node_data
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import HOST_KINDS, MapNode, SubworkflowNode
from sosho_engine.steps import run_inline_step
from sosho_engine.tools import JsonDict

CHILD_KINDS = frozenset({"agent", "skill", "human", "wait"})
TIMEOUT_GRACE_SECONDS = 30.0
Announce = Callable[[dict[str, str]], Awaitable[None]]


@dataclass(frozen=True)
class RunContext:
    run_id: str
    spec: Workflow
    params: RunParams
    deadline_ms: int | None = None

    def remaining(self) -> float | None:
        return remaining_seconds(self.deadline_ms, int(time.time() * 1000))


@dataclass
class Outcome:
    output: JsonDict | None = None
    error: Exception | None = None
    llm_calls: int = 0


class WaveFailedError(Exception):
    def __init__(self, node_id: str, error: Exception) -> None:
        super().__init__(f"node {node_id} failed: {error}")
        self.node_id = node_id
        self.error = error


@dataclass
class Dispatch:
    job: NodeJob
    child: WorkflowHandleAsync[JsonDict] | None = None
    fanout: list[Handle] | None = None
    waiting_id: str | None = None
    error: Exception | None = None

    def is_inline(self) -> bool:
        return self.child is None and self.fanout is None and self.error is None


def make_jobs(ctx: RunContext, state: RunState, ready: list[str], llm_used: int) -> list[NodeJob]:
    nodes = ctx.spec.node_map()
    shares = reserve(
        [nodes[node_id] for node_id in ready], ctx.spec.policy.max_llm_calls - llm_used
    )
    jobs: list[NodeJob] = []
    for node_id in ready:
        node = nodes[node_id]
        inputs, dead = join_inputs(state, node_id) if node.kind == "join" else ({}, [])
        jobs.append(
            NodeJob(
                run_id=ctx.run_id,
                node=node,
                data=node_data(state, node_id),
                llm_left=shares[node_id],
                allowed_tools=ctx.spec.policy.allowed_tools,
                allowed_skills=ctx.spec.policy.allowed_skills,
                join_inputs=inputs,
                join_dead=dead,
                blocked=blocked_branches(state, node_id),
            )
        )
    return jobs


def child_id(ctx: RunContext, state: RunState, node_id: str) -> str:
    return f"{ctx.run_id}:{node_id}:{state.executions.get(node_id, 0) + 1}"


def _is_child(job: NodeJob) -> bool:
    node = job.node
    return node.kind in CHILD_KINDS or (node.kind in ("llm", "tool") and node.queue is not None)


async def _enqueue(queue: str | None, payload: dict[str, JsonValue]) -> Handle:
    if queue is None:
        return await DBOS.start_workflow_async(node_workflow, payload)
    return await (await get_queue(queue)).enqueue_async(node_workflow, payload)


async def _start_child(
    job: NodeJob, cid: str, remaining: float | None
) -> WorkflowHandleAsync[JsonDict]:
    node = job.node
    on_host = node.kind in HOST_KINDS
    queue = HOST_QUEUE if on_host else node.queue
    payload: dict[str, JsonValue] = job.model_dump(mode="json")
    with SetWorkflowID(cid):
        if on_host:
            own = (
                None
                if node.timeout_seconds is None
                else node.timeout_seconds + TIMEOUT_GRACE_SECONDS
            )
            with SetWorkflowTimeout(limit_seconds(own, remaining)):
                return await _enqueue(queue, payload)
        return await _enqueue(queue, payload)


def _succeeded(raw: JsonDict) -> Outcome:
    result = NodeResult.model_validate(raw)
    return Outcome(result.output, None, result.llm_calls)


async def _run_inline(job: NodeJob) -> Outcome:
    try:
        return _succeeded(await run_inline_step(job))
    except Exception as error:
        return Outcome(error=error, llm_calls=failure_charge(job, error))


async def _result_of(handle: Handle) -> JsonDict:
    try:
        return await handle.get_result()
    except asyncio.CancelledError as error:
        current = asyncio.current_task()
        if current is not None and current.cancelling() > 0:
            raise
        raise NodeFailedError(f"child run {handle.workflow_id} was cancelled") from error


async def _collect_child(job: NodeJob, handle: Handle) -> Outcome:
    try:
        return _succeeded(await _result_of(handle))
    except Exception as error:
        return Outcome(error=error, llm_calls=failure_charge(job, error))


async def _collect_fanout(
    job: NodeJob, node: MapNode | SubworkflowNode, handles: list[Handle]
) -> Outcome:
    try:
        results = [await _result_of(handle) for handle in handles]
    except Exception as error:
        return Outcome(error=error, llm_calls=failure_charge(job, error))
    return Outcome(merge_fanout(node, results), None, sum_calls(results))


async def _child_timeout(ctx: RunContext, node: MapNode | SubworkflowNode) -> float | None:
    store = runtime.current().store
    child = await asyncio.to_thread(store.get_version, node.workflow_id, node.version)
    return limit_seconds(child.policy.max_run_seconds, ctx.remaining())


async def _dispatch(ctx: RunContext, state: RunState, job: NodeJob, runner: Launcher) -> Dispatch:
    node = job.node
    cid = child_id(ctx, state, node.id)
    if isinstance(node, (MapNode, SubworkflowNode)):
        params = plan_fanout(node, job, ctx.spec, ctx.params.depth)
        timeout = await _child_timeout(ctx, node)
        return Dispatch(job, fanout=await start_fanout(runner, params, cid, timeout))
    if _is_child(job):
        waiting = cid if node.kind == "human" else None
        child = await _start_child(job, cid, ctx.remaining())
        return Dispatch(job, child=child, waiting_id=waiting)
    return Dispatch(job)


async def _settle(dispatch: Dispatch) -> Outcome:
    if dispatch.is_inline():
        return await _run_inline(dispatch.job)
    if dispatch.error is not None:
        return Outcome(error=dispatch.error)
    node = dispatch.job.node
    if dispatch.fanout is not None and isinstance(node, (MapNode, SubworkflowNode)):
        return await _collect_fanout(dispatch.job, node, dispatch.fanout)
    if dispatch.child is not None:
        return await _collect_child(dispatch.job, dispatch.child)
    return Outcome(error=RuntimeError(f"node {node.id} was not dispatched"))


async def _await_outcomes(
    ctx: RunContext, tasks: dict[str, asyncio.Task[Outcome]]
) -> dict[str, Outcome]:
    nodes = ctx.spec.node_map()
    order = {task: index for index, task in enumerate(tasks.values())}
    names = {task: node_id for node_id, task in tasks.items()}
    pending = set(tasks.values())
    outcomes: dict[str, Outcome] = {}
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in sorted(done, key=lambda item: order[item]):
                node_id = names[task]
                outcomes[node_id] = task.result()
                error = outcomes[node_id].error
                if error is not None and not nodes[node_id].continue_on_error:
                    raise WaveFailedError(node_id, error)
    finally:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    return outcomes


async def run_wave(
    ctx: RunContext,
    state: RunState,
    jobs: list[NodeJob],
    runner: Launcher,
    announce: Announce,
) -> dict[str, Outcome]:
    dispatches: list[Dispatch] = []
    for job in jobs:
        try:
            dispatches.append(await _dispatch(ctx, state, job, runner))
        except Exception as error:
            dispatches.append(Dispatch(job, error=error))
    waiting = {d.job.node.id: d.waiting_id for d in dispatches if d.waiting_id}
    if waiting:
        await announce(waiting)
    tasks = {d.job.node.id: asyncio.create_task(_settle(d)) for d in dispatches}
    return await _await_outcomes(ctx, tasks)
