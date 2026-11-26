import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import pytest
from fault_proxy import FaultProxy, routed

WORKER = Path(__file__).parent / "crash_worker.py"
ROOT = Path(__file__).resolve().parents[3]
WAIT_ATTEMPTS = 2400


@dataclass(frozen=True)
class Crash:
    db: Path
    marker: Path
    shape: str
    base_url: str


def _spawn(mode: str, crash: Crash, run_id: str = "") -> subprocess.Popen[str]:
    return subprocess.Popen(  # noqa: S603
        [sys.executable, str(WORKER), mode, str(crash.db), str(crash.marker), run_id, crash.shape],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env={
            **os.environ,
            "PYDANTIC_AI_NO_BANNER": "1",
            "CRASH_LITELLM_BASE_URL": crash.base_url,
            "PYTHONPATH": str(ROOT),
        },
    )


def _wait_for_marker(marker: Path, label: str) -> None:
    for _ in range(WAIT_ATTEMPTS):
        if marker.exists() and label in marker.read_text().split():
            return
        time.sleep(0.05)
    raise AssertionError(f"marker {label} did not appear")


def _crash_and_recover(
    tmp_path: Path, shape: str, waiting_labels: list[str], proxy: FaultProxy
) -> list[str]:
    crash = Crash(tmp_path / "crash.sqlite", tmp_path / "marks.txt", shape, f"{proxy.url}/v1")
    marker = crash.marker
    first = _spawn("start", crash)
    assert first.stdout is not None
    run_id = first.stdout.readline().strip()
    assert run_id
    for label in waiting_labels:
        _wait_for_marker(marker, label)
    first.send_signal(signal.SIGKILL)
    first.wait(timeout=10)
    second = _spawn("recover", crash, run_id)
    assert second.stdout is not None
    assert second.stdout.readline().strip() == "SUCCESS"
    second.wait(timeout=30)
    return marker.read_text().split()


@pytest.mark.usefixtures("live_stack")
def test_run_survives_sigkill_in_the_middle_of_a_node(tmp_path: Path) -> None:
    with routed() as proxy:
        labels = _crash_and_recover(tmp_path, "serial", ["middle"], proxy)
    assert labels.count("first") == 1
    assert labels.count("middle") == 2
    assert labels.count("last") == 1
    assert proxy.requests == 1


@pytest.mark.usefixtures("live_stack")
def test_parallel_branches_resume_without_repeating_finished_nodes(tmp_path: Path) -> None:
    with routed() as proxy:
        labels = _crash_and_recover(tmp_path, "parallel", ["left", "right"], proxy)
    assert labels.count("left") == 1
    assert labels.count("right") == 2
    assert labels.count("last") == 1
    assert proxy.requests == 1
