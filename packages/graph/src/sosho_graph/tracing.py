"""Langfuse tracing. Tracing stays off unless all three Langfuse settings are set."""

from dataclasses import dataclass

from langchain_core.callbacks import BaseCallbackHandler
from langfuse import Langfuse
from langfuse.langchain import CallbackHandler

from sosho_graph.settings import Settings


@dataclass(frozen=True)
class Tracing:
    """Callbacks for each run and the client that flushes them at shutdown."""

    callbacks: list[BaseCallbackHandler]
    client: Langfuse | None


def open_tracing(settings: Settings) -> Tracing:
    """Create the Langfuse client and callback handler. Return no handlers when keys are missing."""
    if settings.langfuse_host is None or settings.langfuse_public_key is None:
        return Tracing(callbacks=[], client=None)
    if settings.langfuse_secret_key is None:
        return Tracing(callbacks=[], client=None)
    public_key = settings.langfuse_public_key.get_secret_value()
    client = Langfuse(
        public_key=public_key,
        secret_key=settings.langfuse_secret_key.get_secret_value(),
        host=settings.langfuse_host,
    )
    return Tracing(callbacks=[CallbackHandler(public_key=public_key)], client=client)


def close_tracing(tracing: Tracing) -> None:
    """Send the pending traces before the service stops."""
    if tracing.client is not None:
        tracing.client.flush()
