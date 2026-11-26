import os
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent

LITELLM_URL = os.environ.get("SOSHO_LITELLM_URL", "http://127.0.0.1:4000")
PHOENIX_URL = os.environ.get("SOSHO_PHOENIX_URL", "http://127.0.0.1:6006")
ENGINE_URL = os.environ.get("SOSHO_ENGINE_URL", "http://127.0.0.1:8123")


def require_service(name: str, url: str) -> None:
    try:
        httpx.get(url, timeout=3.0)
    except httpx.HTTPError as exc:
        msg = f"{name} not running at {url}: {exc}"
        if os.environ.get("LIVE_STRICT") == "1":
            pytest.fail(msg)
        pytest.skip(msg)


def container_env(container: str, name: str) -> str:
    docker = shutil.which("docker")
    if docker is None:
        return ""
    result = subprocess.run(  # noqa: S603
        [docker, "exec", container, "printenv", name],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip()


@pytest.fixture(scope="session")
def litellm_key() -> str:
    key = os.environ.get("LITELLM_MASTER_KEY", "") or container_env("litellm", "LITELLM_MASTER_KEY")
    if not key:
        pytest.skip("The LiteLLM key is not set. Run make setup, then make up.")
    return key


@pytest.fixture(scope="session")
def engine_token() -> str:
    token = os.environ.get("SOSHO_ENGINE_API_TOKEN", "") or container_env(
        "engine", "SOSHO_ENGINE_API_TOKEN"
    )
    if not token:
        pytest.skip("The engine token is not set. Run make setup, then make up.")
    return token
