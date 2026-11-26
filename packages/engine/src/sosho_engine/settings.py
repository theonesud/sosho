from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from sosho_engine.placement import DEFAULT_DIRECT_ROLES
from sosho_engine.version import PACKAGE_DIR, source_version

REPO_ROOT = PACKAGE_DIR.parents[3]
ENGINE_EXECUTOR = "engine"
WORKER_EXECUTOR = "host-worker"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SOSHO_ENGINE_", extra="ignore", frozen=True, env_ignore_empty=True
    )

    db_url: str = "sqlite:///.pi/run/engine/engine.sqlite"
    api_token: SecretStr = Field(default=SecretStr(""), min_length=16, validate_default=True)
    app_version: str = Field(default_factory=source_version, min_length=1)
    executor_id: str = ENGINE_EXECUTOR
    repo_root: Path = REPO_ROOT
    skills_dir: Path | None = None
    runs_dir: Path = Field(default_factory=lambda: Path.home() / ".sosho" / "runs")
    pi_command: str | None = None
    pi_default_timeout_seconds: float = Field(default=900.0, gt=0.0)
    pi_stdout_cap_bytes: int = Field(default=20_971_520, ge=1024)
    pi_line_cap_bytes: int = Field(default=20_971_520, ge=1024)
    gpu_roles: list[str] = ["local-uncensored"]
    direct_roles: list[str] = list(DEFAULT_DIRECT_ROLES)
    pi_extensions: list[str] = ["guard", "langfuse"]
    worker_poll_seconds: float = Field(default=2.0, gt=0.0)
    worker_beat_seconds: float = Field(default=10.0, gt=0.0)
    worker_alive_seconds: float = Field(default=30.0, gt=0.0)
    host: str = "127.0.0.1"
    port: int = 8123
    max_body_bytes: int = 1_048_576
    webhook_rate_per_minute: int = Field(default=60, ge=1)
    litellm_base_url: str = "http://127.0.0.1:4000/v1"
    litellm_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LITELLM_MASTER_KEY")
    )
    pg_user: str = Field(default="postgres", validation_alias=AliasChoices("LANGFUSE_PG_USER"))
    pg_password: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_PG_PASSWORD")
    )
    pg_port: int = Field(default=5432, validation_alias=AliasChoices("SOSHO_POSTGRES_PORT"))
    langfuse_host: str | None = Field(default=None, validation_alias=AliasChoices("LANGFUSE_HOST"))
    langfuse_public_key: str | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_PUBLIC_KEY")
    )
    langfuse_secret_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_SECRET_KEY")
    )

    def pi_path(self) -> str:
        return self.pi_command or str(self.repo_root / "bin" / "pi-launcher.sh")

    def pi_extension_paths(self) -> list[Path]:
        root = self.repo_root / ".pi" / "extensions"
        return [root / name / "src" / "index.ts" for name in self.pi_extensions]

    def skills_path(self) -> Path:
        return self.skills_dir or self.repo_root / ".agents" / "skills"

    def sqlite_path(self) -> Path | None:
        prefix = "sqlite:///"
        if self.db_url.startswith(prefix):
            return Path(self.db_url.removeprefix(prefix))
        return None
