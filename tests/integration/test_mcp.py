import json
import os
import queue
import shutil
import subprocess
import threading
from pathlib import Path
from typing import IO

import pytest
from pydantic import BaseModel

from tests.conftest import LITELLM_URL, ROOT, require_service

pytestmark = pytest.mark.integration

START_TIMEOUT_SECONDS = 120.0
CALL_TIMEOUT_SECONDS = 60.0


class ServerSpec(BaseModel):
    command: str
    args: list[str]


class McpConfig(BaseModel):
    mcpServers: dict[str, ServerSpec]  # noqa: N815 - key name comes from the MCP config format.


class Reply(BaseModel):
    id: int | None = None
    result: object = None
    error: object = None


class Tool(BaseModel):
    name: str


class ToolList(BaseModel):
    tools: list[Tool]


class ToolResult(BaseModel):
    content: list[dict[str, object]]
    isError: bool = False  # noqa: N815 - key name comes from the MCP protocol.


def _pump(stream: IO[str], lines: "queue.Queue[str]") -> None:
    for line in stream:
        lines.put(line)


class McpClient:
    def __init__(self, spec: ServerSpec, env: dict[str, str], cwd: Path = ROOT) -> None:
        exe = shutil.which(spec.command)
        if exe is None:
            pytest.skip(f"{spec.command} not found on PATH")
        self._proc = subprocess.Popen(  # noqa: S603
            [exe, *spec.args],
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        assert self._proc.stdout is not None
        self._lines: queue.Queue[str] = queue.Queue()
        threading.Thread(target=_pump, args=(self._proc.stdout, self._lines), daemon=True).start()
        self._next_id = 0

    def request(self, method: str, params: dict[str, object], timeout: float) -> object:
        self._next_id += 1
        self._send({"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params})
        while True:
            reply = Reply.model_validate_json(self._lines.get(timeout=timeout))
            if reply.id == self._next_id:
                assert reply.error is None, f"{method} failed: {reply.error}"
                return reply.result

    def notify(self, method: str) -> None:
        self._send({"jsonrpc": "2.0", "method": method})

    def initialize(self) -> None:
        params: dict[str, object] = {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "sosho-tests", "version": "0.0.0"},
        }
        self.request("initialize", params, START_TIMEOUT_SECONDS)
        self.notify("notifications/initialized")

    def tool_names(self) -> set[str]:
        result = ToolList.model_validate(self.request("tools/list", {}, CALL_TIMEOUT_SECONDS))
        return {tool.name for tool in result.tools}

    def call(self, name: str, arguments: dict[str, object]) -> ToolResult:
        params: dict[str, object] = {"name": name, "arguments": arguments}
        raw = self.request("tools/call", params, CALL_TIMEOUT_SECONDS)
        return ToolResult.model_validate(raw)

    def close(self) -> None:
        self._proc.terminate()
        try:
            self._proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._proc.kill()

    def _send(self, message: dict[str, object]) -> None:
        assert self._proc.stdin is not None
        self._proc.stdin.write(json.dumps(message) + "\n")
        self._proc.stdin.flush()


def _spec(name: str) -> ServerSpec:
    config = McpConfig.model_validate_json((ROOT / ".mcp.json").read_text())
    return config.mcpServers[name]


def _text_of(result: ToolResult) -> str:
    return " ".join(str(part.get("text", "")) for part in result.content)


def test_memory_server_adds_then_finds_a_global_record(tmp_path: Path, litellm_key: str) -> None:
    require_service("litellm", LITELLM_URL)
    env = {
        **os.environ,
        "SOSHO_GLOBAL_MEMORY_DIR": str(tmp_path),
        "LITELLM_MASTER_KEY": litellm_key,
    }
    client = McpClient(_spec("memory"), env)
    try:
        client.initialize()
        assert {"memory_search", "memory_add", "memory_archive"} <= client.tool_names()
        record: dict[str, object] = {
            "scope": "global",
            "type": "semantic",
            "title": "Integration marker",
            "content": "The heron test marker is zebra-quartz-17.",
        }
        added = client.call("memory_add", record)
        assert not added.isError, _text_of(added)
        found = client.call("memory_search", {"query": "zebra-quartz-17", "scope": "global"})
    finally:
        client.close()
    assert "zebra-quartz-17" in _text_of(found)
    assert any("zebra-quartz-17" in f.read_text() for f in tmp_path.rglob("*.md"))


def test_dockerfile_playwright_matches_the_mcp_dependency() -> None:
    npm = shutil.which("npm")
    if npm is None:
        pytest.skip("npm not found on PATH")
    mcp = next(arg for arg in _spec("playwright").args if arg.startswith("@playwright/mcp@"))
    result = subprocess.run(  # noqa: S603
        [npm, "view", mcp, "dependencies.playwright"],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        pytest.skip(f"npm registry not reachable: {result.stderr.strip()}")
    dockerfile = (ROOT / "docker" / "Dockerfile.pi").read_text()
    assert f"playwright@{result.stdout.strip()} install" in dockerfile


def test_playwright_server_opens_a_page_headless(tmp_path: Path) -> None:
    client = McpClient(_spec("playwright"), dict(os.environ), cwd=tmp_path)
    try:
        client.initialize()
        assert {"browser_navigate", "browser_snapshot"} <= client.tool_names()
        page = "data:text/html,<title>sosho</title><h1>heron-page</h1>"
        opened = client.call("browser_navigate", {"url": page})
    finally:
        client.close()
    assert not opened.isError, _text_of(opened)
    assert "heron-page" in _text_of(opened)
