import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi.testclient import TestClient
from pydantic import BaseModel, JsonValue
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel
from sosho_engine.lifecycle import build_runtime
from sosho_engine.runtime import Runtime
from sosho_engine.settings import Settings
from sosho_engine.tools import JsonDict, ToolRegistry, builtin_tools

TOKEN = "test-token-0123456789abcdef"  # noqa: S105
AUTH = {"Authorization": f"Bearer {TOKEN}"}
TERMINAL = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
CALLS: Counter[str] = Counter()


def last_prompt(messages: list[ModelMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                    return part.content
    return ""


def _tool_return(messages: list[ModelMessage]) -> str | None:
    for message in messages:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, ToolReturnPart):
                    return str(part.content)
    return None


def _chat(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    del info
    prompt = last_prompt(messages)
    CALLS[f"llm:{prompt}"] += 1
    if prompt.startswith("flaky:") and CALLS[f"llm:{prompt}"] < 3:
        raise RuntimeError("model is flaky")
    if prompt.startswith("json:"):
        return ModelResponse(parts=[TextPart('{"answer": 42, "label": "big"}')])
    return ModelResponse(parts=[TextPart(f"echo:{prompt}")])


def _agent(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    returned = _tool_return(messages)
    if returned is None and info.function_tools:
        name = info.function_tools[0].name
        return ModelResponse(parts=[ToolCallPart(name, {"value": last_prompt(messages)})])
    return ModelResponse(parts=[TextPart(f"agent done:{returned}")])


def fake_models(role: str) -> Model:
    if role == "agent":
        return FunctionModel(_agent, model_name="fake-agent")
    return FunctionModel(_chat, model_name="fake-chat")


class CountParams(BaseModel):
    value: JsonValue = None


class FailParams(BaseModel):
    tag: str
    fail_times: int = 0


async def _count(params: CountParams) -> JsonDict:
    CALLS["tool:count"] += 1
    return {"value": params.value, "calls": CALLS["tool:count"]}


async def _flaky(params: FailParams) -> JsonDict:
    CALLS[f"tool:{params.tag}"] += 1
    if CALLS[f"tool:{params.tag}"] <= params.fail_times:
        raise RuntimeError("tool failed")
    return {"attempts": CALLS[f"tool:{params.tag}"]}


async def _effect(params: CountParams) -> JsonDict:
    CALLS["tool:effect"] += 1
    return {"value": params.value}


def test_tools() -> ToolRegistry:
    registry = builtin_tools()
    registry.register("count", "Count calls.", CountParams, _count)
    registry.register("flaky", "Fail some times.", FailParams, _flaky)
    registry.register("effect", "Side effect.", CountParams, _effect, side_effect=True)
    return registry


def make_runtime(db_path: Path) -> Runtime:
    settings = Settings.model_validate(
        {"db_url": f"sqlite:///{db_path}", "api_token": TOKEN, "app_version": "test"}
    )
    return build_runtime(settings, fake_models, test_tools())


def dig(value: JsonValue, *path: str | int) -> JsonValue:
    current = value
    for step in path:
        if isinstance(current, dict) and isinstance(step, str):
            current = current.get(step)
        elif isinstance(current, list) and isinstance(step, int) and step < len(current):
            current = current[step]
        else:
            return None
    return current


class HttpResponse(Protocol):
    @property
    def status_code(self) -> int: ...

    @property
    def content(self) -> bytes: ...

    @property
    def text(self) -> str: ...

    def json(self) -> JsonValue: ...


@dataclass(frozen=True)
class Reply:
    status: int
    body: JsonValue
    text: str


class Api:
    def __init__(self, client: TestClient) -> None:
        self._client = client

    def _reply(self, response: HttpResponse) -> Reply:
        try:
            body: JsonValue = response.json() if response.content else None
        except ValueError:
            body = None
        return Reply(response.status_code, body, response.text)

    def get(self, path: str, **params: str) -> Reply:
        return self._reply(self._client.get(path, params=params, headers=AUTH))

    def get_with(self, path: str, headers: dict[str, str]) -> Reply:
        return self._reply(self._client.get(path, headers=headers))

    def send(
        self,
        method: str,
        path: str,
        body: JsonValue = None,
        headers: dict[str, str] | None = None,
    ) -> Reply:
        sent = AUTH if headers is None else headers
        return self._reply(self._client.request(method, path, json=body, headers=sent))

    def post(self, path: str, body: JsonValue = None) -> Reply:
        return self.send("POST", path, body)

    def post_as(self, path: str, body: JsonValue, headers: dict[str, str]) -> Reply:
        return self.send("POST", path, body, headers)

    def post_raw(self, path: str, content: bytes, headers: dict[str, str]) -> Reply:
        return self._reply(self._client.post(path, content=content, headers=headers))

    def patch(self, path: str, body: JsonValue) -> Reply:
        return self.send("PATCH", path, body)

    def delete(self, path: str) -> Reply:
        return self.send("DELETE", path)


def wait_terminal(api: Api, run_id: str, attempts: int = 400) -> str:
    status = ""
    for _ in range(attempts):
        status = str(dig(api.get(f"/runs/{run_id}").body, "summary", "status"))
        if status in TERMINAL:
            return status
        time.sleep(0.05)
    return status


def wait_pending(api: Api, run_id: str, attempts: int = 400) -> list[JsonValue]:
    for _ in range(attempts):
        pending = dig(api.get(f"/runs/{run_id}").body, "pending_human")
        if isinstance(pending, list) and pending:
            return pending
        time.sleep(0.05)
    return []


def publish(api: Api, spec: JsonValue, workflow_id: str) -> int:
    created = api.post("/workflows", {"id": workflow_id, "name": workflow_id})
    assert created.status == 201, created.text
    version = api.post(f"/workflows/{workflow_id}/versions", spec)
    assert version.status == 201, version.text
    return int(str(dig(version.body, "version")))


def start(api: Api, workflow_id: str, run_input: JsonDict | None = None, **extra: JsonValue) -> str:
    body: dict[str, JsonValue] = {"input": run_input or {}, **extra}
    response = api.post(f"/workflows/{workflow_id}/runs", body)
    assert response.status == 202, response.text
    return str(dig(response.body, "run_id"))


def run_to_end(
    api: Api, workflow_id: str, run_input: JsonDict | None = None, **extra: JsonValue
) -> JsonValue:
    run_id = start(api, workflow_id, run_input, **extra)
    wait_terminal(api, run_id)
    return api.get(f"/runs/{run_id}").body
