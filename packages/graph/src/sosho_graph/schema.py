"""Envelope models for the Studio graph JSON. Node type fields live in node configs."""

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

ENVELOPE_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class Position(BaseModel):
    """Canvas position. The service does not use it for execution."""

    model_config = ENVELOPE_CONFIG

    x: float
    y: float


class GraphNode(BaseModel):
    """One Studio node. Extra fields stay in the model for the node kind to read."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra="allow"
    )

    id: str = Field(min_length=1)
    type: str = Field(min_length=1)
    label: str = Field(min_length=1)
    position: Position | None = None


class GraphEdge(BaseModel):
    """One directed edge. Edge middleware is not executed by this service."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra="ignore"
    )

    id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    condition: str | None = None


class GraphDefinition(BaseModel):
    """A Studio graph. Unknown top-level fields are ignored."""

    model_config = ENVELOPE_CONFIG

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str | None = None
    version: int = Field(default=1, ge=1)
    entry_node: str = Field(min_length=1)
    max_steps: int = Field(default=50, ge=1, le=200)
    nodes: list[GraphNode] = Field(min_length=1)
    edges: list[GraphEdge]
