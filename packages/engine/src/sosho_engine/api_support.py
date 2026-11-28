import asyncio
import hashlib
import hmac
import re
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import Annotated

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Request
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

SESSION_COOKIE = "sosho_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
LOOPBACK_URL = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(/|$)")


def session_value(token: str) -> str:
    return hmac.new(token.encode(), b"sosho-session-v1", hashlib.sha256).hexdigest()


def _bearer_valid(authorization: str | None, token: str) -> bool:
    scheme, _, supplied = (authorization or "").partition(" ")
    return scheme == "Bearer" and hmac.compare_digest(supplied.encode(), token.encode())


def _cookie_valid(cookie: str | None, token: str) -> bool:
    expected = session_value(token)
    return cookie is not None and hmac.compare_digest(cookie.encode(), expected.encode())


async def require_token(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    sosho_session: Annotated[str | None, Cookie()] = None,
) -> None:
    token = runtime.current().settings.api_token.get_secret_value()
    if _bearer_valid(authorization, token):
        return
    if not _cookie_valid(sosho_session, token):
        raise HTTPException(status_code=401, detail="a valid bearer token is required")
    if request.method not in SAFE_METHODS:
        source = request.headers.get("origin") or request.headers.get("referer") or ""
        if not LOOPBACK_URL.match(source):
            raise HTTPException(status_code=403, detail="a loopback origin is required")


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
    issues = validate_workflow(spec, active.tools.names(), skills, active.settings.direct_roles)
    issues.extend(await asyncio.to_thread(check_references, spec))
    return issues
