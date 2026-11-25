import json
import re
import subprocess
from pathlib import Path
from typing import cast

from tests.conftest import ROOT

SKIP_PREFIXES = ("legacy/", "models/")
SKIP_NAMES = ("pnpm-lock.yaml", "uv.lock")

CLOUD_HOST = re.compile(r"api\.(?:deepinfra|refuseless)\.com")
LLAMA_URL = re.compile(r"[A-Za-z0-9.-]+:8080\b")

CLOUD_ALLOWED = {"docker/litellm.yaml"}
LLAMA_ALLOWED = {
    "compose.yaml",
    "docker/litellm.yaml",
    "packages/yue2/AGENTS.md",
    "packages/yue2/gateway/app.py",
    "tests/integration/test_llama.py",
}
PENDING = {
    ".pi/models.json": ".pi/models.next.json",
    ".pi/model-roles.json": ".pi/model-roles.next.json",
}


def tracked_text_files() -> dict[str, str]:
    listing = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"],  # noqa: S607
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    files: dict[str, str] = {}
    for name in listing.split("\0"):
        if not name or name.startswith(SKIP_PREFIXES) or Path(name).name in SKIP_NAMES:
            continue
        path = ROOT / name
        if not path.is_file():
            continue
        try:
            files[name] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
    return files


def waits_for_owner(name: str) -> bool:
    pending = PENDING.get(name)
    return pending is not None and (ROOT / pending).is_file()


def offenders(pattern: re.Pattern[str], allowed: set[str]) -> list[str]:
    found: list[str] = []
    for name, text in tracked_text_files().items():
        if name in allowed or waits_for_owner(name) or not pattern.search(text):
            continue
        found.append(name)
    return found


def read_json(name: str) -> dict[str, object]:
    data: dict[str, object] = json.loads((ROOT / name).read_text(encoding="utf-8"))
    return data


def test_no_file_names_a_cloud_model_host_except_the_litellm_config() -> None:
    assert offenders(CLOUD_HOST, CLOUD_ALLOWED) == []


def test_no_file_names_a_llama_cpp_url_except_the_allow_list() -> None:
    assert offenders(LLAMA_URL, LLAMA_ALLOWED) == []


def test_pi_models_use_only_the_litellm_provider() -> None:
    providers = read_json(".pi/models.json")["providers"]
    assert isinstance(providers, dict)
    names = {str(name) for name in cast("dict[str, object]", providers)}
    assert names == {"litellm"}


def test_pi_roles_all_use_the_litellm_provider() -> None:
    roles = read_json(".pi/model-roles.json")["roles"]
    assert isinstance(roles, dict)
    entries = cast("dict[str, dict[str, object]]", roles)
    assert entries
    assert {str(role["provider"]) for role in entries.values()} == {"litellm"}


def test_pi_settings_default_to_the_litellm_provider() -> None:
    assert read_json(".pi/settings.json")["defaultProvider"] == "litellm"


def test_opencode_uses_only_the_litellm_provider() -> None:
    config = read_json("opencode.json")
    providers = config["provider"]
    assert isinstance(providers, dict)
    assert {str(name) for name in cast("dict[str, object]", providers)} == {"litellm"}
    assert str(config["model"]).startswith("litellm/")
