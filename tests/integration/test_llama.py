import configparser

import httpx
import pytest
from pydantic import BaseModel

from tests.conftest import LLAMA_URL, ROOT, require_service

pytestmark = pytest.mark.integration

HEALTH_TIMEOUT = 10.0
MODEL_TIMEOUT = 180.0  # The first call loads the model into memory.
CHAT_MODEL = "Qwen3-1.7B"
HEAVY_CHAT_MODEL = "Qwen3.6-35B-A3B"


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


def _load_presets() -> configparser.ConfigParser:
    text = (ROOT / "docker" / "llama-models.ini").read_text(encoding="utf-8")
    parser = configparser.ConfigParser()
    # The preset file has a `version` line that ini does not accept.
    parser.read_string("[_top]\n" + text)
    parser.remove_section("_top")
    return parser


def _chat_body(model: str) -> dict[str, object]:
    return {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with one word: what color is the sky?"}],
        "max_tokens": 64,
    }


def _post_chat(model: str) -> ChatResponse:
    with httpx.Client(timeout=MODEL_TIMEOUT) as client:
        resp = client.post(f"{LLAMA_URL}/v1/chat/completions", json=_chat_body(model))
    assert resp.status_code == 200, resp.text
    return ChatResponse.model_validate(resp.json())


def _assert_answered(model: str) -> None:
    result = _post_chat(model)
    assert result.choices, "no choices in chat response"
    message = result.choices[0].message
    # Thinking models can fill reasoning_content first.
    text = (message.content or "") + (message.reasoning_content or "")
    assert text.strip(), f"empty answer from {model}"


def test_health_returns_200() -> None:
    require_service("llama-cpp", LLAMA_URL)
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(f"{LLAMA_URL}/health")
    assert resp.status_code == 200, resp.text


def test_models_lists_every_preset_section() -> None:
    require_service("llama-cpp", LLAMA_URL)
    expected = set(_load_presets().sections())
    with httpx.Client(timeout=HEALTH_TIMEOUT) as client:
        resp = client.get(f"{LLAMA_URL}/v1/models")
    assert resp.status_code == 200, resp.text
    listed = {entry.id for entry in ModelList.model_validate(resp.json()).data}
    assert expected <= listed, f"missing from /v1/models: {sorted(expected - listed)}"


def test_chat_qwen3_1_7b_answers() -> None:
    require_service("llama-cpp", LLAMA_URL)
    _assert_answered(CHAT_MODEL)


def test_embedding_model_returns_vector() -> None:
    require_service("llama-cpp", LLAMA_URL)
    parser = _load_presets()
    embed_ids = [s for s in parser.sections() if parser.getboolean(s, "embedding", fallback=False)]
    assert embed_ids, "no preset in docker/llama-models.ini sets embedding = true"
    body = {"model": embed_ids[0], "input": "Sosho integration test."}
    with httpx.Client(timeout=MODEL_TIMEOUT) as client:
        resp = client.post(f"{LLAMA_URL}/v1/embeddings", json=body)
    assert resp.status_code == 200, resp.text
    vector = EmbeddingResponse.model_validate(resp.json()).data[0].embedding
    assert vector, "embedding vector is empty"


@pytest.mark.heavy
def test_chat_35b_model_answers() -> None:
    require_service("llama-cpp", LLAMA_URL)
    _assert_answered(HEAVY_CHAT_MODEL)
