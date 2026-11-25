import shutil
import subprocess

import pytest

pytestmark = pytest.mark.integration

IMAGE = "pi-sandbox:latest"
NETWORK = "sosho-net"
DOCKER_SOCKET = "/var/run/" + "docker" + ".sock"
SERVICE_URLS = [
    "http://litellm:4000/health/liveliness",
    "http://llama-cpp:8080/health",
]


def _docker() -> str:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not found on PATH")
    for kind, name in (("image", IMAGE), ("network", NETWORK)):
        found = subprocess.run(  # noqa: S603
            [docker, kind, "inspect", name], capture_output=True, check=False
        )
        if found.returncode != 0:
            pytest.skip(f"docker {kind} {name} not found. Run make up.")
    return docker


def _sh_in_image(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [_docker(), "run", "--rm", "--network", NETWORK, "--entrypoint", "sh", IMAGE, "-c", script],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_image_reports_a_pi_version() -> None:
    result = subprocess.run(  # noqa: S603
        [_docker(), "run", "--rm", IMAGE, "--version"],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip()


@pytest.mark.parametrize("url", SERVICE_URLS)
def test_container_reaches_compose_service_by_name(url: str) -> None:
    result = _sh_in_image(f"curl -fsS -m 10 -o /dev/null {url}")
    assert result.returncode == 0, result.stderr


def test_container_has_no_docker_socket() -> None:
    result = _sh_in_image(f"test -e {DOCKER_SOCKET}")
    assert result.returncode == 1
