import re
import subprocess
from pathlib import Path

from tests.conftest import ROOT

SCRIPT = ROOT / "bin" / "ensure-secrets.sh"
KEYS = ("LANGFUSE_NEXTAUTH_SECRET", "LANGFUSE_SALT", "LANGFUSE_ENCRYPTION_KEY")


def _run(target: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [str(SCRIPT), str(target)], capture_output=True, text=True, timeout=10, check=True
    )


def _values(target: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {key: [] for key in KEYS}
    for line in target.read_text().splitlines():
        key, _, value = line.partition("=")
        if key in found:
            found[key].append(value)
    return found


def test_creates_a_private_file_with_one_random_value_per_key(tmp_path: Path) -> None:
    target = tmp_path / "local.env"
    _run(target)
    assert target.stat().st_mode & 0o077 == 0
    for values in _values(target).values():
        assert len(values) == 1
        assert re.fullmatch(r"[0-9a-f]{64}", values[0])


def test_fills_empty_lines_and_keeps_set_values(tmp_path: Path) -> None:
    target = tmp_path / "local.env"
    target.write_text("OTHER=1\nLANGFUSE_SALT=keep-me\nLANGFUSE_NEXTAUTH_SECRET=  # note\n")
    _run(target)
    values = _values(target)
    assert values["LANGFUSE_SALT"] == ["keep-me"]
    assert len(values["LANGFUSE_NEXTAUTH_SECRET"]) == 1
    assert values["LANGFUSE_NEXTAUTH_SECRET"][0] != ""
    assert "OTHER=1" in target.read_text()


def test_never_prints_a_value(tmp_path: Path) -> None:
    target = tmp_path / "local.env"
    result = _run(target)
    for values in _values(target).values():
        assert values[0] not in result.stdout + result.stderr


def test_second_run_changes_nothing(tmp_path: Path) -> None:
    target = tmp_path / "local.env"
    _run(target)
    before = target.read_text()
    assert _run(target).stdout == ""
    assert target.read_text() == before
