import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from engine_support import TOKEN
from fastapi.testclient import TestClient

FAKE_PI = Path(__file__).parent / "fake_pi.py"
WORKER_MAIN = Path(__file__).parent / "worker_main.py"
SKILL_NAMES = ("alpha", "beta")
READY_ATTEMPTS = 300


@dataclass(frozen=True)
class WorkerEnv:
    root: Path
    state: Path
    runs: Path
    skills: Path
    pi: Path

    def env(self, db_path: Path) -> dict[str, str]:
        return {
            **os.environ,
            "PYDANTIC_AI_NO_BANNER": "1",
            "SOSHO_ENGINE_DB_URL": f"sqlite:///{db_path}",
            "SOSHO_ENGINE_API_TOKEN": TOKEN,
            "SOSHO_ENGINE_APP_VERSION": "test",
            "SOSHO_ENGINE_PI_COMMAND": str(self.pi),
            "SOSHO_ENGINE_RUNS_DIR": str(self.runs),
            "SOSHO_ENGINE_SKILLS_DIR": str(self.skills),
            "SOSHO_ENGINE_PI_STDOUT_CAP_BYTES": "1000000",
            "SOSHO_ENGINE_WORKER_POLL_SECONDS": "0.2",
            "SOSHO_ENGINE_WORKER_BEAT_SECONDS": "0.5",
            "FAKE_PI_STATE": str(self.state),
        }


def make_worker_env(root: Path) -> WorkerEnv:
    state, runs, skills = root / "state", root / "runs", root / "skills"
    for name in SKILL_NAMES:
        (skills / name).mkdir(parents=True)
        (skills / name / "SKILL.md").write_text(f"# {name}\n")
    state.mkdir()
    pi = root / "fake-pi"
    pi.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{FAKE_PI}" "$@"\n')
    pi.chmod(0o755)
    return WorkerEnv(root, state, runs, skills, pi)


def spawn_worker(config: WorkerEnv, db_path: Path) -> subprocess.Popen[bytes]:
    return subprocess.Popen(  # noqa: S603
        [sys.executable, str(WORKER_MAIN)],
        env=config.env(db_path),
        stdout=(config.root / "worker.log").open("ab"),
        stderr=subprocess.STDOUT,
    )


class WorkerHandle:
    def __init__(self, config: WorkerEnv, db_path: Path) -> None:
        self._config = config
        self._db_path = db_path
        self._process: subprocess.Popen[bytes] | None = None

    def start(self) -> None:
        self._process = spawn_worker(self._config, self._db_path)

    def stop(self) -> None:
        if self._process is not None:
            self._process.terminate()
            self._process.wait(timeout=30)
            self._process = None


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def wait_for(path: Path, attempts: int = READY_ATTEMPTS) -> bool:
    for _ in range(attempts):
        if path.exists():
            return True
        time.sleep(0.05)
    return False


def wait_alive(client: TestClient, attempts: int = READY_ATTEMPTS) -> bool:
    for _ in range(attempts):
        health = client.get("/health").json()
        if health["worker"]["alive"]:
            return True
        time.sleep(0.1)
    return False
