from collections.abc import Iterator
from pathlib import Path

import pytest
from engine_support import Api, make_runtime
from fastapi.testclient import TestClient
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


@pytest.fixture(scope="session")
def api(client: TestClient) -> Api:
    return Api(client)


@pytest.fixture(scope="module")
def host_api(client: TestClient, worker: WorkerHandle) -> Api:
    del worker
    return Api(client)
