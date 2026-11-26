import re
import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml
from pydantic import BaseModel

from tests.conftest import ROOT

EXACT_SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")
EXACT_PY = re.compile(r"^[A-Za-z0-9_.\-]+(\[[A-Za-z0-9_,\-]+\])?==[0-9][0-9A-Za-z.]*$")
EXACT_IMAGE_TAG = re.compile(r"(\d+\.\d+)|(-b\d+)|(-\d{8}-[0-9a-f]{7,})")


def _tracked(pattern: str) -> list[Path]:
    out = subprocess.run(  # noqa: S603
        ["git", "ls-files", "-co", "--exclude-standard", pattern],  # noqa: S607
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [ROOT / line for line in out.splitlines() if (ROOT / line).is_file()]


def _image_is_pinned(image: str) -> bool:
    if "@sha256:" in image:
        return True
    name = image.rsplit("/", 1)[-1]
    if ":" not in name:
        return False
    tag = name.split(":", 1)[1]
    return tag != "latest" and EXACT_IMAGE_TAG.search(tag) is not None


class PackageJson(BaseModel):
    dependencies: dict[str, str] = {}
    devDependencies: dict[str, str] = {}  # noqa: N815
    optionalDependencies: dict[str, str] = {}  # noqa: N815


PI_PACKAGE_PREFIX = "@earendil-works/pi-"


def _npm_version_ok(name: str, version: str) -> bool:
    if version.startswith("workspace:") or EXACT_SEMVER.match(version):
        return True
    return name.startswith(PI_PACKAGE_PREFIX) and version == "latest"


def _unpinned_deps(deps: dict[str, str]) -> list[str]:
    return [
        f"{name}@{version}" for name, version in deps.items() if not _npm_version_ok(name, version)
    ]


def _npm_unpinned(path: Path) -> list[str]:
    data = PackageJson.model_validate_json(path.read_text())
    return _unpinned_deps(data.dependencies | data.devDependencies | data.optionalDependencies)


def test_pi_package_may_use_latest() -> None:
    assert _unpinned_deps({"@earendil-works/pi-coding-agent": "latest"}) == []


def test_non_pi_package_with_latest_fails() -> None:
    assert _unpinned_deps({"example-package": "latest"}) == ["example-package@latest"]


def test_pi_package_with_range_fails() -> None:
    assert _unpinned_deps({"@earendil-works/pi-coding-agent": "^1.6.0"}) != []


@pytest.mark.parametrize("path", _tracked("*package.json"), ids=lambda p: str(p.relative_to(ROOT)))
def test_npm_dependencies_use_exact_versions(path: Path) -> None:
    assert _npm_unpinned(path) == []


def _pyproject_specs(path: Path) -> list[str]:
    data = tomllib.loads(path.read_text())
    project = data.get("project", {})
    groups = data.get("dependency-groups", {})
    specs: list[str] = list(project.get("dependencies", []))
    for group in groups.values():
        specs.extend(spec for spec in group if isinstance(spec, str))
    specs.extend(data.get("build-system", {}).get("requires", []))
    return specs


@pytest.mark.parametrize(
    "path", _tracked("*pyproject.toml"), ids=lambda p: str(p.relative_to(ROOT))
)
def test_python_dependencies_use_exact_versions(path: Path) -> None:
    workspace: set[str] = set()
    bad = [s for s in _pyproject_specs(path) if s not in workspace and not EXACT_PY.match(s)]
    assert bad == []


@pytest.mark.parametrize(
    "path", _tracked("*requirements*.txt"), ids=lambda p: str(p.relative_to(ROOT))
)
def test_requirements_files_use_exact_versions(path: Path) -> None:
    lines = [line.strip() for line in path.read_text().splitlines()]
    bad = [line for line in lines if line and not line.startswith("#") and not EXACT_PY.match(line)]
    assert bad == []


def test_mise_tools_and_node_use_exact_versions() -> None:
    tools = tomllib.loads((ROOT / ".config" / "mise.toml").read_text())["tools"]
    bad = [
        f"{name}={version}" for name, version in tools.items() if not EXACT_SEMVER.match(version)
    ]
    assert bad == []
    assert EXACT_SEMVER.match((ROOT / ".nvmrc").read_text().strip().removeprefix("v"))


def _compose_images() -> list[str]:
    images: list[str] = []
    services = yaml.safe_load((ROOT / "compose.yaml").read_text())["services"]
    images.extend(
        service["image"]
        for service in services.values()
        if "image" in service and "build" not in service
    )
    return images


def test_pulled_compose_images_use_exact_versions() -> None:
    assert [image for image in _compose_images() if not _image_is_pinned(image)] == []


def test_dockerfile_base_images_use_exact_versions() -> None:
    bad: list[str] = []
    for path in _tracked("docker/Dockerfile*"):
        for line in path.read_text().splitlines():
            if line.upper().startswith("FROM "):
                image = line.split()[1]
                if not _image_is_pinned(image):
                    bad.append(f"{path.name}: {image}")
    assert bad == []


def test_inline_installs_in_compose_use_exact_versions() -> None:
    text = (ROOT / "compose.yaml").read_text()
    packages = re.findall(r"pip install [^\n]*?\"([^\"]+)\"", text)
    assert packages
    assert [pkg for pkg in packages if not EXACT_PY.match(pkg)] == []


def test_mise_does_not_manage_node() -> None:
    tools = tomllib.loads((ROOT / ".config" / "mise.toml").read_text())["tools"]
    assert "node" not in tools
