import json
import threading
from collections.abc import Generator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
from live_support import ROUTE

from tests.conftest import LITELLM_URL

DROPPED_REQUEST = {"host", "content-length", "accept-encoding", "connection"}
DROPPED_RESPONSE = {"content-length", "content-encoding", "transfer-encoding", "connection"}
FAULT_STATUS = 400
UPSTREAM_TIMEOUT = 600.0


class FaultProxy:
    def __init__(self, upstream: str, fail_first: int) -> None:
        self.upstream = upstream
        self.fail_first = fail_first
        self.requests = 0
        self.failed = 0
        self._lock = threading.Lock()
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    def should_fail(self) -> bool:
        with self._lock:
            self.requests += 1
            failing = self.requests <= self.fail_first
            self.failed += int(failing)
            return failing

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                del format, args

            def _send(self, status: int, headers: dict[str, str], body: bytes) -> None:
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                if proxy.should_fail():
                    fault = {"error": {"message": "injected fault", "type": "fault"}}
                    self._send(
                        FAULT_STATUS,
                        {"Content-Type": "application/json"},
                        json.dumps(fault).encode(),
                    )
                    return
                sent = {k: v for k, v in self.headers.items() if k.lower() not in DROPPED_REQUEST}
                reply = httpx.post(
                    proxy.upstream + self.path, content=body, headers=sent, timeout=UPSTREAM_TIMEOUT
                )
                kept = {k: v for k, v in reply.headers.items() if k.lower() not in DROPPED_RESPONSE}
                self._send(reply.status_code, kept, reply.content)

        return Handler

    def start(self) -> None:
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()


@contextmanager
def fault_proxy(upstream: str, fail_first: int) -> Generator[FaultProxy]:
    proxy = FaultProxy(upstream, fail_first)
    proxy.start()
    try:
        yield proxy
    finally:
        proxy.stop()


@contextmanager
def routed(fail_first: int = 0) -> Generator[FaultProxy]:
    with fault_proxy(LITELLM_URL, fail_first) as proxy:
        previous = ROUTE.base_url
        ROUTE.base_url = f"{proxy.url}/v1"
        try:
            yield proxy
        finally:
            ROUTE.base_url = previous
