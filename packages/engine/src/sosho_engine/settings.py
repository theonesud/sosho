from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SOSHO_ENGINE_", extra="ignore", frozen=True)

    db_url: str = "sqlite:///.pi/run/engine/engine.sqlite"
    api_token: SecretStr = Field(default=SecretStr(""), min_length=16, validate_default=True)
    app_version: str = "1"
    host: str = "127.0.0.1"
    port: int = 8123
    max_body_bytes: int = 1_048_576
    webhook_rate_per_minute: int = Field(default=60, ge=1)
    litellm_base_url: str = "http://127.0.0.1:4000/v1"
    litellm_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LITELLM_MASTER_KEY")
    )
    langfuse_host: str | None = Field(default=None, validation_alias=AliasChoices("LANGFUSE_HOST"))
    langfuse_public_key: str | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_PUBLIC_KEY")
    )
    langfuse_secret_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_SECRET_KEY")
    )

    def sqlite_path(self) -> Path | None:
        prefix = "sqlite:///"
        if self.db_url.startswith(prefix):
            return Path(self.db_url.removeprefix(prefix))
        return None
