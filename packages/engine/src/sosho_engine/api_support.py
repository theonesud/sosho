import asyncio
import hmac
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.params import Depends as DependsParam
from fastapi.responses import JSONResponse

from sosho_engine import runtime
from sosho_engine.errors import (
    ConflictError,
    EngineError,
    NotFoundError,
    PolicyError,
    RateLimitError,
    RunLimitError,
)
from sosho_engine.issues import Issue
from sosho_engine.spec import Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.spec_nodes import MapNode, SubworkflowNode
from sosho_engine.validation import SpecInvalidError, validate_workflow


async def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    token = runtime.current().settings.api_token.get_secret_value()
    scheme, _, supplied = (authorization or "").partition(" ")
    valid = scheme == "Bearer" and hmac.compare_digest(supplied.encode(), token.encode())
    if not valid:
        raise HTTPException(status_code=401, detail="a valid bearer token is required")


AUTH: list[DependsParam] = [Depends(require_token)]


def _handler(status: int) -> Callable[[Request, Exception], Awaitable[JSONResponse]]:
    async def handle(request: Request, error: Exception) -> JSONResponse:
        del request
        return JSONResponse({"error": str(error)}, status_code=status)

    return handle


async def _invalid(request: Request, error: Exception) -> JSONResponse:
    del request
    if not isinstance(error, SpecInvalidError):
        return JSONResponse({"error": str(error)}, status_code=500)
    issues = [asdict(issue) for issue in error.issues]
    return JSONResponse({"error": "the workflow is not valid", "issues": issues}, status_code=422)


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(NotFoundError, _handler(404))
    app.add_exception_handler(ConflictError, _handler(409))
    app.add_exception_handler(RunLimitError, _handler(409))
    app.add_exception_handler(PolicyError, _handler(403))
    app.add_exception_handler(RateLimitError, _handler(429))
    app.add_exception_handler(EngineError, _handler(400))
    app.add_exception_handler(SpecInvalidError, _invalid)


def check_references(spec: Workflow) -> list[Issue]:
    store = runtime.current().store
    issues: list[Issue] = []
    for node in spec.nodes:
        if not isinstance(node, (MapNode, SubworkflowNode)):
            continue
        try:
            store.get_version(node.workflow_id, node.version)
        except NotFoundError:
            issues.append(Issue("unknown_workflow", "referenced version does not exist", node.id))
    return issues


async def validate_draft(workflow_id: str, draft: WorkflowDraft, version: int) -> list[Issue]:
    spec = draft_to_workflow(draft, workflow_id, version)
    active = runtime.current()
    skills = set(await asyncio.to_thread(active.store.list_skills))
    issues = validate_workflow(spec, active.tools.names(), skills)
    issues.extend(await asyncio.to_thread(check_references, spec))
    return issues
