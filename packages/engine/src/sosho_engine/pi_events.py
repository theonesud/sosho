import json
from dataclasses import dataclass, field

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

MAX_TOOL_CALLS = 200
TRACKED = frozenset({"message_end", "turn_end", "tool_execution_end", "agent_end"})


class Wire(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class WireCost(Wire):
    total: float = 0.0


class WireUsage(Wire):
    input: int = 0
    output: int = 0
    cache_read: int = Field(default=0, alias="cacheRead")
    reasoning: int = 0
    total_tokens: int = Field(default=0, alias="totalTokens")
    cost: WireCost = WireCost()


class WireContent(Wire):
    type: str
    text: str | None = None


class WireMessage(Wire):
    role: str
    content: list[WireContent] | str | None = None
    usage: WireUsage | None = None
    stop_reason: str | None = Field(default=None, alias="stopReason")
    error_message: str | None = Field(default=None, alias="errorMessage")


class WireEvent(Wire):
    type: str
    message: WireMessage | None = None
    messages: list[WireMessage] = []
    tool_name: str | None = Field(default=None, alias="toolName")
    is_error: bool = Field(default=False, alias="isError")


def _no_calls() -> list[dict[str, JsonValue]]:
    return []


@dataclass
class PiTrace:
    turns: int = 0
    tokens: dict[str, int] = field(
        default_factory=lambda: {
            "input": 0,
            "output": 0,
            "cache_read": 0,
            "reasoning": 0,
            "total_tokens": 0,
        }
    )
    cost: float = 0.0
    tool_calls: list[dict[str, JsonValue]] = field(default_factory=_no_calls)
    text: str | None = None
    stop_reason: str | None = None
    error_message: str | None = None
    ended: bool = False

    def feed(self, line: bytes) -> str | None:
        event = _parse(line)
        if event is None:
            return None
        if event.type == "message_end":
            self._add_usage(event.message)
        elif event.type == "turn_end":
            self.turns += 1
        elif event.type == "tool_execution_end":
            self._add_tool(event)
        elif event.type == "agent_end":
            self._finish(event.messages)
        return event.type

    def _add_usage(self, message: WireMessage | None) -> None:
        if message is None or message.role != "assistant" or message.usage is None:
            return
        usage = message.usage
        self.tokens["input"] += usage.input
        self.tokens["output"] += usage.output
        self.tokens["cache_read"] += usage.cache_read
        self.tokens["reasoning"] += usage.reasoning
        self.tokens["total_tokens"] += usage.total_tokens
        self.cost += usage.cost.total

    def _add_tool(self, event: WireEvent) -> None:
        if len(self.tool_calls) < MAX_TOOL_CALLS:
            self.tool_calls.append({"name": event.tool_name or "", "ok": not event.is_error})

    def _finish(self, messages: list[WireMessage]) -> None:
        self.ended = True
        last = next((m for m in reversed(messages) if m.role == "assistant"), None)
        if last is None:
            return
        self.stop_reason = last.stop_reason
        self.error_message = last.error_message
        content = last.content
        if isinstance(content, str):
            self.text = content
        elif content is not None:
            self.text = "".join(item.text or "" for item in content if item.type == "text")


def _parse(line: bytes) -> WireEvent | None:
    try:
        raw: JsonValue = json.loads(line)
    except ValueError:
        return None
    kind = raw.get("type") if isinstance(raw, dict) else None
    if not isinstance(kind, str):
        return None
    if kind not in TRACKED:
        return WireEvent(type=kind)
    try:
        return WireEvent.model_validate(raw)
    except ValidationError:
        return None
