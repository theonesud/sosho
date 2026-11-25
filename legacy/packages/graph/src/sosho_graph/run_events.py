import json
from dataclasses import dataclass, field
from typing import Literal

from langchain_core.messages import AnyMessage
from langgraph.types import StreamPart, TaskPayload, TaskResultPayload
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from pydantic.alias_generators import to_camel

from sosho_graph.state import GraphState

type EventType = Literal["node_start", "node_end", "token", "interrupt", "error", "done"]


class RunEvent(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    seq: int
    type: EventType
    node_id: str | None = None
    data: dict[str, JsonValue] = Field(default_factory=dict)
    at: str


@dataclass(frozen=True)
class EventDraft:
    type: EventType
    node_id: str | None
    data: dict[str, JsonValue] = field(default_factory=dict[str, JsonValue])


def _json_value(value: object) -> JsonValue:
    converted: JsonValue = json.loads(json.dumps(value, default=str))
    return converted


def _task_drafts(data: TaskPayload | TaskResultPayload) -> list[EventDraft]:
    if "input" in data:
        return [EventDraft("node_start", data["name"])]
    name = data["name"]
    if data["error"] is not None:
        return [EventDraft("error", name, {"message": data["error"]})]
    interrupts: JsonValue = json.loads(json.dumps(data["interrupts"], default=str))
    if interrupts:
        return [EventDraft("interrupt", name, {"interrupts": interrupts})]
    writes = sorted(str(key) for key in data["result"])
    return [EventDraft("node_end", name, {"writes": _json_value(writes)})]


def _token_drafts(data: tuple[AnyMessage, dict[str, object]]) -> list[EventDraft]:
    message, metadata = data
    text = message.text
    node = metadata.get("langgraph_node")
    if not text or not isinstance(node, str):
        return []
    return [EventDraft("token", node, {"text": text})]


def drafts_from_part(part: StreamPart[GraphState, GraphState]) -> list[EventDraft]:
    if part["type"] == "tasks":
        return _task_drafts(part["data"])
    if part["type"] == "messages":
        return _token_drafts(part["data"])
    return []
