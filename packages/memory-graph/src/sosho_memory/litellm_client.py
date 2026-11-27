from collections.abc import Sequence
from types import TracebackType
from typing import Self

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from sosho_memory.config import MemorySettings
from sosho_memory.errors import MemoryModelError


class _ChatMessage(BaseModel):
    model_config = ConfigDict(frozen=True)

    content: str | None = None
    reasoning_content: str | None = None


class _ChatChoice(BaseModel):
    model_config = ConfigDict(frozen=True)

    message: _ChatMessage


class _ChatResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    choices: list[_ChatChoice]


class _EmbeddingItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    embedding: list[float]


class _EmbeddingResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    data: list[_EmbeddingItem]


def _strip_json_fence(raw_text: str) -> str:
    text = raw_text.strip()
    if not text.startswith("```"):
        return text
    first_newline = text.find("\n")
    if first_newline != -1:
        body = text[first_newline + 1 :]
    else:
        body = text.removeprefix("```")
        if body.lower().startswith("json"):
            body = body[4:]
    if body.endswith("```"):
        body = body[:-3]
    return body.strip()


def _extract_message_text(message: _ChatMessage) -> str:
    if message.content is not None and message.content.strip():
        return message.content
    if message.reasoning_content is not None and message.reasoning_content.strip():
        return message.reasoning_content
    raise MemoryModelError("LiteLLM chat completion returned empty message content")


class LiteLLMClient:
    def __init__(
        self,
        settings: MemorySettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> Self:
        self._ensure_client()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            headers: dict[str, str] = {}
            if self._settings.litellm_api_key is not None:
                token = self._settings.litellm_api_key.get_secret_value()
                if token:
                    headers["Authorization"] = f"Bearer {token}"
            self._client = httpx.AsyncClient(
                base_url=self._settings.litellm_url.rstrip("/"),
                timeout=self._settings.model_timeout_seconds,
                headers=headers,
                transport=self._transport,
            )
        return self._client

    async def _post_validated[T: BaseModel](
        self,
        path: str,
        payload: dict[str, object],
        response_model: type[T],
        operation: str,
    ) -> T:
        client = self._ensure_client()
        try:
            response = await client.post(path, json=payload)
            response.raise_for_status()
            return response_model.model_validate_json(response.content)
        except httpx.HTTPError as error:
            raise MemoryModelError(f"LiteLLM {operation} request failed: {error}") from error
        except ValidationError as error:
            raise MemoryModelError(
                f"LiteLLM {operation} response validation failed: {error}"
            ) from error

    async def embed(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        if not texts:
            return ()
        payload: dict[str, object] = {
            "model": self._settings.embed_role,
            "input": list(texts),
        }
        parsed = await self._post_validated(
            "/v1/embeddings", payload, _EmbeddingResponse, "embeddings"
        )
        if len(parsed.data) != len(texts):
            raise MemoryModelError(
                f"LiteLLM embeddings count mismatch: expected {len(texts)}, got {len(parsed.data)}"
            )
        vectors: list[tuple[float, ...]] = []
        for index, item in enumerate(parsed.data):
            if not item.embedding:
                raise MemoryModelError(f"LiteLLM embedding vector at index {index} is empty")
            vectors.append(tuple(item.embedding))
        return tuple(vectors)

    async def decide_json[T: BaseModel](
        self,
        system_prompt: str,
        user_prompt: str,
        response_model: type[T],
        *,
        max_tokens: int = 512,
    ) -> T:
        payload: dict[str, object] = {
            "model": self._settings.decision_role,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.0,
        }
        parsed = await self._post_validated(
            "/v1/chat/completions", payload, _ChatResponse, "chat completion"
        )
        if not parsed.choices:
            raise MemoryModelError("LiteLLM chat completion returned no choices")
        raw_text = _extract_message_text(parsed.choices[0].message)
        cleaned = _strip_json_fence(raw_text)
        try:
            return response_model.model_validate_json(cleaned)
        except ValidationError as error:
            raise MemoryModelError(f"LiteLLM decision JSON validation failed: {error}") from error
