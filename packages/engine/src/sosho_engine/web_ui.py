from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from sosho_engine.api_support import SESSION_COOKIE, session_value
from sosho_engine.settings import Settings

UI_PATHS = ["/", "/w/{page:path}", "/design-ref"]


def install_ui(app: FastAPI, settings: Settings) -> None:
    dist = settings.web_dist
    index = dist / "index.html"
    token = settings.api_token.get_secret_value()
    trusted = set(settings.session_client_hosts)

    async def page(request: Request) -> Response:
        if not index.is_file():
            return PlainTextResponse("the web app is not built", status_code=404)
        response = FileResponse(index)
        if request.client is not None and request.client.host in trusted:
            response.set_cookie(
                SESSION_COOKIE,
                session_value(token),
                httponly=True,
                samesite="strict",
                secure=False,
                path="/",
            )
        return response

    for path in UI_PATHS:
        app.add_api_route(path, page, methods=["GET"], include_in_schema=False)
    if Path(dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
