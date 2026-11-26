import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.conftest import LITELLM_URL, ROOT, require_service

LAUNCHER = ROOT / "bin" / "pi-launcher.sh"
IMAGE = "pi-sandbox:latest"
NETWORK = "sosho-net"
VERSION = re.compile(r"^\d+\.\d+\.\d+\S*$")
STAMP = ".pi/.cache/.last_ext_update"
FRESH_STAMP = "9999999999"
RUN_TIMEOUT = 240
NPX_ATTEMPTS = 2
SHORT_ARGS = [
    "-p",
    "--no-session",
    "--provider",
    "litellm",
    "--model",
    "local-uncensored",
    "--no-tools",
    "--no-skills",
    "--no-context-files",
    "Reply with the single word ok.",
]


def _launch(
    workspace: Path,
    args: list[str],
    extra_env: dict[str, str] | None = None,
    root: Path | None = None,
):
    env = {**os.environ, "PI_SKIP_WARMUP": "1", **(extra_env or {})}
    if root is not None:
        stamp = root / STAMP
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(FRESH_STAMP)
        env["SOSHO_ROOT"] = str(root)
    return subprocess.run(  # noqa: S603
        [str(LAUNCHER), *args],
        cwd=workspace,
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=RUN_TIMEOUT,
        check=False,
    )


def _launch_raw(
    workspace: Path,
    args: list[str],
    extra_env: dict[str, str] | None = None,
    root: Path | None = None,
):
    for attempt in range(NPX_ATTEMPTS):
        try:
            return _launch(workspace, ["--raw", *args], extra_env, root)
        except subprocess.TimeoutExpired:
            if attempt == NPX_ATTEMPTS - 1:
                raise
    raise AssertionError("unreachable")


def _require(found: bool, message: str) -> None:
    if found:
        return
    if os.environ.get("LIVE_STRICT") == "1":
        pytest.fail(message)
    pytest.skip(message)


def _require_container() -> None:
    docker = shutil.which("docker")
    _require(docker is not None, "docker not found on PATH")
    for kind, name in (("image", IMAGE), ("network", NETWORK)):
        found = subprocess.run(  # noqa: S603
            [docker or "docker", kind, "inspect", name], capture_output=True, check=False
        )
        _require(found.returncode == 0, f"docker {kind} {name} not found. Run make up.")


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    path = tmp_path / "ws"
    path.mkdir()
    return path


@pytest.fixture
def root(tmp_path: Path) -> Path:
    path = tmp_path / "root"
    path.mkdir()
    return path


@pytest.fixture
def inside(root: Path) -> Path:
    path = root / "sub" / "dir"
    path.mkdir(parents=True)
    return path


def _assert_stamp_kept(root: Path) -> None:
    assert (root / STAMP).read_text() == FRESH_STAMP


def test_launcher_help_lists_both_modes_and_starts_nothing(workspace: Path) -> None:
    result = _launch(workspace, ["--launcher-help"])
    assert result.returncode == 0
    assert "container (default)" in result.stdout
    assert "raw" in result.stdout


def test_unknown_mode_fails(workspace: Path) -> None:
    result = _launch(workspace, ["hello"], {"PI_MODE": "vm"})
    assert result.returncode == 1
    assert "unknown mode 'vm'" in result.stderr


def _hashes() -> dict[str, bytes]:
    names = ("models.json", "model-roles.json", "settings.json")
    return {name: (ROOT / ".pi" / name).read_bytes() for name in names}


@pytest.mark.integration
def test_raw_mode_inside_the_repo_uses_the_root_only(inside: Path, root: Path) -> None:
    version = _launch_raw(inside, ["--version"], root=root)
    assert version.returncode == 0, version.stderr
    assert VERSION.match(version.stdout.strip().splitlines()[-1]), version.stdout
    helped = _launch_raw(inside, ["--help"], root=root)
    assert helped.returncode == 0, helped.stderr
    assert "--thinking" in helped.stdout
    assert "--launcher-help" not in helped.stdout
    _assert_stamp_kept(root)
    assert not (inside / ".pi").exists()
    assert list(inside.iterdir()) == []
    assert (root / ".pi").is_dir()
    assert not (root / ".pi" / "models.json").exists()


@pytest.mark.integration
def test_raw_mode_outside_the_repo_keeps_state_in_the_workspace(workspace: Path) -> None:
    before = _hashes()
    result = _launch_raw(workspace, ["--help"])
    assert result.returncode == 0, result.stderr
    assert "--thinking" in result.stdout
    assert "--launcher-help" not in result.stdout
    assert (workspace / ".pi").is_dir()
    assert (workspace / ".pi" / "models.json").is_file()
    assert _hashes() == before


@pytest.mark.integration
def test_state_override_keeps_an_outside_workspace_on_the_root_state(
    workspace: Path, root: Path
) -> None:
    before = _hashes()
    result = _launch_raw(workspace, ["--help"], {"SOSHO_PI_STATE": "root"}, root=root)
    assert result.returncode == 0, result.stderr
    assert "--thinking" in result.stdout
    _assert_stamp_kept(root)
    assert not (workspace / ".pi").exists()
    assert list(workspace.iterdir()) == []
    assert (root / ".pi" / ".cache").is_dir()
    assert not (root / ".pi" / "models.json").exists()
    assert _hashes() == before


@pytest.mark.integration
def test_container_mode_reports_the_version_and_answers_through_litellm(
    inside: Path, root: Path, workspace: Path
) -> None:
    require_service("litellm", f"{LITELLM_URL}/health/liveliness")
    _require_container()
    version = _launch(inside, ["--version"], root=root)
    assert version.returncode == 0, version.stderr
    assert VERSION.match(version.stdout.strip().splitlines()[-1]), version.stdout
    _assert_stamp_kept(root)
    assert not (inside / ".pi").exists()
    answer = _launch(workspace, SHORT_ARGS)
    assert answer.returncode == 0, answer.stderr
    assert answer.stdout.strip()


@pytest.mark.integration
def test_raw_mode_answers_through_litellm_on_the_host_url(workspace: Path) -> None:
    require_service("litellm", f"{LITELLM_URL}/health/liveliness")
    result = _launch_raw(workspace, SHORT_ARGS)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip()
    assert (workspace / ".pi" / "models.json").is_file()
