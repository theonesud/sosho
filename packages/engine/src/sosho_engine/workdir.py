import re
import shutil
from pathlib import Path

from sosho_engine.errors import NodeFailedError
from sosho_engine.skills import link_skills

UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def _safe(name: str) -> str:
    cleaned = UNSAFE.sub("_", name).lstrip(".")
    return cleaned or "_"


def workdir_for(runs_dir: Path, run_id: str, node_id: str) -> Path:
    root = runs_dir.expanduser().resolve()
    path = root / _safe(run_id) / _safe(node_id)
    if not path.is_relative_to(root):
        raise NodeFailedError(f"workdir {path} is outside {root}")
    return path


def prepare_workdir(path: Path, skills_dir: Path, skills: list[str]) -> Path:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    link_skills(path, skills_dir, skills)
    return path
