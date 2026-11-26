import os
from dataclasses import dataclass
from functools import cache

import pytest

from tests.conftest import LITELLM_URL, container_env, require_service

UPSTREAM = f"{LITELLM_URL}/v1"
HEALTH = f"{LITELLM_URL}/health/liveliness"
PATIENCE_ATTEMPTS = 36_000


@dataclass
class Route:
    base_url: str = UPSTREAM


ROUTE = Route()


@cache
def litellm_key() -> str:
    return os.environ.get("LITELLM_MASTER_KEY", "") or container_env(
        "litellm", "LITELLM_MASTER_KEY"
    )


def require_live() -> None:
    require_service("litellm", HEALTH)
    if not litellm_key():
        message = "The LiteLLM key is not set. Run make setup, then make up."
        if os.environ.get("LIVE_STRICT") == "1":
            pytest.fail(message)
        pytest.skip(message)
