"""HTTP API over ASGI. Each test runs the app lifespan with a fake model."""

import json
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sosho_graph.api import build_app
from support import FakeModels, agent, build_graph, make_settings, node_of


@asynccontextmanager
async def api_client(db: Path, models: FakeModels) -> AsyncGenerator[httpx.AsyncClient]:
    app: FastAPI = build_app(make_settings(db), models.services())
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


def _draft_graph_json() -> dict[str, object]:
    graph = build_graph(
        nodes=[node_of("start", "start"), agent("draft", "Draft {{topic}}", "draft")],
        edges=[("start", "draft", None)],
        entry="start",
    )
    return graph.model_dump(mode="json", by_alias=True)


def _review_graph_json() -> dict[str, object]:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            agent("draft", "Draft {{topic}}", "draft"),
            node_of("review", "checkpoint", message="Review"),
            node_of("finish", "end"),
        ],
        edges=[
            ("start", "draft", None),
            ("draft", "review", None),
            ("review", "finish", "approve"),
        ],
        entry="start",
    )
    return graph.model_dump(mode="json", by_alias=True)


@pytest.mark.anyio
async def test_health_and_catalog(tmp_path: Path) -> None:
    async with api_client(tmp_path / "api.sqlite", FakeModels({})) as client:
        health = await client.get("/health")
        nodes = await client.get("/nodes")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    type_ids = [entry["type_id"] for entry in nodes.json()["nodes"]]
    assert "checkpoint" in type_ids
    assert "agent" in type_ids


@pytest.mark.anyio
async def test_validate_reports_errors_for_an_unknown_node_type(tmp_path: Path) -> None:
    bad = build_graph(
        nodes=[
            node_of("start", "start"),
            node_of("tool", "skill", skillName="x", promptTemplate="p"),
        ],
        edges=[("start", "tool", None)],
        entry="start",
    ).model_dump(mode="json", by_alias=True)
    async with api_client(tmp_path / "validate.sqlite", FakeModels({})) as client:
        ok = await client.post("/graphs/validate", json=_draft_graph_json())
        broken = await client.post("/graphs/validate", json=bad)
    assert ok.json() == {"valid": True, "errors": []}
    assert broken.json()["valid"] is False
    assert "type 'skill' is not in the catalog" in broken.json()["errors"][0]


@pytest.mark.anyio
async def test_start_run_then_read_events_and_detail(tmp_path: Path) -> None:
    body = {"graph": _draft_graph_json(), "input": {"topic": "rivers"}}
    async with api_client(tmp_path / "run.sqlite", FakeModels({"main": ["a draft"]})) as client:
        started = await client.post("/runs", json=body)
        run_id = started.json()["run_id"]
        events = await client.get(f"/runs/{run_id}/events")
        detail = await client.get(f"/runs/{run_id}")
        listed = await client.get("/runs")
    assert started.status_code == 202
    assert started.json()["status"] == "running"
    assert "event: done" in events.text
    assert detail.json()["status"] == "completed"
    assert detail.json()["data"]["draft"] == "a draft"
    assert run_id in [row["run_id"] for row in listed.json()["runs"]]


@pytest.mark.anyio
async def test_openapi_document_lists_the_run_routes(tmp_path: Path) -> None:
    async with api_client(tmp_path / "openapi.sqlite", FakeModels({})) as client:
        response = await client.get("/openapi.json")
    paths = response.json()["paths"]
    assert "/runs" in paths
    assert "/runs/{run_id}/resume" in paths


@pytest.mark.anyio
async def test_invalid_graph_returns_422_with_errors(tmp_path: Path) -> None:
    bad = build_graph(
        nodes=[node_of("start", "start"), node_of("tool", "shell")],
        edges=[("start", "tool", None)],
        entry="start",
    ).model_dump(mode="json", by_alias=True)
    async with api_client(tmp_path / "bad.sqlite", FakeModels({})) as client:
        response = await client.post("/runs", json={"graph": bad, "input": {}})
    assert response.status_code == 422
    assert response.json()["errors"]


@pytest.mark.anyio
async def test_unknown_run_returns_404(tmp_path: Path) -> None:
    async with api_client(tmp_path / "missing.sqlite", FakeModels({})) as client:
        response = await client.get("/runs/does-not-exist")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_resume_with_wrong_node_id_returns_409(tmp_path: Path) -> None:
    body = {"graph": _review_graph_json(), "input": {"topic": "x"}}
    async with api_client(tmp_path / "wrong.sqlite", FakeModels({"main": ["d"]})) as client:
        run_id = (await client.post("/runs", json=body)).json()["run_id"]
        await client.get(f"/runs/{run_id}/events")
        response = await client.post(
            f"/runs/{run_id}/resume", json={"action": "approve", "nodeId": "other"}
        )
    assert response.status_code == 409


def _last_seq(sse_text: str) -> int:
    """Return the sequence number of the last event in an SSE body."""
    seqs = [
        json.loads(line[len("data: ") :])["seq"]
        for line in sse_text.splitlines()
        if line.startswith("data: ")
    ]
    return int(seqs[-1])


@pytest.mark.anyio
async def test_resume_then_run_completes_over_http(tmp_path: Path) -> None:
    body = {"graph": _review_graph_json(), "input": {"topic": "x"}}
    async with api_client(tmp_path / "resume.sqlite", FakeModels({"main": ["d"]})) as client:
        run_id = (await client.post("/runs", json=body)).json()["run_id"]
        first = await client.get(f"/runs/{run_id}/events")
        waiting = await client.get(f"/runs/{run_id}")
        resumed = await client.post(
            f"/runs/{run_id}/resume", json={"action": "approve", "nodeId": "review"}
        )
        await client.get(f"/runs/{run_id}/events?after_seq={_last_seq(first.text)}")
        final = await client.get(f"/runs/{run_id}")
        cancel_done = await client.post(f"/runs/{run_id}/cancel")
    assert waiting.json()["status"] == "waiting_checkpoint"
    assert resumed.status_code == 202
    assert resumed.json()["status"] == "running"
    assert final.json()["status"] == "completed"
    assert cancel_done.status_code == 409


@pytest.mark.anyio
async def test_body_over_one_megabyte_returns_413(tmp_path: Path) -> None:
    big = {"graph": _draft_graph_json(), "input": {"blob": "x" * 1_100_000}}
    async with api_client(tmp_path / "big.sqlite", FakeModels({})) as client:
        response = await client.post("/runs", json=big)
    assert response.status_code == 413
