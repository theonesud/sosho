from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from sosho_engine.runtime import ModelFactory
from sosho_engine.settings import Settings


def litellm_models(settings: Settings) -> ModelFactory:
    key = settings.litellm_api_key.get_secret_value() if settings.litellm_api_key else "unset"

    def make(role: str) -> Model:
        provider = OpenAIProvider(base_url=settings.litellm_base_url, api_key=key)
        return OpenAIChatModel(role, provider=provider)

    return make
