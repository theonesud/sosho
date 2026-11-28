import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
from pydantic import BaseModel, JsonValue

from tests.conftest import ENGINE_URL, remove_workflow, require_service

pytestmark = pytest.mark.integration

UNIT = "sosho-worker.service"
POSTGRES_PORT = int(os.environ.get("SOSHO_POSTGRES_PORT") or "5432")
TERMINAL = {"succeeded", "failed", "cancelled"}
POLL_ATTEMPTS = 3000


class WorkerState(BaseModel):
    alive: bool
    version: str | None


class Health(BaseModel):
    app_version: str
    worker: WorkerState


class Summary(BaseModel):
    status: str


class RunView(BaseModel):
    summary: Summary
    output: JsonValue = None
    error: str | None = None


class Engine:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client
        self.created: list[str] = []

    def health(self) -> Health:
        return Health.model_validate(self.client.get("/health").json())

    def publish(self, node: dict[str, JsonValue]) -> str:
        workflow_id = f"wk{uuid.uuid4().hex[:12]}"
        self.created.append(workflow_id)
        assert (
            self.client.post("/workflows", json={"id": workflow_id, "name": "w"}).status_code == 201
        )
        nodes: list[JsonValue] = [{"id": "start", "kind": "trigger"}, node]
        edges: list[JsonValue] = [{"source": "start", "target": "n"}]
        spec = {"name": "w", "nodes": nodes, "edges": edges, "entry": "start"}
        created = self.client.post(f"/workflows/{workflow_id}/versions", json=spec)
        assert created.status_code == 201, created.text
        return workflow_id

    def run(self, workflow_id: str, limit_seconds: float) -> RunView:
        started = self.client.post(f"/workflows/{workflow_id}/runs", json={"input": {}})
        assert started.status_code == 202, started.text
        run_id = started.json()["run_id"]
        deadline = time.monotonic() + limit_seconds
        view = RunView.model_validate(self.client.get(f"/runs/{run_id}").json())
        while view.summary.status not in TERMINAL and time.monotonic() < deadline:
            time.sleep(0.3)
            view = RunView.model_validate(self.client.get(f"/runs/{run_id}").json())
        return view


def _docker_env(name: str) -> str:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not found. Cannot read the engine settings.")
    result = subprocess.run(  # noqa: S603
        [docker, "exec", "engine", "printenv", name], capture_output=True, text=True, check=False
    )
    return result.stdout.strip()


def _host_db_url() -> str:
    url = _docker_env("SOSHO_ENGINE_DB_URL")
    if not url:
        pytest.skip("The engine database URL is not set. Run make up.")
    parts = urlsplit(url)
    return url.replace(parts.netloc, f"{parts.netloc.rsplit('@', 1)[0]}@127.0.0.1:{POSTGRES_PORT}")


def _require_postgres() -> None:
    try:
        socket.create_connection(("127.0.0.1", POSTGRES_PORT), timeout=3).close()
    except OSError as exc:
        message = f"Postgres is not published on 127.0.0.1:{POSTGRES_PORT}: {exc}. Run make up."
        if os.environ.get("LIVE_STRICT") == "1":
            pytest.fail(message)
        pytest.skip(message)


def _unit_active() -> bool:
    systemctl = shutil.which("systemctl")
    if systemctl is None:
        return False
    return (
        subprocess.run(  # noqa: S603
            [systemctl, "--user", "is-active", "--quiet", UNIT], check=False
        ).returncode
        == 0
    )


def _spawn(engine_token: str, version: str, extra: dict[str, str]) -> subprocess.Popen[bytes]:
    env = {
        **os.environ,
        "SOSHO_ENGINE_DB_URL": _host_db_url(),
        "SOSHO_ENGINE_API_TOKEN": engine_token,
        "SOSHO_ENGINE_APP_VERSION": version,
        "SOSHO_ENGINE_WORKER_BEAT_SECONDS": "1",
        **extra,
    }
    return subprocess.Popen(
        [sys.executable, "-m", "sosho_engine", "worker"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _wait_alive(engine: Engine) -> None:
    for _ in range(300):
        if engine.health().worker.alive:
            return
        time.sleep(0.2)
    pytest.fail("no host worker with the engine version answered")


@pytest.fixture(scope="module")
def engine(engine_token: str) -> Iterator[Engine]:
    require_service("engine", ENGINE_URL)
    _require_postgres()
    headers = {"Authorization": f"Bearer {engine_token}"}
    with httpx.Client(base_url=ENGINE_URL, headers=headers, timeout=20.0) as client:
        live = Engine(client)
        try:
            yield live
        finally:
            for workflow_id in live.created:
                remove_workflow(client, workflow_id)


@pytest.fixture
def real_worker(engine: Engine, engine_token: str) -> Iterator[None]:
    if _unit_active() and engine.health().worker.alive:
        yield
        return
    process = _spawn(engine_token, engine.health().app_version, {})
    try:
        _wait_alive(engine)
        yield
    finally:
        process.terminate()
        process.wait(timeout=30)


def _first_skill(engine: Engine) -> str:
    skills = engine.client.get("/nodes").json()["skills"]
    assert skills, "the skill catalog is empty"
    return str(skills[0])


def test_agent_node_routes_through_postgres_and_runs_pi_on_the_local_model(
    engine: Engine, real_worker: None
) -> None:
    del real_worker
    skill = _first_skill(engine)
    prompt = (
        "Create a file named hello.txt in the current directory that contains the word hi. "
        "Then reply with exactly DONE."
    )
    node: dict[str, JsonValue] = {
        "id": "n",
        "kind": "agent",
        "role": "local-uncensored",
        "thinking": "off",
        "prompt": prompt,
        "skills": [skill],
        "timeout_seconds": 900,
        "max_turns": 12,
    }
    view = engine.run(engine.publish(node), 1000)
    assert view.summary.status == "succeeded", view.error
    output = view.output
    assert isinstance(output, dict)
    result = output["output"]
    assert isinstance(result, dict)
    node_out = result["n"]
    assert isinstance(node_out, dict)
    assert "DONE" in str(node_out["text"])
    workdir = Path(str(node_out["workdir"]))
    assert (workdir / "hello.txt").is_file()
    assert (workdir / ".agents" / "skills" / skill).is_symlink()
