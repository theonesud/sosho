"""Pure helpers that read a LangGraph state snapshot for the run detail view."""

import json
from collections.abc import Mapping, Sequence

from langgraph.types import PregelTask
from pydantic import BaseModel, Field, JsonValue


class _RunDataView(BaseModel):
    """Run data as JSON. Validation rejects a value that JSON cannot hold."""

    data: dict[str, JsonValue] = Field(default_factory=dict)


def run_data(values: Mapping[str, object]) -> dict[str, JsonValue]:
    """Return the run data from a snapshot. Return an empty map before the first step."""
    payload = json.loads(json.dumps(values, default=str))
    return _RunDataView.model_validate(payload).data


def pending_interrupts(tasks: Sequence[PregelTask]) -> list[JsonValue]:
    """Return the interrupt values that wait for a decision, with their node names."""
    pending: list[JsonValue] = []
    for task in tasks:
        for interrupt in task.interrupts:
            entry = json.dumps({"nodeId": task.name, "value": interrupt.value}, default=str)
            pending.append(json.loads(entry))
    return pending
