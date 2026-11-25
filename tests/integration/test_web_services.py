import httpx
import pytest

from tests.conftest import LANGFUSE_URL, require_service

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
