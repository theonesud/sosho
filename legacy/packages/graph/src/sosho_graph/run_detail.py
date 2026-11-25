import json
from collections.abc import Mapping, Sequence

from langgraph.types import PregelTask
from pydantic import BaseModel, Field, JsonValue


class _RunDataView(BaseModel):
    data: dict[str, JsonValue] = Field(default_factory=dict)


def run_data(values: Mapping[str, object]) -> dict[str, JsonValue]:
    payload = json.loads(json.dumps(values, default=str))
    return _RunDataView.model_validate(payload).data


def pending_interrupts(tasks: Sequence[PregelTask]) -> list[JsonValue]:
    pending: list[JsonValue] = []
    for task in tasks:
        for interrupt in task.interrupts:
            entry = json.dumps({"nodeId": task.name, "value": interrupt.value}, default=str)
            pending.append(json.loads(entry))
    return pending
