import logging

from langfuse import Langfuse
from pydantic_ai import Agent

from sosho_engine.settings import Settings

logger = logging.getLogger(__name__)


def start_tracing(settings: Settings) -> bool:
    if not (
        settings.langfuse_host and settings.langfuse_public_key and settings.langfuse_secret_key
    ):
        logger.info("langfuse tracing is off")
        return False
    Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key.get_secret_value(),
        host=settings.langfuse_host,
    )
    Agent.instrument_all()
    logger.info("langfuse tracing is on")
    return True
