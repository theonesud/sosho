import asyncio
from dataclasses import dataclass, field

from dbos import DBOS, StepOptions
from pydantic import JsonValue

from sosho_engine import runtime
from sosho_engine.budget import effective_policy
from sosho_engine.chain import Launch, finished_targets, prepare_scheduled
from sosho_engine.errors import NodeFailedError, PolicyError, RunLimitError
from sosho_engine.events import Telemetry, preview
from sosho_engine.fanout import Handle
from sosho_engine.jobs import RunParams
from sosho_engine.launch import cancel_children, run_options
from sosho_engine.run_status import FAILED, RUNNING, SUCCEEDED, WAITING
from sosho_engine.scheduler import RunState, complete, new_state, settle, terminal_outputs
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import Node, TriggerNode
from sosho_engine.tools import JsonDict
from sosho_engine.validation import check_policy
from sosho_engine.wave import Outcome, RunContext, WaveFailedError, make_jobs, run_wave


@dataclass
class Run:
    ctx: RunContext
    state: RunState
    tel: Telemetry = field(default_factory=Telemetry)
    steps: int = 0
    llm_calls: int = 0

    def snapshot(self, status: str, running: list[str]) -> dict[str, JsonValue]:
        nodes: dict[str, JsonValue] = {
            node.id: self.state.statuses.get(node.id, "pending") for node in self.ctx.spec.nodes
        }
        nodes.update(dict.fromkeys(running, "running"))
        return {"status": status, "nodes": nodes, "steps": self.steps, "llm_calls": self.llm_calls}


async def _load_spec(run_id: str, workflow_id: str, version: int | None) -> JsonDict:
    store = runtime.current().store
    await asyncio.to_thread(store.register_run, run_id, workflow_id)
    spec = await asyncio.to_thread(store.get_version, workflow_id, version)
    return spec.model_dump(mode="json")


def _inherit_policy(parsed: RunParams, spec: Workflow) -> Workflow:
    if parsed.inherited is None:
        return spec
    limited = spec.model_copy(update={"policy": effective_policy(spec.policy, parsed.inherited)})
    issues = check_policy(limited)
    if issues:
        raise PolicyError("; ".join(f"{issue.message} in node {issue.node}" for issue in issues))
    return limited


async def _begin(params: JsonDict) -> tuple[RunParams, Workflow, int | None]:
    parsed = RunParams.model_validate(params)
    options = StepOptions(name="load_spec")
    run_id = current_run_id()
    raw = await DBOS.run_step_async(options, _load_spec, run_id, parsed.workflow_id, parsed.version)
    spec = _inherit_policy(parsed, Workflow.model_validate(raw))
    if parsed.depth > spec.policy.max_depth:
        raise RunLimitError(f"run depth {parsed.depth} is above {spec.policy.max_depth}")
    trigger = spec.node_map().get(parsed.trigger_node or spec.entry)
    if not isinstance(trigger, TriggerNode):
        raise NodeFailedError(f"trigger node {parsed.trigger_node} is not a trigger")
    status = await DBOS.get_workflow_status_async(run_id)
    return parsed, spec, status.workflow_deadline_epoch_ms if status else None


def current_run_id() -> str:
    run_id = DBOS.workflow_id
    if run_id is None:
        raise NodeFailedError("a run must execute inside a DBOS workflow")
    return run_id


async def launch_run(payload: dict[str, JsonValue]) -> Handle:
    return await DBOS.start_workflow_async(run_workflow, payload)


async def _apply(run: Run, node: Node, outcome: Outcome) -> None:
    run.llm_calls += outcome.llm_calls
    if outcome.error is not None:
        await run.tel.log("node_failed", {"node": node.id, "error": str(outcome.error)})
        complete(run.state, node.id, {"error": str(outcome.error)})
        return
    output = outcome.output or {}
    complete(run.state, node.id, output)
    await run.tel.log("node_finished", {"node": node.id, "output": preview(output)})


async def _wave(run: Run, ready: list[str]) -> None:
    jobs = make_jobs(run.ctx, run.state, ready, run.llm_calls)
    for node_id in ready:
        await run.tel.log("node_started", {"node": node_id})
    await run.tel.progress(run.snapshot(RUNNING, ready))

    async def announce(waiting: dict[str, str]) -> None:
        extra: dict[str, JsonValue] = {"waiting": dict(waiting)}
        await run.tel.progress({**run.snapshot(WAITING, ready), **extra})

    try:
        outcomes = await run_wave(run.ctx, run.state, jobs, launch_run, announce)
    except WaveFailedError as failed:
        await run.tel.log("node_failed", {"node": failed.node_id, "error": str(failed.error)})
        raise NodeFailedError(f"node {failed.node_id} failed: {failed.error}") from failed.error
    nodes = run.ctx.spec.node_map()
    for job in jobs:
        await _apply(run, nodes[job.node.id], outcomes[job.node.id])
    await run.tel.progress(run.snapshot(RUNNING, []))


async def _drive(run: Run) -> None:
    limit = run.ctx.spec.policy.max_steps
    while ready := settle(run.state):
        run.steps += len(ready)
        if run.steps > limit:
            raise RunLimitError(f"the run passed {limit} node executions")
        await _wave(run, ready)


async def _start_follow_ups(run: Run, status: str, output: JsonValue) -> None:
    ctx = run.ctx
    if ctx.params.inherited is not None:
        return
    targets = await DBOS.run_step_async(
        StepOptions(name="finished_targets"),
        finished_targets,
        ctx.params.workflow_id,
        ctx.run_id,
        status,
        output,
        ctx.params.depth,
    )
    for index, raw in enumerate(targets):
        launch = Launch.model_validate(raw)
        with run_options(f"{ctx.run_id}:finished:{index}", launch.timeout):
            await DBOS.start_workflow_async(run_workflow, launch.params.model_dump(mode="json"))


async def _finish(run: Run, status: str, output: JsonValue) -> None:
    await run.tel.log("run_finished", {"status": status})
    await run.tel.progress(run.snapshot(status, []))
    await _start_follow_ups(run, status, output)
    await run.tel.close()


@DBOS.workflow()
async def run_workflow(params: dict[str, JsonValue]) -> dict[str, JsonValue]:
    parsed, spec, deadline_ms = await _begin(params)
    ctx = RunContext(current_run_id(), spec, parsed, deadline_ms)
    run = Run(ctx, new_state(spec, parsed.trigger_node or spec.entry, parsed.input))
    await run.tel.log("run_started", {"workflow_id": spec.id, "version": spec.version})
    try:
        await _drive(run)
    except Exception as error:
        await cancel_children(ctx.run_id)
        await _finish(run, FAILED, {"error": str(error)})
        raise
    output = terminal_outputs(run.state)
    await _finish(run, SUCCEEDED, output)
    statuses: dict[str, JsonValue] = dict(run.state.statuses)
    return {
        "status": SUCCEEDED,
        "output": output,
        "nodes": statuses,
        "steps": run.steps,
        "llm_calls": run.llm_calls,
    }


@DBOS.workflow()
async def scheduled_run(scheduled_time: object, context: object) -> None:
    del scheduled_time
    raw = await DBOS.run_step_async(StepOptions(name="schedule_start"), prepare_scheduled, context)
    launch = Launch.model_validate(raw)
    with run_options(f"{current_run_id()}:run", launch.timeout):
        await DBOS.start_workflow_async(run_workflow, launch.params.model_dump(mode="json"))
