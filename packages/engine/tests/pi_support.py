import json
from pathlib import Path

from engine_support import dig
from pydantic import JsonValue

EVENT_LOG = "events.jsonl"
REPO_ROOT = Path(__file__).resolve().parents[3]


def workdir_of(detail: JsonValue, node_id: str = "n") -> Path:
    return Path(str(dig(detail, "output", "output", node_id, "workdir")))


def run_workdir(runs: Path, detail: JsonValue, node_id: str = "n") -> Path:
    return runs / str(dig(detail, "summary", "run_id")) / node_id


def read_events(workdir: Path) -> list[JsonValue]:
    lines = (workdir / EVENT_LOG).read_text(encoding="utf-8").splitlines()
    events: list[JsonValue] = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def system_sections(workdir: Path) -> dict[str, str]:
    for event in read_events(workdir):
        message = dig(event, "message")
        if dig(event, "type") == "message_start" and dig(message, "role") == "system":
            sections = dig(message, "sections")
            if isinstance(sections, dict):
                return {name: str(text) for name, text in sections.items()}
    return {}


def user_text(workdir: Path) -> str:
    for event in read_events(workdir):
        message = dig(event, "message")
        if dig(event, "type") == "message_end" and dig(message, "role") == "user":
            return str(dig(message, "content", 0, "text"))
    return ""


def proxy_root(root: Path, base_url: str) -> Path:
    real = REPO_ROOT / ".pi"
    models = json.loads((real / "models.json").read_text(encoding="utf-8"))
    models["providers"]["litellm"]["baseUrl"] = base_url
    target = root / ".pi"
    target.mkdir(parents=True)
    (target / "models.json").write_text(json.dumps(models), encoding="utf-8")
    (target / "extensions").symlink_to(real / "extensions")
    return root
