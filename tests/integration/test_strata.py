import json
import os
import shutil
import subprocess
from collections.abc import Mapping

import pytest
from pydantic import BaseModel

pytestmark = pytest.mark.integration

HEALTH_TIMEOUT = 10.0
MODEL_TIMEOUT = 300.0
ALIAS = "Qwen3.6-35B-A3B"


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


class Reply(BaseModel):
    status: int
    text: str


def _strata(
    path: str, body: Mapping[str, object] | None = None, timeout: float = HEALTH_TIMEOUT
) -> Reply:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not found on PATH")
    command = [docker, "exec", "strata", "curl", "-s", "-m", str(int(timeout))]
    command += ["-w", "\n%{http_code}"]
    if body is not None:
        command += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    command.append(f"http://127.0.0.1:8080{path}")
    result = subprocess.run(command, capture_output=True, text=True, check=False)  # noqa: S603
    text, _, code = result.stdout.rpartition("\n")
    if not code.isdigit() or int(code) == 0:
        msg = f"strata not reachable through docker exec: {result.stderr.strip()}"
        if os.environ.get("LIVE_STRICT") == "1":
            pytest.fail(msg)
        pytest.skip(msg)
    return Reply(status=int(code), text=text)


def test_health_returns_200() -> None:
    resp = _strata("/health")
    assert resp.status == 200, resp.text


def test_models_lists_the_alias() -> None:
    resp = _strata("/v1/models")
    assert resp.status == 200, resp.text
    listed = {entry.id for entry in ModelList.model_validate_json(resp.text).data}
    assert listed == {ALIAS}, f"unexpected model ids: {sorted(listed)}"


def test_chat_answers_with_the_alias() -> None:
    body = {
        "model": ALIAS,
        "messages": [{"role": "user", "content": "Reply with one word: what color is the sky?"}],
        "max_tokens": 256,
    }
    resp = _strata("/v1/chat/completions", body, MODEL_TIMEOUT)
    assert resp.status == 200, resp.text
    message = ChatResponse.model_validate_json(resp.text).choices[0].message
    text = (message.content or "") + (message.reasoning_content or "")
    assert text.strip(), "empty answer from strata"
