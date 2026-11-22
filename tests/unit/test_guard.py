import json
import subprocess
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from tests.conftest import ROOT

GUARD = ROOT / "bin" / "agent-guard.sh"
HOOK = ROOT / "bin" / "agent-hook-antigravity.sh"
TIMEOUT_SECONDS = 10

Payload = dict[str, object]

# Built by concatenation so the literal shell text is not in this file.
CAT_ENV = "cat " + ".env"
CAT_ENV_EXAMPLE = "cat " + ".env.example"
REDIRECT_INTO_ENV = "echo TOKEN=x > " + ".env"
DOCKER_SOCKET = "/var/run/docker.sock"
DOCKER_SOCKET_MOUNT = "docker run -v " + DOCKER_SOCKET + ":" + DOCKER_SOCKET + " alpine"

MODEL_CONFIG_PATHS: tuple[str, ...] = (".pi/models.json", ".pi/model-roles.json")
KEY_MATERIAL_PATHS: tuple[str, ...] = ("certs/server.pem", "certs/server.key")


@dataclass(frozen=True)
class Agent:
    name: str
    read: Callable[[str], Payload]
    write: Callable[[str, str], Payload]
    edit: Callable[[str, str], Payload]
    command: Callable[[str], Payload]


AGENTS: tuple[Agent, ...] = (
    Agent(
        name="claude_code",
        read=lambda p: {"tool_name": "Read", "tool_input": {"file_path": p}},
        write=lambda p, t: {"tool_name": "Write", "tool_input": {"file_path": p, "content": t}},
        edit=lambda p, t: {"tool_name": "Edit", "tool_input": {"file_path": p, "new_string": t}},
        command=lambda c: {"tool_name": "Bash", "tool_input": {"command": c}},
    ),
    Agent(
        name="pi",
        read=lambda p: {"toolName": "read", "input": {"path": p}},
        write=lambda p, t: {"toolName": "write", "input": {"path": p, "content": t}},
        edit=lambda p, t: {"toolName": "edit", "input": {"path": p, "newText": t}},
        command=lambda c: {"toolName": "bash", "input": {"command": c}},
    ),
    Agent(
        name="opencode",
        read=lambda p: {"tool": "read", "args": {"filePath": p}},
        write=lambda p, t: {"tool": "write", "args": {"filePath": p, "content": t}},
        edit=lambda p, t: {"tool": "edit", "args": {"filePath": p, "newString": t}},
        command=lambda c: {"tool": "bash", "args": {"command": c}},
    ),
    Agent(
        name="antigravity",
        read=lambda p: {"tool_name": "view_file", "tool_input": {"AbsolutePath": p}},
        write=lambda p, t: {
            "tool_name": "write_to_file",
            "tool_input": {"TargetFile": p, "CodeContent": t},
        },
        edit=lambda p, t: {
            "tool_name": "replace_file_content",
            "tool_input": {"TargetFile": p, "CodeContent": t},
        },
        command=lambda c: {"tool_name": "run_command", "tool_input": {"CommandLine": c}},
    ),
)
AGENT_IDS: list[str] = [agent.name for agent in AGENTS]


def run_script(args: list[str], stdin: str) -> subprocess.CompletedProcess[str]:
    # No shell runs, so input cannot reach a shell.
    return subprocess.run(  # noqa: S603
        args,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
        check=False,
    )


def run_guard(payload: Payload) -> subprocess.CompletedProcess[str]:
    return run_script([str(GUARD)], json.dumps(payload))


def assert_blocked(result: subprocess.CompletedProcess[str]) -> None:
    assert result.returncode == 2, result.stderr
    assert result.stderr.strip(), "a blocked action must give a reason on stderr"


def assert_allowed(result: subprocess.CompletedProcess[str]) -> None:
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_read_of_env_file_is_blocked(agent: Agent) -> None:
    assert_blocked(run_guard(agent.read(".env")))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_read_of_env_example_is_allowed(agent: Agent) -> None:
    assert_allowed(run_guard(agent.read(".env.example")))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
@pytest.mark.parametrize("path", MODEL_CONFIG_PATHS)
def test_edit_of_pi_model_config_is_blocked(agent: Agent, path: str) -> None:
    assert_blocked(run_guard(agent.edit(path, "{}")))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
@pytest.mark.parametrize("path", KEY_MATERIAL_PATHS)
def test_write_to_key_material_is_blocked(agent: Agent, path: str) -> None:
    assert_blocked(run_guard(agent.write(path, "secret")))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_edit_of_source_file_is_allowed(agent: Agent) -> None:
    assert_allowed(run_guard(agent.edit("src/app.py", "print('hi')")))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_edit_of_compose_file_with_docker_socket_is_blocked(agent: Agent) -> None:
    assert_blocked(run_guard(agent.edit("compose.yaml", "- " + DOCKER_SOCKET)))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_shell_cat_of_env_is_blocked(agent: Agent) -> None:
    assert_blocked(run_guard(agent.command(CAT_ENV)))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_shell_cat_of_env_example_is_allowed(agent: Agent) -> None:
    assert_allowed(run_guard(agent.command(CAT_ENV_EXAMPLE)))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_shell_redirect_into_env_is_blocked(agent: Agent) -> None:
    assert_blocked(run_guard(agent.command(REDIRECT_INTO_ENV)))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_shell_ls_is_allowed(agent: Agent) -> None:
    assert_allowed(run_guard(agent.command("ls -la")))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_shell_docker_socket_mount_is_blocked(agent: Agent) -> None:
    assert_blocked(run_guard(agent.command(DOCKER_SOCKET_MOUNT)))


@pytest.mark.parametrize("agent", AGENTS, ids=AGENT_IDS)
def test_shell_docker_ps_is_allowed(agent: Agent) -> None:
    assert_allowed(run_guard(agent.command("docker ps")))


@pytest.mark.parametrize("stdin", ["", "{not json", "[]"], ids=["empty", "invalid_json", "list"])
def test_unreadable_payload_is_allowed(stdin: str) -> None:
    assert_allowed(run_script([str(GUARD)], stdin))


def run_hook_pre(payload: Payload) -> subprocess.CompletedProcess[str]:
    return run_script([str(HOOK), "pre"], json.dumps(payload))


def test_antigravity_hook_denies_write_to_pem_file() -> None:
    result = run_hook_pre(
        {
            "toolCall": {
                "name": "write_to_file",
                "args": {"TargetFile": "certs/server.pem", "CodeContent": "x"},
            }
        }
    )
    assert result.returncode == 0, result.stderr
    # Antigravity reads the deny object from stdout.
    reply: dict[str, str] = json.loads(result.stdout)
    assert reply["decision"] == "deny"
    assert reply["reason"].startswith("BLOCKED:")


def test_antigravity_hook_denies_view_of_env_file() -> None:
    result = run_hook_pre(
        {"toolCall": {"name": "view_file", "args": {"AbsolutePath": ".env"}}},
    )
    assert result.returncode == 0, result.stderr
    reply: dict[str, str] = json.loads(result.stdout)
    assert reply["decision"] == "deny"
    assert reply["reason"].startswith("BLOCKED:")


def test_antigravity_hook_allows_ls_and_prints_nothing() -> None:
    result = run_hook_pre(
        {"toolCall": {"name": "run_command", "args": {"CommandLine": "ls -la"}}},
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
