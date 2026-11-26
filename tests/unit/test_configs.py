import configparser
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest
import yaml
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from tests.conftest import ROOT

SOSHO_NET = "sosho-net"
LOCAL_HOST = "127.0.0.1"
DOCKER_SOCKET = "/var/run/docker.sock"
LLAMA_HOST = "llama-cpp"
LLAMA_PORT = 8080
STRATA_HOST = "strata"
STRATA_ROLE = "local-uncensored"
LLAMA_ROLES = {"decision", "embed"}
LOCAL_ROLES = {"decision", "embed", "local-uncensored"}
EXPECTED_ROLES = {
    "main",
    "subagent",
    "subagent-code",
    "decision",
    "embed",
    "local-uncensored",
    "cloud-uncensored",
}
ALLOWED_FALLBACKS = {("main", "subagent")}
MCP_FILES = (".mcp.json", ".pi/mcp.json", ".agents/mcp_config.json")
PLAYWRIGHT_VECTOR = ["npx", "-y", "@playwright/mcp@0.0.86", "--headless"]
FALLBACK_LIST: TypeAdapter[list[dict[str, list[str]]]] = TypeAdapter(list[dict[str, list[str]]])
CFG = ConfigDict(extra="ignore", frozen=True, protected_namespaces=())


class ComposeInclude(BaseModel):
    model_config = CFG
    path: str


class ComposeService(BaseModel):
    model_config = CFG
    image: str | None = None
    build: object | None = None
    networks: list[str] | dict[str, object] | None = None
    ports: list[str] = []
    volumes: list[str] = []
    command: list[str] | str = []
    deploy: dict[str, object] = {}


class ComposeFile(BaseModel):
    model_config = CFG
    include: list[ComposeInclude] = []
    services: dict[str, ComposeService] = {}


class LiteLLMParams(BaseModel):
    model_config = CFG
    model: str
    api_base: str


class ModelEntry(BaseModel):
    model_config = CFG
    model_name: str
    litellm_params: LiteLLMParams


class LiteLLMConfig(BaseModel):
    model_config = CFG
    model_list: list[ModelEntry]
    router_settings: dict[str, object] = {}
    litellm_settings: dict[str, object] = {}


class StdioServer(BaseModel):
    model_config = CFG
    command: str
    args: list[str] = []


class McpServersFile(BaseModel):
    model_config = CFG
    servers: dict[str, StdioServer] = Field(alias="mcpServers")


class OpenCodeServer(BaseModel):
    model_config = CFG
    command: list[str]


class OpenCodeFile(BaseModel):
    model_config = CFG
    mcp: dict[str, OpenCodeServer]


def read_compose(path: Path) -> ComposeFile:
    data: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    return ComposeFile.model_validate(data)


def load_compose_services() -> dict[str, ComposeService]:
    root = read_compose(ROOT / "compose.yaml")
    services = dict(root.services)
    for include in root.include:
        services.update(read_compose(ROOT / include.path).services)
    return services


def binds_to_localhost(port: str) -> bool:
    return port.startswith(f"{LOCAL_HOST}:")


def network_names(service: ComposeService) -> set[str]:
    if service.networks is None:
        return set()
    if isinstance(service.networks, list):
        return set(service.networks)
    return set(service.networks.keys())


def image_tag(image: str) -> str | None:
    last_part = image.split("@", 1)[0].rsplit("/", 1)[-1]
    if ":" not in last_part:
        return None
    return last_part.split(":", 1)[1]


def llama_ini_text() -> str:
    return (ROOT / "docker" / "llama-models.ini").read_text(encoding="utf-8")


def llama_section_headers() -> list[str]:
    return re.findall(r"^\[([^\]]+)\]\s*$", llama_ini_text(), flags=re.MULTILINE)


def read_llama_ini() -> configparser.ConfigParser:
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_string("[_preamble]\n" + llama_ini_text())
    parser.remove_section("_preamble")
    return parser


def read_litellm() -> LiteLLMConfig:
    data: object = yaml.safe_load((ROOT / "docker" / "litellm.yaml").read_text(encoding="utf-8"))
    return LiteLLMConfig.model_validate(data)


def fallback_pairs(config: LiteLLMConfig) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for settings in (config.router_settings, config.litellm_settings):
        for key, value in settings.items():
            if "fallback" not in key:
                continue
            for entry in FALLBACK_LIST.validate_python(value):
                for source, targets in entry.items():
                    pairs.update((source, target) for target in targets)
    return pairs


def read_mcp_file(relative: str) -> dict[str, list[str]]:
    parsed = McpServersFile.model_validate_json((ROOT / relative).read_text(encoding="utf-8"))
    return {name: [server.command, *server.args] for name, server in parsed.servers.items()}


def read_opencode_mcp() -> dict[str, list[str]]:
    parsed = OpenCodeFile.model_validate_json((ROOT / "opencode.json").read_text(encoding="utf-8"))
    return {name: list(server.command) for name, server in parsed.mcp.items()}


def read_all_mcp() -> dict[str, dict[str, list[str]]]:
    result = {relative: read_mcp_file(relative) for relative in MCP_FILES}
    result["opencode.json"] = read_opencode_mcp()
    return result


def container_to_host(path: str) -> Path:
    assert path.startswith("/models/"), f"path is not under /models: {path}"
    return ROOT / "models" / path.removeprefix("/models/")


def strata_command() -> list[str]:
    command = load_compose_services()[STRATA_HOST].command
    assert isinstance(command, list), "strata command is not a list"
    return command


def test_docker_compose_config_exits_zero() -> None:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not found on PATH.")
    result = subprocess.run(  # noqa: S603
        [docker, "compose", "-p", "sosho", "config", "-q"],
        cwd=ROOT,
        capture_output=True,
        check=False,
        timeout=120,
    )
    # The output is not printed. It can hold values from .env.
    assert result.returncode == 0, f"docker compose config exited with {result.returncode}"


def test_no_service_mounts_the_docker_socket() -> None:
    for name, service in load_compose_services().items():
        for volume in service.volumes:
            assert DOCKER_SOCKET not in volume, f"{name} mounts the Docker socket"


def test_every_published_port_binds_to_localhost() -> None:
    for name, service in load_compose_services().items():
        for port in service.ports:
            assert binds_to_localhost(port), f"{name} publishes a port on a non-local address"


def test_every_service_joins_the_sosho_net_network() -> None:
    for name, service in load_compose_services().items():
        assert SOSHO_NET in network_names(service), f"{name} does not join {SOSHO_NET}"


def test_every_pulled_image_is_pinned() -> None:
    for name, service in load_compose_services().items():
        if service.build is not None:
            continue
        assert service.image is not None, f"{name} has neither build nor image"
        if "@sha256:" in service.image:
            continue
        tag = image_tag(service.image)
        assert tag is not None, f"{name} image {service.image} has no tag"
        assert tag != "latest", f"{name} image {service.image} uses the latest tag"


def test_llama_model_sections_are_unique_and_have_a_model_key() -> None:
    headers = llama_section_headers()
    assert headers, "llama-models.ini has no model sections"
    assert len(headers) == len(set(headers)), f"duplicate sections: {headers}"
    parser = read_llama_ini()
    for section in parser.sections():
        assert parser.has_option(section, "model"), f"section {section} has no model key"


@pytest.mark.integration
def test_model_files_exist_on_disk() -> None:
    if not (ROOT / "models").is_dir():
        pytest.skip("models/ is missing. The model-download services create it.")
    parser = read_llama_ini()
    missing: list[str] = []
    for section in parser.sections():
        for key in ("model", "mmproj"):
            if parser.has_option(section, key):
                host_path = container_to_host(parser.get(section, key))
                if not host_path.is_file():
                    missing.append(str(host_path))
    strata = load_compose_services()[STRATA_HOST]
    command = strata_command()
    strata_file = command[command.index("--model") + 1]
    strata_folder = next(v for v in strata.volumes if v.endswith(":/models:ro"))
    host_folder = ROOT / strata_folder.split(":", 1)[0]
    strata_path = host_folder / strata_file.removeprefix("/models/")
    if not strata_path.is_file():
        missing.append(str(strata_path))
    assert not missing, "missing model files: " + ", ".join(missing)


def test_litellm_model_names_are_exactly_the_planned_roles() -> None:
    names = [entry.model_name for entry in read_litellm().model_list]
    assert len(names) == len(set(names)), f"duplicate model names: {names}"
    assert set(names) == EXPECTED_ROLES


def test_llama_roles_use_the_llama_router_and_known_model_sections() -> None:
    sections = set(llama_section_headers())
    entries = {entry.model_name: entry for entry in read_litellm().model_list}
    for role in sorted(LLAMA_ROLES):
        params = entries[role].litellm_params
        url = urlparse(params.api_base)
        assert url.hostname == LLAMA_HOST, f"{role} api_base host is {url.hostname}"
        assert url.port == LLAMA_PORT, f"{role} api_base port is {url.port}"
        assert params.model.startswith("openai/"), f"{role} model has no openai/ prefix"
        model_id = params.model.removeprefix("openai/")
        assert model_id in sections, f"{role} model {model_id} is not in llama-models.ini"


def test_local_uncensored_uses_strata_with_the_served_alias() -> None:
    params = {e.model_name: e for e in read_litellm().model_list}[STRATA_ROLE].litellm_params
    url = urlparse(params.api_base)
    assert url.hostname == STRATA_HOST, f"api_base host is {url.hostname}"
    assert url.port == LLAMA_PORT, f"api_base port is {url.port}"
    assert params.model.startswith("openai/"), "model has no openai/ prefix"
    command = strata_command()
    alias = command[command.index("--alias") + 1]
    assert params.model.removeprefix("openai/") == alias
    assert "Qwen3.6-35B-A3B" not in llama_section_headers()


def test_only_strata_reserves_the_gpu_among_the_chat_services() -> None:
    services = load_compose_services()
    assert "nvidia" in str(services[STRATA_HOST].deploy), "strata has no GPU reservation"
    assert not services[LLAMA_HOST].deploy, "llama-cpp reserves a GPU"


def test_strata_serves_sampling_defaults_and_unloads_when_idle() -> None:
    command = strata_command()
    expected = {
        "--temp": "0.6",
        "--top-p": "0.95",
        "--top-k": "20",
        "--min-p": "0",
        "--presence-penalty": "0",
        "--repeat-penalty": "1",
        "--auto-unload": "900",
        "--kv": "q8",
        "--ctx": "65536",
    }
    for flag, value in expected.items():
        assert command[command.index(flag) + 1] == value, f"{flag} is not {value}"


def test_cloud_roles_do_not_point_at_llama_cpp() -> None:
    for entry in read_litellm().model_list:
        if entry.model_name in LOCAL_ROLES:
            continue
        host = urlparse(entry.litellm_params.api_base).hostname
        assert host != LLAMA_HOST, f"{entry.model_name} points at {LLAMA_HOST}"


def test_only_main_to_subagent_fallback_exists_and_local_roles_have_none() -> None:
    pairs = fallback_pairs(read_litellm())
    assert pairs <= ALLOWED_FALLBACKS, f"unexpected fallbacks: {sorted(pairs)}"
    for source, target in pairs:
        assert source not in LOCAL_ROLES, f"local role {source} has a fallback"
        assert target not in LOCAL_ROLES, f"{source} falls back to local role {target}"


def test_mcp_server_names_and_commands_match_across_all_four_files() -> None:
    vectors = read_all_mcp()
    expected = vectors[".mcp.json"]
    for relative, servers in vectors.items():
        assert set(servers) == set(expected), f"{relative} server set differs"
        assert servers == expected, f"{relative} command vectors differ"


def test_playwright_mcp_server_pins_version_0_0_86() -> None:
    for relative, servers in read_all_mcp().items():
        assert servers["playwright"] == PLAYWRIGHT_VECTOR, f"{relative} playwright is not pinned"
