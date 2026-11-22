import json
import subprocess
from pathlib import Path

import pytest

from tests.conftest import ROOT

GUARD = ROOT / "bin" / "agent-guard.py"
TIMEOUT_SECONDS = 10
ENV = "." + "env"

BLOCKED_COMMANDS: tuple[str, ...] = (
    f"grep . {ENV}",
    f"awk 1 {ENV}",
    f"sort {ENV}",
    f"python3 -c \"print(open('{ENV}').read())\"",
    f"cat ./{ENV}",
    f"cat $HOME/project/{ENV}",
    f"cat apps/web/{ENV}.local",
    f"docker run --env-file={ENV} alpine",
    f"cp {ENV} /tmp/copy",
    'cat ".e""nv"',
    "cat .\\e\\nv",
    "cat .e$''nv",
    "cat .e*",
    "cat .en?",
    "cat .[e]nv",
    "cat .{env,x}",
    "cat ~/.ssh/id_rsa",
    "cat ~/.aws/credentials",
    "cat ~/.netrc",
    "base64 certs/server.key",
    "cat certs/*.pem",
    "grep -r TOKEN .",
    "grep -Rn TOKEN .",
    "grep --recursive TOKEN .",
    "rg --no-ignore TOKEN",
    "rg -uu TOKEN",
    "docker compose config",
    "docker-compose -f compose.yaml config",
)

ALLOWED_COMMANDS: tuple[str, ...] = (
    f"cat {ENV}.example",
    "rg TOKEN",
    "rg --hidden TOKEN",
    "grep -n TOKEN src/app.py",
    "ls -la",
    "node -e 'console.log(process.env.HOME)'",
    "source .venv/bin/activate",
    "jq .key data.json",
    "git diff",
    "cat src/*.py",
    "docker compose ps",
)


def run_guard(payload: dict[str, object]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [str(GUARD)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
        check=False,
    )


def bash(command: str, cwd: Path | None = None) -> dict[str, object]:
    payload: dict[str, object] = {"tool_name": "Bash", "tool_input": {"command": command}}
    if cwd is not None:
        payload["cwd"] = str(cwd)
    return payload


@pytest.mark.parametrize("command", BLOCKED_COMMANDS)
def test_shell_access_to_secret_file_is_blocked(command: str) -> None:
    result = run_guard(bash(command))
    assert result.returncode == 2, command
    assert result.stderr.startswith("BLOCKED:")


@pytest.mark.parametrize("command", ALLOWED_COMMANDS)
def test_shell_command_without_secret_access_is_allowed(command: str) -> None:
    result = run_guard(bash(command))
    assert result.returncode == 0, result.stderr


def test_shell_glob_that_expands_to_secret_file_is_blocked(tmp_path: Path) -> None:
    (tmp_path / "server.pem").write_text("x")
    assert run_guard(bash("cat *", tmp_path)).returncode == 2


def test_shell_glob_without_secret_file_is_allowed(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("x")
    assert run_guard(bash("cat *", tmp_path)).returncode == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"tool_name": "Grep", "tool_input": {"pattern": "x", "glob": ENV + "*"}},
        {"tool_name": "Grep", "tool_input": {"pattern": "x", "path": ENV}},
        {"tool": "grep", "args": {"pattern": "x", "include": ENV}},
        {"tool_name": "grep_search", "tool_input": {"Query": "x", "Includes": [ENV]}},
    ],
    ids=["claude_glob", "claude_path", "opencode_include", "antigravity_includes"],
)
def test_search_tool_on_secret_file_is_blocked(payload: dict[str, object]) -> None:
    assert run_guard(payload).returncode == 2


def test_search_tool_for_env_text_in_code_is_allowed() -> None:
    payload: dict[str, object] = {
        "tool_name": "Grep",
        "tool_input": {"pattern": ENV, "glob": "*.py"},
    }
    assert run_guard(payload).returncode == 0


def test_edit_with_env_name_in_content_is_allowed() -> None:
    payload: dict[str, object] = {
        "tool_name": "Edit",
        "tool_input": {"file_path": "src/app.py", "new_string": f"load('{ENV}')"},
    }
    assert run_guard(payload).returncode == 0
