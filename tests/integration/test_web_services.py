import httpx
import pytest

from tests.conftest import LANGFLOW_URL, LANGFUSE_URL, STUDIO_API_URL, require_service

pytestmark = pytest.mark.integration

HEALTH_TIMEOUT = 10.0


def _get_status(url: str) -> int:
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(url)
    return resp.status_code


def test_langfuse_public_health_returns_200() -> None:
    require_service("langfuse", LANGFUSE_URL)
    status = _get_status(f"{LANGFUSE_URL}/api/public/health")
    assert status == 200, f"langfuse health returned {status}"


def test_langflow_health_returns_200() -> None:
    # Langflow can start before its health route answers.
    require_service("langflow", LANGFLOW_URL)
    status = _get_status(f"{LANGFLOW_URL}/health")
    assert status == 200, f"langflow health returned {status}"


def test_studio_health_returns_200_without_token() -> None:
    require_service("studio-api", STUDIO_API_URL)
    # GET routes need no bearer token. Only mutating methods do.
    status = _get_status(f"{STUDIO_API_URL}/health")
    assert status == 200, f"studio health returned {status}"
