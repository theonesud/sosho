import re
from typing import TypedDict
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from sosho_memory.errors import MemoryConfigError, MemoryValidationError

_ALLOWED_SCHEMES = ("surrealkv://", "mem://", "ws://", "wss://", "http://", "https://")
_LITELLM_SCHEMES = ("http://", "https://")
_IDENTIFIER_PATTERN = r"^[a-zA-Z][a-zA-Z0-9_]*$"
_PROJECT_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*\Z")


class _SettingsOverrides(TypedDict, total=False):
    surreal_url: str
    namespace: str
    user_database: str
    project_prefix: str
    embedding_dimensions: int
    litellm_url: str
    litellm_api_key: SecretStr
    embed_role: str
    decision_role: str
    model_timeout_seconds: float


class MemorySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SOSHO_MEMORY_",
        extra="forbid",
        frozen=True,
    )

    surreal_url: str = "surrealkv://.cache/sosho-memory"
    namespace: str = Field(default="sosho", pattern=_IDENTIFIER_PATTERN)
    user_database: str = Field(default="user_memory", pattern=_IDENTIFIER_PATTERN)
    project_prefix: str = Field(default="project_", pattern=_IDENTIFIER_PATTERN)
    embedding_dimensions: int = Field(default=768, ge=1)
    litellm_url: str = "http://127.0.0.1:4000"
    litellm_api_key: SecretStr | None = None
    embed_role: str = Field(default="embed", min_length=1)
    decision_role: str = Field(default="decision", min_length=1)
    model_timeout_seconds: float = Field(default=60.0, gt=0.0)

    @field_validator("surreal_url")
    @classmethod
    def validate_surreal_url(cls, value: str) -> str:
        if not value.startswith(_ALLOWED_SCHEMES):
            raise ValueError(f"Unsupported surreal_url scheme: {value}")
        if value == "mem://":
            return value
        target = value.split("://", 1)[1]
        if not target.strip():
            raise ValueError(f"Empty surreal_url target: {value}")
        return value

    @field_validator("litellm_url")
    @classmethod
    def validate_litellm_url(cls, value: str) -> str:
        if not value.startswith(_LITELLM_SCHEMES):
            raise ValueError(f"Unsupported litellm_url scheme: {value}")
        parsed = urlsplit(value)
        if not parsed.netloc or not parsed.hostname or not parsed.hostname.strip():
            raise ValueError(f"Empty litellm_url host: {value}")
        return value

    def project_database_name(self, project_id: str) -> str:
        if not _PROJECT_ID_RE.match(project_id):
            raise MemoryValidationError(f"Invalid project_id: {project_id!r}")
        normalized = project_id.replace("-", "_")
        return f"{self.project_prefix}{normalized}"


def load_memory_settings(  # noqa: PLR0913
    surreal_url: str | None = None,
    namespace: str | None = None,
    user_database: str | None = None,
    project_prefix: str | None = None,
    embedding_dimensions: int | None = None,
    *,
    litellm_url: str | None = None,
    litellm_api_key: SecretStr | None = None,
    embed_role: str | None = None,
    decision_role: str | None = None,
    model_timeout_seconds: float | None = None,
) -> MemorySettings:
    overrides: _SettingsOverrides = {}
    if surreal_url is not None:
        overrides["surreal_url"] = surreal_url
    if namespace is not None:
        overrides["namespace"] = namespace
    if user_database is not None:
        overrides["user_database"] = user_database
    if project_prefix is not None:
        overrides["project_prefix"] = project_prefix
    if embedding_dimensions is not None:
        overrides["embedding_dimensions"] = embedding_dimensions
    if litellm_url is not None:
        overrides["litellm_url"] = litellm_url
    if litellm_api_key is not None:
        overrides["litellm_api_key"] = litellm_api_key
    if embed_role is not None:
        overrides["embed_role"] = embed_role
    if decision_role is not None:
        overrides["decision_role"] = decision_role
    if model_timeout_seconds is not None:
        overrides["model_timeout_seconds"] = model_timeout_seconds
    try:
        return MemorySettings(**overrides)
    except ValidationError as error:
        raise MemoryConfigError(f"Invalid memory settings: {error}") from error
