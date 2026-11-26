import httpx
import pytest

from tests.conftest import PHOENIX_URL, require_service

pytestmark = pytest.mark.integration

HEALTH_TIMEOUT = 10.0


def _get_status(url: str) -> int:
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(url)
    return resp.status_code


def test_phoenix_health_returns_200() -> None:
    require_service("phoenix", PHOENIX_URL)
    status = _get_status(f"{PHOENIX_URL}/healthz")
    assert status == 200, f"phoenix health returned {status}"
