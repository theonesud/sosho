import configparser
import json
import os
import shutil
import subprocess
from collections.abc import Mapping

import pytest
from pydantic import BaseModel

from tests.conftest import ROOT

pytestmark = pytest.mark.integration

HEALTH_TIMEOUT = 10.0
MODEL_TIMEOUT = 180.0
CHAT_MODEL = "Qwen3-1.7B"


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


class LlamaReply(BaseModel):
    status: int
    text: str


def _llama(
    path: str, body: Mapping[str, object] | None = None, timeout: float = HEALTH_TIMEOUT
) -> LlamaReply:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not found on PATH")
    seconds = str(int(timeout))
    command = [docker, "exec", "llama-cpp", "curl", "-s", "-m", seconds]
    command += ["-w", "\n%{http_code}"]
    if body is not None:
        command += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    command.append(f"http://127.0.0.1:8080{path}")
    result = subprocess.run(command, capture_output=True, text=True, check=False)  # noqa: S603
    text, _, code = result.stdout.rpartition("\n")
    if not code.isdigit() or int(code) == 0:
        msg = f"llama-cpp not reachable through docker exec: {result.stderr.strip()}"
        if os.environ.get("LIVE_STRICT") == "1":
            pytest.fail(msg)
        pytest.skip(msg)
    return LlamaReply(status=int(code), text=text)


def _load_presets() -> configparser.ConfigParser:
    text = (ROOT / "docker" / "llama-models.ini").read_text(encoding="utf-8")
    parser = configparser.ConfigParser()
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
    resp = _llama("/v1/chat/completions", _chat_body(model), MODEL_TIMEOUT)
    assert resp.status == 200, resp.text
    return ChatResponse.model_validate_json(resp.text)


def _assert_answered(model: str) -> None:
    result = _post_chat(model)
    assert result.choices, "no choices in chat response"
    message = result.choices[0].message
    text = (message.content or "") + (message.reasoning_content or "")
    assert text.strip(), f"empty answer from {model}"


def test_health_returns_200() -> None:
    resp = _llama("/health")
    assert resp.status == 200, resp.text


def test_models_lists_every_preset_section_and_no_gpu_model() -> None:
    expected = set(_load_presets().sections())
    resp = _llama("/v1/models")
    assert resp.status == 200, resp.text
    listed = {entry.id for entry in ModelList.model_validate_json(resp.text).data}
    assert expected <= listed, f"missing from /v1/models: {sorted(expected - listed)}"
    assert "Qwen3.6-35B-A3B" not in listed, "llama-cpp still lists the GPU model"


def test_chat_qwen3_1_7b_answers() -> None:
    _assert_answered(CHAT_MODEL)


def test_embedding_model_returns_vector() -> None:
    parser = _load_presets()
    embed_ids = [s for s in parser.sections() if parser.getboolean(s, "embedding", fallback=False)]
    assert embed_ids, "no preset in docker/llama-models.ini sets embedding = true"
    body = {"model": embed_ids[0], "input": "Sosho integration test."}
    resp = _llama("/v1/embeddings", body, MODEL_TIMEOUT)
    assert resp.status == 200, resp.text
    vector = EmbeddingResponse.model_validate_json(resp.text).data[0].embedding
    assert vector, "embedding vector is empty"
