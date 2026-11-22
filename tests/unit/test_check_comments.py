import subprocess
import sys
from pathlib import Path

import pytest

from tests.conftest import ROOT

SCRIPT = ROOT / "bin" / "check-comments.py"


def _check(workdir: Path, *names: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), *names],
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


@pytest.mark.parametrize(
    ("name", "source"),
    [
        ("a.py", 'x = "# text in a string"\n'),
        ("a.py", "#!/usr/bin/env python\nx = 1  # noqa: S101\n"),
        ("a.ts", 'const url = "http://host"; const re = /a\\/\\/b/;\n'),
        ("a.sh", '#!/bin/sh\necho "# not a comment"\n# shellcheck disable=SC2086\n'),
        ("a.yaml", "run: |\n  # shell inside a block scalar\n  echo hi\n"),
        ("Dockerfile", "# syntax=docker/dockerfile:1\nFROM alpine:3.22.2\n"),
    ],
)
def test_passes_code_without_comments(tmp_path: Path, name: str, source: str) -> None:
    (tmp_path / name).write_text(source)
    result = _check(tmp_path, name)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("name", "source", "line"),
    [
        ("a.py", "x = 1  # set x\n", 1),
        ("a.py", 'def f() -> None:\n    """Do f."""\n', 2),
        ("a.tsx", "const a = 1;\n/* block */\n", 2),
        ("a.toml", "[a]\nb = 1 # why\n", 2),
        ("Makefile", "all:\n\techo hi\n# note\n", 3),
        (".gitignore", "# section\nnode_modules\n", 1),
    ],
)
def test_reports_each_comment_with_its_line(
    tmp_path: Path, name: str, source: str, line: int
) -> None:
    (tmp_path / name).write_text(source)
    result = _check(tmp_path, name)
    assert result.returncode == 1
    assert f"{name}:{line}:" in result.stderr


def _allow(tmp_path: Path, path: str, text: str, reason: str) -> None:
    entry = f'[[comment]]\npath = "{path}"\ntext = "{text}"\nreason = "{reason}"\n'
    (tmp_path / "comments-allow.toml").write_text(entry)


def test_allow_entry_with_reason_passes(tmp_path: Path) -> None:
    (tmp_path / "a.sh").write_text("echo hi # keep\n")
    _allow(tmp_path, "a.sh", "# keep", "The external tool needs this exact marker.")
    assert _check(tmp_path, "a.sh").returncode == 0


def test_allow_entry_without_a_real_reason_fails(tmp_path: Path) -> None:
    (tmp_path / "a.sh").write_text("echo hi # keep\n")
    _allow(tmp_path, "a.sh", "# keep", "needed")
    result = _check(tmp_path, "a.sh")
    assert result.returncode == 1
    assert "is not valid" in result.stderr


def test_stale_allow_entry_fails(tmp_path: Path) -> None:
    (tmp_path / "a.sh").write_text("echo hi\n")
    _allow(tmp_path, "a.sh", "# gone", "This comment was removed from the file.")
    result = _check(tmp_path, "a.sh")
    assert result.returncode == 1
    assert "stale entry" in result.stderr
