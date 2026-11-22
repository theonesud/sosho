import os
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent

LLAMA_URL = os.environ.get("SOSHO_LLAMA_URL", "http://127.0.0.1:8080")
LITELLM_URL = os.environ.get("SOSHO_LITELLM_URL", "http://127.0.0.1:4000")
GRAPH_URL = os.environ.get("SOSHO_GRAPH_URL", "http://127.0.0.1:8123")
LANGFUSE_URL = os.environ.get("SOSHO_LANGFUSE_URL", "http://127.0.0.1:3001")
LANGFLOW_URL = os.environ.get("SOSHO_LANGFLOW_URL", "http://127.0.0.1:7860")
STUDIO_API_URL = os.environ.get("SOSHO_STUDIO_API_URL", "http://127.0.0.1:4101")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    del config
    gates = {
        "cloud": ("CLOUD", "cloud model test. Set CLOUD=1 to run it."),
        "heavy": ("HEAVY", "large GPU model test. Set HEAVY=1 to run it."),
    }
    for item in items:
        for marker, (env, reason) in gates.items():
            if marker in item.keywords and os.environ.get(env) != "1":
                item.add_marker(pytest.mark.skip(reason=reason))


def require_service(name: str, url: str) -> None:
    try:
        httpx.get(url, timeout=3.0)
    except httpx.HTTPError as exc:
        msg = f"{name} not running at {url}: {exc}"
        if os.environ.get("LIVE_STRICT") == "1":
            pytest.fail(msg)
        pytest.skip(msg)


@pytest.fixture(scope="session")
def litellm_key() -> str:
    # Never print the key.
    key = os.environ.get("LITELLM_MASTER_KEY", "")
    if key:
        return key
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not found. Cannot read the LiteLLM key.")
    result = subprocess.run(  # noqa: S603
        [docker, "exec", "litellm", "printenv", "LITELLM_MASTER_KEY"],
        capture_output=True,
        text=True,
        check=False,
    )
    key = result.stdout.strip()
    return key or "sk-sosho-local"
