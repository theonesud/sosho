from pydantic import BaseModel, JsonValue

from sosho_engine.human import HumanReply


class RunSummary(BaseModel):
    run_id: str
    status: str
    workflow_id: str | None
    version: int | None
    created_at: int | None
    updated_at: int | None
    app_version: str | None
    forked_from: str | None
    parent_run_id: str | None


class StepSummary(BaseModel):
    step: int
    name: str
    child_run_id: str | None
    error: str | None
    started_at: int | None
    completed_at: int | None
    output: JsonValue = None


class PendingHuman(BaseModel):
    node_id: str
    run_id: str
    prompt: str
    show: str | None
    actions: list[str]
    wait_seconds: float


class RunDetail(BaseModel):
    summary: RunSummary
    output: JsonValue = None
    error: str | None = None
    progress: JsonValue = None
    pending_human: list[PendingHuman] = []
    steps: list[StepSummary] = []


class InputRequest(BaseModel):
    node_id: str
    reply: HumanReply


class ForkRequest(BaseModel):
    node_id: str
    occurrence: int = 1
