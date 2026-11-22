import os
import shutil
import subprocess
import time
import uuid
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import BaseModel

from tests.conftest import GRAPH_URL, LANGFUSE_URL, require_service

pytestmark = pytest.mark.integration

# Langfuse ingests events in batches, so a trace shows up after a delay.
TRACE_TIMEOUT_SECONDS = 90.0
RUN_TIMEOUT_SECONDS = 180.0


class Observation(BaseModel):
    name: str | None = None
    type: str


class ObservationPage(BaseModel):
    data: list[Observation]


class RunState(BaseModel):
    run_id: str
    status: str


def _graph_env(name: str) -> str:
    # Never print the key.
    value = os.environ.get(name, "")
    docker = shutil.which("docker")
    if value or docker is None:
        return value
    result = subprocess.run(  # noqa: S603
        [docker, "exec", "sosho-graph", "printenv", name],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip()


def _run_agent_graph(node_id: str) -> None:
    agent = {
        "id": node_id,
        "type": "agent",
        "label": node_id,
        "promptTemplate": "Reply with one word.",
        "tier": "decision",
        "outputKey": "answer",
    }
    graph = {
        "id": "trace-graph",
        "name": "Trace graph",
        "entryNode": "start",
        "maxSteps": 10,
        "nodes": [{"id": "start", "type": "start", "label": "start"}, agent],
        "edges": [{"id": "e1", "source": "start", "target": node_id}],
    }
    with httpx.Client(base_url=GRAPH_URL, timeout=10.0) as client:
        started = client.post("/runs", json={"graph": graph, "input": {}})
        run_id = RunState.model_validate(started.json()).run_id
        deadline = time.monotonic() + RUN_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            state = RunState.model_validate(client.get(f"/runs/{run_id}").json())
            if state.status in {"completed", "failed"}:
                assert state.status == "completed"
                return
            time.sleep(0.5)
    pytest.fail(f"run {run_id} did not finish")


def test_graph_run_sends_a_node_span_to_langfuse() -> None:
    require_service("graph", f"{GRAPH_URL}/health")
    require_service("Langfuse", f"{LANGFUSE_URL}/api/public/health")
    auth = (_graph_env("LANGFUSE_PUBLIC_KEY"), _graph_env("LANGFUSE_SECRET_KEY"))
    node_id = f"trace-{uuid.uuid4().hex[:12]}"
    since = datetime.now(UTC).isoformat()
    _run_agent_graph(node_id)
    deadline = time.monotonic() + TRACE_TIMEOUT_SECONDS
    names: set[str | None] = set()
    while time.monotonic() < deadline:
        # Langfuse v4 runs in events_only mode, so read from the v2 observations endpoint.
        response = httpx.get(
            f"{LANGFUSE_URL}/api/public/v2/observations",
            params={"limit": 100, "fromStartTime": since},
            auth=auth,
            timeout=10.0,
        )
        assert response.status_code == 200
        names = {obs.name for obs in ObservationPage.model_validate(response.json()).data}
        if node_id in names:
            return
        time.sleep(3)
    pytest.fail(f"no span named {node_id} in Langfuse. Names seen: {sorted(map(str, names))}")
