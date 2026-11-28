import os
import time
import uuid
from collections.abc import Iterator

import httpx
import pytest
from pydantic import BaseModel, JsonValue

from tests.conftest import ENGINE_URL, remove_workflow, require_service

pytestmark = pytest.mark.integration

REQUEST_TIMEOUT = 20.0
POLL_ATTEMPTS = 600
TERMINAL = {"succeeded", "failed", "cancelled"}


class Health(BaseModel):
    status: str
    app_version: str


class RunRef(BaseModel):
    run_id: str


class Summary(BaseModel):
    status: str


class Pending(BaseModel):
    node_id: str


class NodeText(BaseModel):
    text: str


class RunOutput(BaseModel):
    output: dict[str, NodeText]


class RunView(BaseModel):
    summary: Summary
    output: JsonValue = None
    error: str | None = None
    pending_human: list[Pending] = []


class EngineClient:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client
        self.created: list[str] = []

    def run(self, run_id: str) -> RunView:
        response = self.client.get(f"/runs/{run_id}")
        assert response.status_code == 200, response.text
        return RunView.model_validate(response.json())

    def wait(self, run_id: str, done: set[str]) -> RunView:
        view = self.run(run_id)
        for _ in range(POLL_ATTEMPTS):
            view = self.run(run_id)
            if view.summary.status in done:
                return view
            time.sleep(0.2)
        return view

    def wait_pending(self, run_id: str) -> RunView:
        view = self.run(run_id)
        for _ in range(POLL_ATTEMPTS):
            view = self.run(run_id)
            if view.pending_human:
                return view
            time.sleep(0.2)
        return view

    def publish(self, spec: dict[str, JsonValue]) -> str:
        workflow_id = f"itest{uuid.uuid4().hex[:12]}"
        created = self.client.post("/workflows", json={"id": workflow_id, "name": "integration"})
        self.created.append(workflow_id)
        assert created.status_code == 201, created.text
        version = self.client.post(f"/workflows/{workflow_id}/versions", json=spec)
        assert version.status_code == 201, version.text
        return workflow_id

    def start(self, workflow_id: str) -> str:
        response = self.client.post(f"/workflows/{workflow_id}/runs", json={"input": {}})
        assert response.status_code == 202, response.text
        return RunRef.model_validate(response.json()).run_id


@pytest.fixture(scope="module")
def engine(engine_token: str) -> Iterator[EngineClient]:
    require_service("engine", ENGINE_URL)
    headers = {"Authorization": f"Bearer {engine_token}"}
    with httpx.Client(base_url=ENGINE_URL, headers=headers, timeout=REQUEST_TIMEOUT) as client:
        health = client.get("/health")
        if health.status_code != 200 or "app_version" not in health.text:
            message = f"{ENGINE_URL} is not the engine: {health.status_code}"
            if os.environ.get("LIVE_STRICT") == "1":
                pytest.fail(message)
            pytest.skip(message)
        live = EngineClient(client)
        try:
            yield live
        finally:
            for workflow_id in live.created:
                remove_workflow(client, workflow_id)


def _human_spec() -> dict[str, JsonValue]:
    human: dict[str, JsonValue] = {
        "id": "ask",
        "kind": "human",
        "prompt": "Continue?",
        "wait_seconds": 300,
    }
    shipped: dict[str, JsonValue] = {
        "id": "go",
        "kind": "tool",
        "tool": "echo",
        "args": {"value": 1},
    }
    nodes: list[JsonValue] = [{"id": "start", "kind": "trigger"}, human, shipped]
    edges: list[JsonValue] = [
        {"source": "start", "target": "ask"},
        {"source": "ask", "target": "go", "when": "approve"},
    ]
    return {"name": "human", "nodes": nodes, "edges": edges, "entry": "start"}


def _llm_spec() -> dict[str, JsonValue]:
    ask: dict[str, JsonValue] = {
        "id": "ask",
        "kind": "llm",
        "role": "decision",
        "prompt": "Reply with one word: what color is the sky? /no_think",
        "max_tokens": 256,
        "timeout_seconds": 170,
    }
    nodes: list[JsonValue] = [{"id": "start", "kind": "trigger"}, ask]
    edges: list[JsonValue] = [{"source": "start", "target": "ask"}]
    return {"name": "llm", "nodes": nodes, "edges": edges, "entry": "start"}


def test_engine_health_returns_ok(engine: EngineClient) -> None:
    health = Health.model_validate(engine.client.get("/health").json())
    assert health.status == "ok"


def test_engine_creates_a_workflow_and_lists_the_node_catalog(engine: EngineClient) -> None:
    workflow_id = engine.publish(_human_spec())
    listed = engine.client.get("/workflows").json()
    assert workflow_id in {item["id"] for item in listed}
    kinds = {item["kind"] for item in engine.client.get("/nodes").json()["kinds"]}
    assert {"llm", "agent", "human", "map"} <= kinds
    assert engine.client.delete(f"/workflows/{workflow_id}").status_code == 204


def test_engine_runs_an_llm_node_through_litellm(engine: EngineClient) -> None:
    workflow_id = engine.publish(_llm_spec())
    view = engine.wait(engine.start(workflow_id), TERMINAL)
    assert view.summary.status == "succeeded", view.error
    result = RunOutput.model_validate(view.output)
    assert result.output["ask"].text.strip()


def test_engine_human_round_trip_approve(engine: EngineClient) -> None:
    workflow_id = engine.publish(_human_spec())
    run_id = engine.start(workflow_id)
    pending = engine.wait_pending(run_id)
    assert [item.node_id for item in pending.pending_human] == ["ask"]
    body = {"node_id": "ask", "reply": {"action": "approve"}}
    assert engine.client.post(f"/runs/{run_id}/input", json=body).status_code == 202
    view = engine.wait(run_id, TERMINAL)
    assert view.summary.status == "succeeded", view.error


def test_engine_cancel_stops_a_waiting_run(engine: EngineClient) -> None:
    workflow_id = engine.publish(_human_spec())
    run_id = engine.start(workflow_id)
    engine.wait_pending(run_id)
    assert engine.client.post(f"/runs/{run_id}/cancel").status_code == 202
    assert engine.wait(run_id, TERMINAL).summary.status == "cancelled"
