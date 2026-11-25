from collections.abc import Iterator
from pathlib import Path

import pytest
from engine_support import Api, make_runtime
from fastapi.testclient import TestClient
from sosho_engine.api_app import create_app


@pytest.fixture(scope="session")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    db = tmp_path_factory.mktemp("engine") / "engine.sqlite"
    app = create_app(make_runtime(Path(db)))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def api(client: TestClient) -> Api:
    return Api(client)
