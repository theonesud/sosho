import httpx
import pytest
import yaml
from pydantic import BaseModel

from tests.conftest import LITELLM_URL, ROOT, require_service

pytestmark = pytest.mark.integration

HEALTH_TIMEOUT = 10.0
MODEL_TIMEOUT = 180.0
CLOUD_ROLES = ("main", "subagent", "subagent-code", "cloud-uncensored")


class RoleEntry(BaseModel):
    model_name: str


class LiteLLMConfig(BaseModel):
    model_list: list[RoleEntry]


class ModelEntry(BaseModel):
    id: str


class ModelList(BaseModel):
    data: list[ModelEntry]


class ChatMessage(BaseModel):
    content: str | None = None
    reasoning_content: str | None = None


class ChatChoice(BaseModel):
    message: ChatMessage


class ChatResponse(BaseModel):
    choices: list[ChatChoice]


class EmbeddingItem(BaseModel):
    embedding: list[float]


class EmbeddingResponse(BaseModel):
    data: list[EmbeddingItem]


def _config_roles() -> list[str]:
    text = (ROOT / "docker" / "litellm.yaml").read_text(encoding="utf-8")
    config = LiteLLMConfig.model_validate(yaml.safe_load(text))
    return [entry.model_name for entry in config.model_list]


def _auth(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def _chat_body(role: str) -> dict[str, object]:
    return {
        "model": role,
        "messages": [{"role": "user", "content": "Reply with one word: what color is the sky?"}],
        "max_tokens": 64,
    }


def _assert_chat_answers(role: str, key: str) -> None:
    with httpx.Client(timeout=MODEL_TIMEOUT) as client:
        resp = client.post(
            f"{LITELLM_URL}/v1/chat/completions", json=_chat_body(role), headers=_auth(key)
        )
    assert resp.status_code == 200, f"role {role}: {resp.text}"
    result = ChatResponse.model_validate(resp.json())
    assert result.choices, f"role {role}: no choices in response"
    message = result.choices[0].message
    text = (message.content or "") + (message.reasoning_content or "")
    assert text.strip(), f"role {role}: empty answer"


def test_liveliness_returns_200() -> None:
    require_service("litellm", LITELLM_URL)
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(f"{LITELLM_URL}/health/liveliness")
    assert resp.status_code == 200, resp.text


def test_models_lists_exactly_the_config_roles(litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    expected = set(_config_roles())
    assert len(expected) == 7, f"expected 7 roles in docker/litellm.yaml, found {len(expected)}"
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(f"{LITELLM_URL}/v1/models", headers=_auth(litellm_key))
    assert resp.status_code == 200, resp.text
    listed = {entry.id for entry in ModelList.model_validate(resp.json()).data}
    assert listed == expected, (
        f"missing: {sorted(expected - listed)}, extra: {sorted(listed - expected)}"
    )


def test_request_without_key_is_rejected() -> None:
    require_service("litellm", LITELLM_URL)
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(f"{LITELLM_URL}/v1/models")
    assert resp.status_code in (401, 403), f"unexpected status {resp.status_code}"


def test_chat_decision_role_answers(litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    _assert_chat_answers("decision", litellm_key)


def test_embed_role_returns_vector(litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    body = {"model": "embed", "input": "Sosho integration test."}
    with httpx.Client(timeout=MODEL_TIMEOUT) as client:
        resp = client.post(f"{LITELLM_URL}/v1/embeddings", json=body, headers=_auth(litellm_key))
    assert resp.status_code == 200, resp.text
    vector = EmbeddingResponse.model_validate(resp.json()).data[0].embedding
    assert vector, "embedding vector is empty"


@pytest.mark.heavy
def test_chat_local_uncensored_role_answers(litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    _assert_chat_answers("local-uncensored", litellm_key)


@pytest.mark.cloud
@pytest.mark.parametrize("role", CLOUD_ROLES)
def test_chat_cloud_role_answers(role: str, litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    _assert_chat_answers(role, litellm_key)
