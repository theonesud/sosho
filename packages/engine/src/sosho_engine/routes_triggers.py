from typing import Annotated

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, JsonValue, TypeAdapter, ValidationError

from sosho_engine import runs, triggers
from sosho_engine.errors import BadRequestError
from sosho_engine.jobs import RunParams
from sosho_engine.routes_runs import RunRef
from sosho_engine.tools import JsonDict
from sosho_engine.triggers import Activation, ScheduleInfo

BODY_ADAPTER: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


class ActivateRequest(BaseModel):
    version: int | None = None


async def _body_dict(request: Request) -> JsonDict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        parsed = BODY_ADAPTER.validate_json(raw)
    except ValidationError as error:
        raise BadRequestError("the request body is not valid JSON") from error
    return parsed if isinstance(parsed, dict) else {"payload": parsed}


router = APIRouter()
webhook_router = APIRouter()


@router.post("/workflows/{workflow_id}/activate")
async def activate(workflow_id: str, body: ActivateRequest) -> Activation:
    return await triggers.activate(workflow_id, body.version)


@router.delete("/workflows/{workflow_id}/activate", status_code=204)
async def deactivate(workflow_id: str) -> None:
    await triggers.deactivate(workflow_id)


@router.get("/schedules")
async def list_schedules() -> list[ScheduleInfo]:
    return await triggers.list_schedules()


@router.post("/schedules/{name}/{action}", status_code=202)
async def manage(name: str, action: str) -> ScheduleInfo | None:
    await triggers.manage_schedule(name, action)
    return None


@router.delete("/schedules/{name}", status_code=204)
async def delete_schedule(name: str) -> None:
    await triggers.manage_schedule(name, "delete")


@webhook_router.post("/webhooks/{workflow_id}/{node_id}", status_code=202)
async def webhook(
    workflow_id: str,
    node_id: str,
    request: Request,
    x_sosho_token: Annotated[str, Header()],
) -> RunRef:
    row = await triggers.verify_webhook(workflow_id, node_id, x_sosho_token)
    params = RunParams(
        workflow_id=workflow_id,
        version=row.version,
        input=await _body_dict(request),
        trigger_node=node_id,
    )
    return RunRef(run_id=await runs.start_run(params, "webhook"))
