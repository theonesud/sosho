import asyncio
import os
import sys
from pathlib import Path

from engine_support import TOKEN, fake_models
from flows import draft, edge, tool, trigger
from pydantic import BaseModel, JsonValue
from sosho_engine import lifecycle, runs
from sosho_engine.jobs import RunParams
from sosho_engine.settings import Settings
from sosho_engine.spec import WorkflowDraft
from sosho_engine.tools import JsonDict, builtin_tools

POLL_ATTEMPTS = 600


class Mark(BaseModel):
    label: str


def _append(marker: Path, label: str) -> None:
    with marker.open("a", encoding="utf-8") as handle:
        handle.write(f"{label}\n")


def _tools(marker: Path, mode: str):
    registry = builtin_tools()

    async def mark(params: Mark) -> JsonDict:
        _append(marker, params.label)
        return {"label": params.label}

    async def slow(params: Mark) -> JsonDict:
        _append(marker, params.label)
        if mode == "start":
            await asyncio.sleep(120)
        return {"label": params.label}

    registry.register("mark", "Write a marker.", Mark, mark, side_effect=True)
    registry.register("slow", "Wait in the first process.", Mark, slow, side_effect=True)
    return registry


def _parallel_spec() -> WorkflowDraft:
    nodes: list[JsonValue] = [
        trigger(),
        tool("left", "mark", label="left"),
        tool("right", "slow", label="right"),
        {"id": "merge", "kind": "join"},
        tool("last", "mark", label="last"),
    ]
    edges: list[JsonValue] = [
        edge("start", "left"),
        edge("start", "right"),
        edge("left", "merge"),
        edge("right", "merge"),
        edge("merge", "last"),
    ]
    return WorkflowDraft.model_validate(draft(nodes, edges))


def _serial_spec() -> WorkflowDraft:
    nodes: list[JsonValue] = [
        trigger(),
        tool("first", "mark", label="first"),
        tool("middle", "slow", label="middle"),
        tool("last", "mark", label="last"),
    ]
    edges: list[JsonValue] = [
        edge("start", "first"),
        edge("first", "middle"),
        edge("middle", "last"),
    ]
    return WorkflowDraft.model_validate(draft(nodes, edges))


async def main(mode: str, db: Path, marker: Path, run_id: str, shape: str) -> None:
    settings = Settings.model_validate(
        {"db_url": f"sqlite:///{db}", "api_token": TOKEN, "app_version": "test"}
    )
    active = lifecycle.build_runtime(settings, fake_models, _tools(marker, mode))
    await lifecycle.launch(active, lifecycle.engine_queues())
    if mode == "start":
        await asyncio.to_thread(active.store.create_workflow, "crash", "crash", None)
        await asyncio.to_thread(active.store.add_version, "crash", _SHAPES[shape]())
        started = await runs.start_run(RunParams(workflow_id="crash"), "manual")
        sys.stdout.write(f"{started}\n")
        sys.stdout.flush()
        await asyncio.sleep(120)
        return
    for _ in range(POLL_ATTEMPTS):
        status = await runs.get_status(run_id)
        if status.status in ("SUCCESS", "ERROR"):
            sys.stdout.write(f"{status.status}\n")
            sys.stdout.flush()
            break
        await asyncio.sleep(0.1)
    await lifecycle.shutdown(active)
    os._exit(0)


_SHAPES = {"serial": _serial_spec, "parallel": _parallel_spec}


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], sys.argv[5]))
