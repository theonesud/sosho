from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class SettingsError(ValueError):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    sosho_graph_db: Path = Path(".pi/run/graph/checkpoints.sqlite")
    litellm_base_url: str = "http://127.0.0.1:4000/v1"
    litellm_api_key: SecretStr | None = None
    langfuse_host: str | None = None
    langfuse_public_key: SecretStr | None = None
    langfuse_secret_key: SecretStr | None = None

    def litellm_key(self) -> SecretStr:
        if self.litellm_api_key is None:
            raise SettingsError("LITELLM_API_KEY is not set")
        return self.litellm_api_key
