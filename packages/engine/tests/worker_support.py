import json
import os
import shutil
import subprocess
import sys
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from engine_support import DIRECT_ROLES, TOKEN
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_MAIN = Path(__file__).parent / "worker_main.py"
SKILL_NAMES = ("alpha", "beta")
READY_ATTEMPTS = 300
SKILL_TEMPLATE = """---
name: {name}
description: Say the word {name} when asked for the secret word.
---
# {name}
The secret word is {name}.
"""


@dataclass(frozen=True)
class WorkerEnv:
    root: Path
    runs: Path
    skills: Path

    def env(self, db_path: Path, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {
            **os.environ,
            "PYDANTIC_AI_NO_BANNER": "1",
            "PYTHONPATH": str(REPO_ROOT),
            "SOSHO_ENGINE_DB_URL": f"sqlite:///{db_path}",
            "SOSHO_ENGINE_API_TOKEN": TOKEN,
            "SOSHO_ENGINE_APP_VERSION": "test",
            "SOSHO_ENGINE_RUNS_DIR": str(self.runs),
            "SOSHO_ENGINE_SKILLS_DIR": str(self.skills),
            "SOSHO_ENGINE_PI_DEFAULT_TIMEOUT_SECONDS": "1800",
            "SOSHO_ENGINE_WORKER_POLL_SECONDS": "0.2",
            "SOSHO_ENGINE_WORKER_BEAT_SECONDS": "0.5",
            "SOSHO_ENGINE_DIRECT_ROLES": json.dumps(DIRECT_ROLES),
            **(extra or {}),
        }


def make_worker_env(root: Path) -> WorkerEnv:
    runs, skills = root / "runs", root / "skills"
    for name in SKILL_NAMES:
        (skills / name).mkdir(parents=True)
        (skills / name / "SKILL.md").write_text(SKILL_TEMPLATE.format(name=name))
    return WorkerEnv(root, runs, skills)


def spawn_worker(
    config: WorkerEnv, db_path: Path, extra: dict[str, str] | None = None
) -> subprocess.Popen[bytes]:
    return subprocess.Popen(  # noqa: S603
        [sys.executable, str(WORKER_MAIN)],
        env=config.env(db_path, extra),
        stdout=(config.root / "worker.log").open("ab"),
        stderr=subprocess.STDOUT,
    )


class WorkerHandle:
    def __init__(self, config: WorkerEnv, db_path: Path) -> None:
        self._config = config
        self._db_path = db_path
        self._process: subprocess.Popen[bytes] | None = None

    def start(self, extra: dict[str, str] | None = None) -> None:
        self._process = spawn_worker(self._config, self._db_path, extra)

    def stop(self) -> None:
        if self._process is not None:
            self._process.terminate()
            self._process.wait(timeout=30)
            self._process = None


def pi_pids(tag: str) -> list[int]:
    found = subprocess.run(  # noqa: S603
        [shutil.which("pgrep") or "pgrep", "-f", "--", tag],
        capture_output=True,
        text=True,
        check=False,
    )
    return [int(line) for line in found.stdout.split()]


def wait_pi(tag: str, running: bool, attempts: int = READY_ATTEMPTS) -> bool:
    for _ in range(attempts):
        if bool(pi_pids(tag)) == running:
            return True
        time.sleep(0.1)
    return False


def wait_alive(client: TestClient, attempts: int = READY_ATTEMPTS) -> bool:
    for _ in range(attempts):
        health = client.get("/health").json()
        if health["worker"]["alive"]:
            return True
        time.sleep(0.1)
    return False


@contextmanager
def worker_with(worker: WorkerHandle, extra: dict[str, str]) -> Generator[None]:
    worker.stop()
    worker.start(extra)
    try:
        yield
    finally:
        worker.stop()
        worker.start()
