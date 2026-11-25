import os
import signal
import subprocess
import sys
import time
from pathlib import Path

WORKER = Path(__file__).parent / "crash_worker.py"
WAIT_ATTEMPTS = 300


def _spawn(
    mode: str, db: Path, marker: Path, shape: str, run_id: str = ""
) -> subprocess.Popen[str]:
    return subprocess.Popen(  # noqa: S603
        [sys.executable, str(WORKER), mode, str(db), str(marker), run_id, shape],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env={**os.environ, "PYDANTIC_AI_NO_BANNER": "1"},
    )


def _wait_for_marker(marker: Path, label: str) -> None:
    for _ in range(WAIT_ATTEMPTS):
        if marker.exists() and label in marker.read_text().split():
            return
        time.sleep(0.05)
    raise AssertionError(f"marker {label} did not appear")


def _crash_and_recover(tmp_path: Path, shape: str, waiting_label: str) -> list[str]:
    db = tmp_path / "crash.sqlite"
    marker = tmp_path / "marks.txt"
    first = _spawn("start", db, marker, shape)
    assert first.stdout is not None
    run_id = first.stdout.readline().strip()
    assert run_id
    _wait_for_marker(marker, waiting_label)
    first.send_signal(signal.SIGKILL)
    first.wait(timeout=10)
    second = _spawn("recover", db, marker, shape, run_id)
    assert second.stdout is not None
    assert second.stdout.readline().strip() == "SUCCESS"
    second.wait(timeout=30)
    return marker.read_text().split()


def test_run_survives_sigkill_in_the_middle_of_a_node(tmp_path: Path) -> None:
    labels = _crash_and_recover(tmp_path, "serial", "middle")
    assert labels.count("first") == 1
    assert labels.count("middle") == 2
    assert labels.count("last") == 1


def test_parallel_branches_resume_without_repeating_finished_nodes(tmp_path: Path) -> None:
    labels = _crash_and_recover(tmp_path, "parallel", "right")
    assert labels.count("left") == 1
    assert labels.count("right") == 2
    assert labels.count("last") == 1
