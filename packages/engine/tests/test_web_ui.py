from pathlib import Path

from engine_support import AUTH, TOKEN
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import JsonValue
from sosho_engine.api_support import SESSION_COOKIE, session_value
from sosho_engine.settings import Settings
from sosho_engine.web_ui import install_ui

LOCAL = "http://127.0.0.1:5173"


def loopback(client: TestClient) -> TestClient:
    return TestClient(client.app, client=("127.0.0.1", 50000))


def test_index_routes_assets_and_api_priority(client: TestClient) -> None:
    for path in ("/", "/w/x", "/w/a/b", "/design-ref"):
        page = client.get(path)
        assert page.status_code == 200
        assert "sosho" in page.text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/nodes").status_code == 401
    assert client.get("/nodes", headers=AUTH).status_code == 200
    assert client.get("/nope").status_code == 404


def test_cookie_is_set_only_for_loopback_and_never_holds_the_token(client: TestClient) -> None:
    assert SESSION_COOKIE not in client.get("/").cookies
    local = loopback(client)
    response = local.get("/w/x")
    header = response.headers["set-cookie"]
    assert f"{SESSION_COOKIE}={session_value(TOKEN)}" in header
    assert TOKEN not in header
    for flag in ("HttpOnly", "SameSite=strict", "Path=/"):
        assert flag.lower() in header.lower()
    assert "secure" not in header.lower()


def test_cookie_auth_and_origin_check(client: TestClient) -> None:
    local = loopback(client)
    local.get("/")
    assert local.get("/nodes").status_code == 200
    body: dict[str, JsonValue] = {"draft": {}}
    foreign = {"Origin": "https://evil.example"}
    assert local.post("/validate", json=body, headers=foreign).status_code == 403
    assert local.post("/validate", json=body).status_code == 403
    assert local.post("/validate", json=body, headers={"Origin": LOCAL}).status_code != 403
    assert local.post("/validate", json=body, headers={**AUTH, **foreign}).status_code != 403
    forged = TestClient(client.app, cookies={SESSION_COOKIE: TOKEN})
    assert forged.get("/nodes").status_code == 401


def test_engine_serves_without_a_dist_directory(tmp_path: Path) -> None:
    settings = Settings.model_validate({"api_token": TOKEN, "web_dist": tmp_path / "none"})
    app = FastAPI()
    install_ui(app, settings)
    with TestClient(app, client=("127.0.0.1", 1)) as bare:
        response = bare.get("/")
        assert response.status_code == 404
        assert SESSION_COOKIE not in response.cookies
        assert bare.get("/assets/app.js").status_code == 404
