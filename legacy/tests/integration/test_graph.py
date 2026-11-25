import time

import httpx
import pytest
from pydantic import BaseModel

from tests.conftest import GRAPH_URL, require_service

pytestmark = pytest.mark.integration

RUN_TIMEOUT_SECONDS = 180.0


class RunAccepted(BaseModel):
    run_id: str
    status: str


class CatalogEntry(BaseModel):
    type_id: str


class Catalog(BaseModel):
    nodes: list[CatalogEntry]


class RunDetail(BaseModel):
    status: str
    data: dict[str, object] = {}


def _node(node_id: str, node_type: str, **extra: object) -> dict[str, object]:
    return {"id": node_id, "type": node_type, "label": node_id, **extra}


def _graph(
    nodes: list[dict[str, object]], edges: list[tuple[str, str, str | None]]
) -> dict[str, object]:
    edge_list: list[dict[str, object]] = []
    for index, (source, target, condition) in enumerate(edges, start=1):
        edge: dict[str, object] = {"id": f"e{index}", "source": source, "target": target}
        if condition is not None:
            edge["condition"] = condition
        edge_list.append(edge)
    return {
        "id": "integration-graph",
        "name": "Integration graph",
        "entryNode": "start",
        "maxSteps": 20,
        "nodes": nodes,
        "edges": edge_list,
    }


def _review_graph() -> dict[str, object]:
    return _graph(
        [
            _node("start", "start"),
            _node("review", "checkpoint", message="Review"),
            _node("finish", "end"),
        ],
        [("start", "review", None), ("review", "finish", "approve")],
    )


def _wait_for(client: httpx.Client, run_id: str, wanted: set[str]) -> RunDetail:
    deadline = time.monotonic() + RUN_TIMEOUT_SECONDS
    detail = RunDetail(status="unknown")
    while time.monotonic() < deadline:
        detail = RunDetail.model_validate(client.get(f"/runs/{run_id}").json())
        if detail.status in wanted:
            return detail
        time.sleep(0.5)
    pytest.fail(f"run {run_id} stayed in status {detail.status!r}")


@pytest.fixture
def client() -> httpx.Client:
    require_service("graph", f"{GRAPH_URL}/health")
    return httpx.Client(base_url=GRAPH_URL, timeout=10.0)


def test_health_reports_ok(client: httpx.Client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_node_catalog_lists_the_core_kinds(client: httpx.Client) -> None:
    catalog = Catalog.model_validate(client.get("/nodes").json())
    type_ids = {entry.type_id for entry in catalog.nodes}
    assert {"start", "end", "agent", "checkpoint"} <= type_ids


def test_validate_accepts_a_good_graph(client: httpx.Client) -> None:
    response = client.post("/graphs/validate", json=_review_graph())
    assert response.json() == {"valid": True, "errors": []}


def test_checkpoint_run_waits_then_completes_after_resume(client: httpx.Client) -> None:
    started = client.post("/runs", json={"graph": _review_graph(), "input": {}})
    assert started.status_code == 202
    run_id = RunAccepted.model_validate(started.json()).run_id
    _wait_for(client, run_id, {"waiting_checkpoint"})
    resumed = client.post(f"/runs/{run_id}/resume", json={"action": "approve", "nodeId": "review"})
    assert resumed.status_code == 202
    assert _wait_for(client, run_id, {"completed", "failed"}).status == "completed"


def test_agent_run_calls_the_local_decision_model(client: httpx.Client) -> None:
    agent = _node(
        "answer",
        "agent",
        promptTemplate="Reply with the single word: {{word}}",
        tier="decision",
        outputKey="answer",
    )
    graph = _graph([_node("start", "start"), agent], [("start", "answer", None)])
    started = client.post("/runs", json={"graph": graph, "input": {"word": "river"}})
    assert started.status_code == 202
    run_id = RunAccepted.model_validate(started.json()).run_id
    detail = _wait_for(client, run_id, {"completed", "failed"})
    assert detail.status == "completed"
    answer = detail.data.get("answer")
    assert isinstance(answer, str)
    assert answer.strip()
