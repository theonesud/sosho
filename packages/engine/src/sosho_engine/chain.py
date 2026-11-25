import asyncio
from collections import defaultdict
from collections.abc import Iterable

from pydantic import BaseModel, JsonValue

from sosho_engine import runtime
from sosho_engine.graph import reachable
from sosho_engine.jobs import RunParams
from sosho_engine.spec_nodes import TriggerNode
from sosho_engine.tools import JsonDict


class Launch(BaseModel):
    params: RunParams
    timeout: int


def has_finished_cycle(links: Iterable[tuple[str, str]], workflow_id: str) -> bool:
    adjacency: dict[str, list[str]] = defaultdict(list)
    for source, follower in links:
        adjacency[source].append(follower)
    return workflow_id in reachable(adjacency.get(workflow_id, []), adjacency)


async def finished_targets(
    workflow_id: str, run_id: str, status: str, output: JsonValue, depth: int
) -> list[JsonDict]:
    store = runtime.current().store
    targets: list[JsonDict] = []
    for row in await asyncio.to_thread(store.finished_triggers, workflow_id):
        spec = await asyncio.to_thread(store.get_version, row.workflow_id, row.version)
        node = spec.node_map().get(row.node_id)
        if not isinstance(node, TriggerNode) or node.on_status not in ("any", status):
            continue
        if depth + 1 > spec.policy.max_depth:
            continue
        payload: JsonDict = {"source_run_id": run_id, "status": status, "output": output}
        params = RunParams(
            workflow_id=row.workflow_id,
            version=row.version,
            trigger_node=row.node_id,
            input=payload,
            depth=depth + 1,
            parent_run_id=run_id,
        )
        launch = Launch(params=params, timeout=spec.policy.max_run_seconds)
        targets.append(launch.model_dump(mode="json"))
    return targets


async def prepare_scheduled(context: object) -> JsonDict:
    params = RunParams.model_validate(context)
    store = runtime.current().store
    spec = await asyncio.to_thread(store.get_version, params.workflow_id, params.version)
    pinned = params.model_copy(update={"version": spec.version})
    return Launch(params=pinned, timeout=spec.policy.max_run_seconds).model_dump(mode="json")
