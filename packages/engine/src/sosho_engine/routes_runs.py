import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sosho_engine import runs
from sosho_engine.jobs import RunParams
from sosho_engine.run_models import ForkRequest, InputRequest, RunDetail, RunSummary
from sosho_engine.tools import JsonDict


class StartRequest(BaseModel):
    version: int | None = None
    input: JsonDict = {}
    trigger_node: str | None = None


class RunRef(BaseModel):
    run_id: str


def _frames(run_id: str, offset: int) -> AsyncIterator[str]:
    async def generate() -> AsyncIterator[str]:
        seq = offset
        async for item in runs.stream_events(run_id, offset):
            seq += 1
            yield f"id: {seq}\ndata: {json.dumps(item)}\n\n"
        yield "event: end\ndata: {}\n\n"

    return generate()


router = APIRouter()


@router.post("/workflows/{workflow_id}/runs", status_code=202)
async def start(workflow_id: str, body: StartRequest) -> RunRef:
    params = RunParams(
        workflow_id=workflow_id,
        version=body.version,
        input=body.input,
        trigger_node=body.trigger_node,
    )
    return RunRef(run_id=await runs.start_run(params))


@router.get("/runs")
async def list_runs(
    status: str | None = None,
    workflow_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[RunSummary]:
    return await runs.list_runs(status, workflow_id, limit, offset)


@router.get("/runs/{run_id}")
async def detail(run_id: str) -> RunDetail:
    return await runs.run_detail(run_id)


@router.get("/runs/{run_id}/events")
async def events(run_id: str, last_event_id: Annotated[int, Header()] = 0) -> StreamingResponse:
    await runs.get_status(run_id)
    return StreamingResponse(_frames(run_id, last_event_id), media_type="text/event-stream")


@router.post("/runs/{run_id}/input", status_code=202)
async def send_input(run_id: str, body: InputRequest) -> RunRef:
    await runs.send_input(run_id, body.node_id, body.reply)
    return RunRef(run_id=run_id)


@router.post("/runs/{run_id}/cancel", status_code=202)
async def cancel(run_id: str) -> RunRef:
    await runs.cancel_run(run_id)
    return RunRef(run_id=run_id)


@router.post("/runs/{run_id}/resume", status_code=202)
async def resume(run_id: str) -> RunRef:
    return RunRef(run_id=await runs.resume_run(run_id))


@router.post("/runs/{run_id}/fork", status_code=202)
async def fork(run_id: str, body: ForkRequest) -> RunRef:
    return RunRef(run_id=await runs.fork_run(run_id, body.node_id, body.occurrence))
