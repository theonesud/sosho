from collections.abc import Awaitable, Callable

from dbos import WorkflowHandleAsync
from pydantic import JsonValue

from sosho_engine.budget import inherit_from
from sosho_engine.errors import NodeFailedError
from sosho_engine.jobs import Inherited, NodeJob, RunParams
from sosho_engine.launch import run_options
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import MapNode, SubworkflowNode
from sosho_engine.templating import render_value, resolve_path
from sosho_engine.tools import JsonDict

Handle = WorkflowHandleAsync[JsonDict]
Launcher = Callable[[JsonDict], Awaitable[Handle]]


def _child(
    node: MapNode | SubworkflowNode,
    job: NodeJob,
    depth: int,
    data: JsonDict,
    inherited: Inherited,
) -> RunParams:
    return RunParams(
        workflow_id=node.workflow_id,
        version=node.version,
        input=data,
        depth=depth + 1,
        parent_run_id=job.run_id,
        inherited=inherited,
    )


def plan_fanout(
    node: MapNode | SubworkflowNode, job: NodeJob, spec: Workflow, depth: int
) -> list[RunParams]:
    if isinstance(node, SubworkflowNode):
        rendered = render_value(dict(node.input), job.data)
        if not isinstance(rendered, dict):
            raise NodeFailedError(f"subworkflow {node.id} input is not an object")
        return [_child(node, job, depth, rendered, inherit_from(spec, job.llm_left, 1))]
    path = node.items.strip().removeprefix("{{").removesuffix("}}").strip()
    items = resolve_path(job.data, path)
    if not isinstance(items, list):
        raise NodeFailedError(f"map {node.id} items path {node.items} is not a list")
    if len(items) > node.max_items:
        raise NodeFailedError(f"map {node.id} has {len(items)} items, above {node.max_items}")
    parent_input = job.data.get("input")
    inherited = inherit_from(spec, job.llm_left, len(items))
    return [
        _child(
            node,
            job,
            depth,
            {"item": item, "index": index, "parent_input": parent_input},
            inherited,
        )
        for index, item in enumerate(items)
    ]


async def start_fanout(
    launch: Launcher, params: list[RunParams], base_id: str, run_seconds: float | None
) -> list[Handle]:
    handles: list[Handle] = []
    for index, item in enumerate(params):
        with run_options(f"{base_id}:{index}", run_seconds):
            handles.append(await launch(item.model_dump(mode="json")))
    return handles


def merge_fanout(node: MapNode | SubworkflowNode, results: list[JsonDict]) -> JsonDict:
    if isinstance(node, SubworkflowNode):
        return {"output": results[0].get("output"), "status": results[0].get("status")}
    outputs: list[JsonValue] = [result.get("output") for result in results]
    return {"results": outputs, "count": len(outputs)}
