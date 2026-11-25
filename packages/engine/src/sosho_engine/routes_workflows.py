import asyncio
import re

from fastapi import APIRouter
from pydantic import BaseModel

from sosho_engine import runtime, triggers
from sosho_engine.api_support import validate_draft
from sosho_engine.catalog import Catalog, build_catalog
from sosho_engine.issues import Issue
from sosho_engine.spec import Workflow, WorkflowDraft
from sosho_engine.spec_nodes import IDENTIFIER
from sosho_engine.store_tables import VersionSummary, WorkflowSummary
from sosho_engine.validation import SpecInvalidError

ID_RE = re.compile(IDENTIFIER)


class WorkflowCreate(BaseModel):
    id: str
    name: str
    description: str | None = None


class WorkflowPatch(BaseModel):
    name: str | None = None
    description: str | None = None


class ValidateRequest(BaseModel):
    workflow_id: str = "draft"
    draft: WorkflowDraft


class ValidateResponse(BaseModel):
    valid: bool
    issues: list[Issue]


router = APIRouter()


@router.get("/nodes")
async def nodes() -> Catalog:
    active = runtime.current()
    skills = await asyncio.to_thread(active.store.list_skills)
    return build_catalog(active.tools, skills)


@router.get("/workflows")
async def list_workflows() -> list[WorkflowSummary]:
    return await asyncio.to_thread(runtime.current().store.list_workflows)


@router.post("/workflows", status_code=201)
async def create_workflow(body: WorkflowCreate) -> WorkflowSummary:
    if not ID_RE.match(body.id):
        raise SpecInvalidError([Issue("bad_id", "workflow id has an invalid form")])
    store = runtime.current().store
    await asyncio.to_thread(store.create_workflow, body.id, body.name, body.description)
    return await asyncio.to_thread(store.get_workflow, body.id)


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str) -> WorkflowSummary:
    return await asyncio.to_thread(runtime.current().store.get_workflow, workflow_id)


@router.patch("/workflows/{workflow_id}")
async def patch_workflow(workflow_id: str, body: WorkflowPatch) -> WorkflowSummary:
    store = runtime.current().store
    await asyncio.to_thread(store.update_workflow, workflow_id, body.name, body.description)
    return await asyncio.to_thread(store.get_workflow, workflow_id)


@router.delete("/workflows/{workflow_id}", status_code=204)
async def delete_workflow(workflow_id: str) -> None:
    store = runtime.current().store
    await asyncio.to_thread(store.get_workflow, workflow_id)
    await triggers.deactivate(workflow_id)
    await asyncio.to_thread(store.delete_workflow, workflow_id)


@router.post("/validate")
async def validate(body: ValidateRequest) -> ValidateResponse:
    issues = await validate_draft(body.workflow_id, body.draft, 1)
    return ValidateResponse(valid=not issues, issues=issues)


@router.get("/workflows/{workflow_id}/versions")
async def list_versions(workflow_id: str) -> list[VersionSummary]:
    return await asyncio.to_thread(runtime.current().store.list_versions, workflow_id)


@router.post("/workflows/{workflow_id}/versions", status_code=201)
async def add_version(workflow_id: str, draft: WorkflowDraft) -> Workflow:
    store = runtime.current().store
    summary = await asyncio.to_thread(store.get_workflow, workflow_id)
    issues = await validate_draft(workflow_id, draft, (summary.latest_version or 0) + 1)
    if issues:
        raise SpecInvalidError(issues)
    return await asyncio.to_thread(store.add_version, workflow_id, draft)


@router.get("/workflows/{workflow_id}/versions/{version}")
async def get_version(workflow_id: str, version: int) -> Workflow:
    return await asyncio.to_thread(runtime.current().store.get_version, workflow_id, version)
