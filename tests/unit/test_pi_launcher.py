import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

from tests.conftest import ROOT

LAUNCHER = ROOT / "bin" / "pi-launcher.sh"
CALL_END = "--end-of-call--"
BASH = shutil.which("bash") or "/bin/bash"

FAKE_TEMPLATE = """#!/usr/bin/env bash
for a in "$@"; do printf '%s\\n' "$a" >> "{log}"; done
printf '%s\\n' "{end}" >> "{log}"
{extra}
exit 0
"""


@dataclass(frozen=True)
class Sandbox:
    home: Path
    workspace: Path
    bin_dir: Path
    docker_log: Path
    pi_log: Path


def _write_fake(path: Path, log: Path, extra: str = "") -> None:
    path.write_text(FAKE_TEMPLATE.format(log=log, end=CALL_END, extra=extra))
    path.chmod(0o755)


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    box = Sandbox(
        home=tmp_path / "home",
        workspace=tmp_path / "root" / "ws",
        bin_dir=tmp_path / "bin",
        docker_log=tmp_path / "docker.log",
        pi_log=tmp_path / "pi.log",
    )
    for folder in (box.home, box.workspace, box.bin_dir):
        folder.mkdir(parents=True)
    _write_fake(box.bin_dir / "docker", box.docker_log)
    _write_fake(box.bin_dir / "pi", box.pi_log, 'printf "%s\\n" "$LITELLM_BASE_URL"')
    return box


def _run(
    box: Sandbox, args: list[str], extra_env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    # A temp SOSHO_ROOT keeps the real .pi config and env files out of the test.
    env = {
        "PATH": f"{box.bin_dir}:/usr/bin:/bin",
        "HOME": str(box.home),
        "SOSHO_ROOT": str(box.workspace.parent),
        "PI_SKIP_WARMUP": "1",
        **(extra_env or {}),
    }
    return subprocess.run(  # noqa: S603
        [BASH, str(LAUNCHER), *args],
        cwd=box.workspace,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def _calls(log: Path) -> list[list[str]]:
    calls: list[list[str]] = [[]]
    for line in log.read_text().splitlines():
        if line == CALL_END:
            calls.append([])
        else:
            calls[-1].append(line)
    return [call for call in calls if call]


def _docker_run_args(box: Sandbox) -> list[str]:
    runs = [call for call in _calls(box.docker_log) if call[0] == "run"]
    assert len(runs) == 1, f"expected one docker run, got {runs}"
    return runs[0]


def test_help_lists_both_modes_and_starts_nothing(sandbox: Sandbox) -> None:
    result = _run(sandbox, ["--help"])
    assert result.returncode == 0
    assert "container (default)" in result.stdout
    assert "raw" in result.stdout
    assert not sandbox.docker_log.exists()


def test_unknown_mode_fails(sandbox: Sandbox) -> None:
    result = _run(sandbox, ["hello"], {"PI_MODE": "vm"})
    assert result.returncode == 1
    assert "unknown mode 'vm'" in result.stderr


def test_container_joins_sosho_net_without_host_access(sandbox: Sandbox) -> None:
    result = _run(sandbox, ["hello"])
    assert result.returncode == 0, result.stderr
    args = _docker_run_args(sandbox)
    joined = " ".join(args)
    assert args[args.index("--network") + 1] == "sosho-net"
    assert "docker.sock" not in joined
    assert "--privileged" not in args
    assert not any(arg.startswith("--pid") for arg in args)
    assert args[args.index("--user") + 1] == f"{os.getuid()}:{os.getgid()}"
    assert f"{sandbox.workspace}:{sandbox.workspace}" in args


def test_container_uses_compose_urls_and_puts_approve_first(sandbox: Sandbox) -> None:
    _run(sandbox, ["hello"])
    args = _docker_run_args(sandbox)
    assert "LITELLM_BASE_URL=http://litellm:4000/v1" in args
    assert "LLAMA_BASE_URL=http://llama-cpp:8080" in args
    assert args[-3:] == ["pi-sandbox:latest", "--approve", "hello"]


def test_subcommand_gets_approve_after_its_options(sandbox: Sandbox) -> None:
    _run(sandbox, ["update", "--all"])
    assert _docker_run_args(sandbox)[-4:] == ["pi-sandbox:latest", "update", "--all", "--approve"]


def test_container_mode_stops_when_the_network_is_missing(sandbox: Sandbox) -> None:
    script = sandbox.bin_dir / "docker"
    _write_fake(script, sandbox.docker_log, '[ "$1 $2" = "network inspect" ] && exit 1')
    result = _run(sandbox, ["hello"])
    assert result.returncode == 1
    assert "sosho-net not found" in result.stderr
    assert not [call for call in _calls(sandbox.docker_log) if call[0] == "run"]


def test_raw_mode_runs_host_pi_with_host_urls(sandbox: Sandbox) -> None:
    result = _run(sandbox, ["--raw", "hello"])
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "http://127.0.0.1:4000/v1"
    assert _calls(sandbox.pi_log) == [["--approve", "hello"]]
    assert not sandbox.docker_log.exists()
