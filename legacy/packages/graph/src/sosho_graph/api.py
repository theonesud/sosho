import logging
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, JsonValue

from sosho_graph.body_limit import BodyLimitMiddleware
from sosho_graph.compiler import GraphBuildError, validate_graph
from sosho_graph.llm_client import litellm_model_factory
from sosho_graph.nodes import default_registry
from sosho_graph.nodes.checkpoint import HumanDecision
from sosho_graph.registry import NodeRegistry, Services
from sosho_graph.run_store import RunRow, RunStatus
from sosho_graph.runs import RunConflictError, RunManager, RunNotFoundError
from sosho_graph.runtime import open_runtime
from sosho_graph.schema import GraphDefinition
from sosho_graph.settings import Settings

MAX_BODY_BYTES = 1_048_576
logger = logging.getLogger(__name__)


class RunCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    graph: GraphDefinition
    input: dict[str, JsonValue] = Field(default_factory=dict)
    thread_id: str | None = Field(default=None, min_length=1)


class RunAccepted(BaseModel):
    run_id: str
    thread_id: str
    status: RunStatus


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str]


def _manager(request: Request) -> RunManager:
    manager: RunManager = request.app.state.manager
    return manager


def _summary(row: RunRow) -> dict[str, JsonValue]:
    return {
        "run_id": row.run_id,
        "thread_id": row.thread_id,
        "graph_id": row.graph.id,
        "status": row.status,
        "error": row.error,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _register_graph_routes(app: FastAPI) -> None:
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/nodes")
    async def nodes(request: Request) -> dict[str, list[dict[str, JsonValue]]]:
        registry: NodeRegistry = request.app.state.registry
        return {"nodes": [entry.model_dump(by_alias=False) for entry in registry.catalog()]}

    @app.post("/graphs/validate")
    async def validate(graph: GraphDefinition, request: Request) -> ValidationResult:
        registry: NodeRegistry = request.app.state.registry
        errors = validate_graph(graph, registry)
        return ValidationResult(valid=not errors, errors=errors)


def _register_run_routes(app: FastAPI) -> None:
    _register_run_control_routes(app)
    _register_run_read_routes(app)


def _register_run_control_routes(app: FastAPI) -> None:
    @app.post("/runs", status_code=202)
    async def start_run(body: RunCreate, request: Request) -> RunAccepted:
        record = await _manager(request).start(body.graph, body.input, body.thread_id)
        return RunAccepted(run_id=record.run_id, thread_id=record.thread_id, status=record.status)


def _register_run_read_routes(app: FastAPI) -> None:
    @app.get("/runs")
    async def list_runs(
        request: Request, limit: int = Query(default=50, ge=1, le=200)
    ) -> dict[str, list[dict[str, JsonValue]]]:
        rows = await _manager(request).list_runs(limit)
        return {"runs": [_summary(row) for row in rows]}

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str, request: Request) -> dict[str, JsonValue]:
        detail = await _manager(request).detail(run_id)
        return asdict(detail)

    @app.get("/runs/{run_id}/events")
    async def run_events(
        run_id: str,
        request: Request,
        after_seq: int = Query(default=0, ge=0),
    ) -> StreamingResponse:
        manager = _manager(request)
        await manager.require(run_id)

        async def stream() -> AsyncIterator[str]:
            async for event in manager.stream_events(run_id, after_seq):
                yield f"event: {event.type}\ndata: {event.model_dump_json(by_alias=False)}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.post("/runs/{run_id}/resume", status_code=202)
    async def resume_run(run_id: str, decision: HumanDecision, request: Request) -> RunAccepted:
        record = await _manager(request).resume(run_id, decision)
        return RunAccepted(run_id=record.run_id, thread_id=record.thread_id, status=record.status)

    @app.post("/runs/{run_id}/cancel")
    async def cancel_run(run_id: str, request: Request) -> dict[str, str]:
        record = await _manager(request).cancel(run_id)
        return {"run_id": record.run_id, "status": record.status}


def _register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RunNotFoundError)
    async def not_found(request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(status_code=404, content={"error": str(error)})

    @app.exception_handler(RunConflictError)
    async def conflict(request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(status_code=409, content={"error": str(error)})

    @app.exception_handler(GraphBuildError)
    async def invalid_graph(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, GraphBuildError):
            raise error
        return JSONResponse(
            status_code=422, content={"error": "invalid graph", "errors": error.errors}
        )


def build_app(
    settings: Settings,
    services: Services | None = None,
    registry: NodeRegistry | None = None,
) -> FastAPI:
    if settings.litellm_api_key is None:
        logger.warning("litellm key missing env=LITELLM_API_KEY effect=model_calls_fail")
    resolved_services = services or Services(model_for=litellm_model_factory(settings))
    resolved_registry = registry or default_registry()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        async with open_runtime(settings, resolved_services, resolved_registry) as manager:
            app.state.manager = manager
            yield

    app = FastAPI(title="Sosho graph service", version="0.1.0", lifespan=lifespan)
    app.state.registry = resolved_registry
    app.add_middleware(BodyLimitMiddleware, max_bytes=MAX_BODY_BYTES)
    _register_graph_routes(app)
    _register_run_routes(app)
    _register_error_handlers(app)
    return app


def create_app() -> FastAPI:
    return build_app(Settings())
