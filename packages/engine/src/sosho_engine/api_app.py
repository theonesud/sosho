from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sosho_engine import lifecycle, routes_runs, routes_triggers, routes_workflows
from sosho_engine.api_support import AUTH, install_error_handlers
from sosho_engine.body_limit import BodyLimitMiddleware
from sosho_engine.runtime import Runtime

LOOPBACK_ORIGINS = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


class Health(BaseModel):
    status: str
    app_version: str


def create_app(active: Runtime) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        del app
        await lifecycle.launch(active)
        try:
            yield
        finally:
            await lifecycle.shutdown(active)

    app = FastAPI(title="Sosho engine", lifespan=lifespan)
    app.add_middleware(BodyLimitMiddleware, max_bytes=active.settings.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=LOOPBACK_ORIGINS,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID", "X-Sosho-Token"],
    )
    install_error_handlers(app)

    @app.get("/health")
    async def health() -> Health:
        return Health(status="ok", app_version=active.settings.app_version)

    for module in (routes_workflows, routes_runs, routes_triggers):
        app.include_router(module.router, dependencies=AUTH)
    app.include_router(routes_triggers.webhook_router)
    return app
