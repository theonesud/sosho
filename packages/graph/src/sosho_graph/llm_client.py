"""LiteLLM model factory. Each role name is a LiteLLM model name."""

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from sosho_graph.registry import ModelFactory
from sosho_graph.settings import Settings

MODEL_MAX_RETRIES = 2


def litellm_model_factory(settings: Settings) -> ModelFactory:
    """Return a factory that builds an OpenAI-compatible client for a role name."""

    def make_model(role: str) -> BaseChatModel:
        return ChatOpenAI(
            model=role,
            base_url=settings.litellm_base_url,
            api_key=settings.litellm_key(),
            max_retries=MODEL_MAX_RETRIES,
        )

    return make_model
