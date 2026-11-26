import subprocess
import sys
from pathlib import Path

import pytest

from tests.conftest import ROOT

SCRIPT = ROOT / "bin" / "check-file-length.py"


def _check(workdir: Path, *names: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), *names],
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def _write(path: Path, lines: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("x\n" * lines)


@pytest.mark.parametrize("name", ["a.py", "a.ts", "a.sh", "a.tsx", "a.js"])
def test_passes_file_at_the_limit(tmp_path: Path, name: str) -> None:
    _write(tmp_path / name, 1000)
    assert _check(tmp_path, name).returncode == 0


@pytest.mark.parametrize("name", ["a.py", "a.ts", "a.sh", "a.tsx", "a.js"])
def test_fails_file_over_the_limit(tmp_path: Path, name: str) -> None:
    _write(tmp_path / name, 1001)
    result = _check(tmp_path, name)
    assert result.returncode == 1
    assert result.stdout.strip() == f"{name}:1001 (limit 1000)"


@pytest.mark.parametrize(
    "name",
    [
        "a.json",
        "a.md",
        "a.yaml",
        "uv.lock",
        "a.png",
        "a.d.ts",
        "node_modules/p/a.js",
        "vendor/a.py",
    ],
)
def test_skips_data_generated_and_vendored_files(tmp_path: Path, name: str) -> None:
    _write(tmp_path / name, 1100)
    assert _check(tmp_path, name).returncode == 0


def test_reports_every_violation(tmp_path: Path) -> None:
    _write(tmp_path / "a.py", 1005)
    _write(tmp_path / "b.tsx", 1010)
    result = _check(tmp_path, "a.py", "b.tsx")
    assert result.returncode == 1
    assert result.stdout.splitlines() == ["a.py:1005 (limit 1000)", "b.tsx:1010 (limit 1000)"]


def test_skips_a_path_that_is_not_a_file(tmp_path: Path) -> None:
    assert _check(tmp_path, "missing.py").returncode == 0
