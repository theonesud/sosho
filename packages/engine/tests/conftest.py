from collections.abc import Iterator
from pathlib import Path

import pytest
from engine_support import Api, make_runtime
from fastapi.testclient import TestClient
from live_support import PATIENCE_ATTEMPTS, require_live
from sosho_engine.api_app import create_app
from worker_support import WorkerEnv, WorkerHandle, make_worker_env, wait_alive


@pytest.fixture(scope="session")
def db_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("engine") / "engine.sqlite"


@pytest.fixture(scope="session")
def worker_env(tmp_path_factory: pytest.TempPathFactory) -> WorkerEnv:
    return make_worker_env(tmp_path_factory.mktemp("host"))


@pytest.fixture(scope="session")
def client(db_path: Path) -> Iterator[TestClient]:
    dist = db_path.parent / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>sosho</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    app = create_app(make_runtime(db_path))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def worker(client: TestClient, db_path: Path, worker_env: WorkerEnv) -> Iterator[WorkerHandle]:
    handle = WorkerHandle(worker_env, db_path)
    handle.start()
    assert wait_alive(client), "the host worker did not start"
    yield handle
    handle.stop()


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if "live_stack" in getattr(item, "fixturenames", ()):
            item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
def live_stack() -> None:
    require_live()


@pytest.fixture(scope="session")
def api(client: TestClient) -> Api:
    return Api(client)


@pytest.fixture(scope="session")
def live_api(client: TestClient, live_stack: None) -> Api:
    del live_stack
    return Api(client, PATIENCE_ATTEMPTS)


@pytest.fixture(scope="module")
def host_api(client: TestClient, worker: WorkerHandle) -> Api:
    del worker
    return Api(client)


@pytest.fixture(scope="module")
def live_host_api(live_stack: None, client: TestClient, worker: WorkerHandle) -> Api:
    del worker, live_stack
    return Api(client, PATIENCE_ATTEMPTS)
