"""ASGI middleware that answers HTTP 413 when a request body passes a byte limit."""

from dataclasses import dataclass

from starlette.types import ASGIApp, Message, Receive, Scope, Send

PAYLOAD_TOO_LARGE = 413


class BodyTooLargeError(Exception):
    """Raised inside the receive callable when the body passes the limit."""


@dataclass
class _Overflow:
    """Records that the body passed the limit. The app response is then dropped."""

    overflowed: bool = False


class BodyLimitMiddleware:
    """Stop reading a request body after max_bytes bytes. Return 413 for the request."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self._app = app
        self._max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        if _declared_length(scope) > self._max_bytes:
            await _send_too_large(send)
            return
        state = _Overflow()
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self._max_bytes:
                    state.overflowed = True
                    raise BodyTooLargeError
            return message

        async def guarded_send(message: Message) -> None:
            if not state.overflowed:
                await send(message)

        try:
            await self._app(scope, limited_receive, guarded_send)
        except BodyTooLargeError:
            state.overflowed = True
        if state.overflowed:
            await _send_too_large(send)


def _declared_length(scope: Scope) -> int:
    """Return the Content-Length header value. Return 0 when it is missing or not a number."""
    for name, value in scope.get("headers", []):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return 0
    return 0


async def _send_too_large(send: Send) -> None:
    body = b'{"error":"request body exceeds the limit"}'
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    await send({"type": "http.response.start", "status": PAYLOAD_TOO_LARGE, "headers": headers})
    await send({"type": "http.response.body", "body": body})
