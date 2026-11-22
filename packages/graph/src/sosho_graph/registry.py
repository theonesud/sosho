"""Node type registry. A new node kind registers here. The compiler does not change."""

import logging
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Protocol

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, ConfigDict, JsonValue
from pydantic.alias_generators import to_camel

from sosho_graph.state import GraphState, NodeUpdate

logger = logging.getLogger(__name__)

ModelFactory = Callable[[str], BaseChatModel]


@dataclass(frozen=True)
class Services:
    """Shared clients that node kinds use. Tests replace them with fakes."""

    model_for: ModelFactory


@dataclass(frozen=True)
class NodeContext:
    """Input for one node call."""

    node_id: str
    state: GraphState
    services: Services
    runnable_config: RunnableConfig


class NodeConfig(BaseModel):
    """Base for node configs. Field names follow the Studio camelCase keys."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra="ignore"
    )


class CatalogEntry(BaseModel):
    """Node kind description that Studio reads to draw a palette."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    type_id: str
    display_name: str
    description: str
    input_schema: dict[str, JsonValue]
    output_schema: dict[str, JsonValue]
    config_schema: dict[str, JsonValue]


type BoundNode = Callable[[NodeContext], Awaitable[NodeUpdate]]


class NodeKind(Protocol):
    """Contract for every node kind."""

    @property
    def type_id(self) -> str: ...

    def catalog_entry(self) -> CatalogEntry: ...

    def bind(self, raw: Mapping[str, JsonValue]) -> BoundNode: ...


@dataclass(frozen=True)
class TypedNodeKind[ConfigT: NodeConfig]:
    """A node kind with a typed config and an async run function."""

    type_id: str
    display_name: str
    description: str
    config_model: type[ConfigT]
    output_schema: dict[str, JsonValue]
    runner: Callable[[NodeContext, ConfigT], Awaitable[NodeUpdate]]

    def catalog_entry(self) -> CatalogEntry:
        """Return the catalog view. The input schema describes the run data."""
        return CatalogEntry(
            type_id=self.type_id,
            display_name=self.display_name,
            description=self.description,
            input_schema={
                "type": "object",
                "description": "Run data. Prompt templates read keys from it.",
                "additionalProperties": True,
            },
            output_schema=self.output_schema,
            config_schema=self.config_model.model_json_schema(by_alias=True),
        )

    def bind(self, raw: Mapping[str, JsonValue]) -> BoundNode:
        """Validate the node config and return a callable. Raise ValidationError when invalid."""
        config = self.config_model.model_validate(raw)
        runner = self.runner

        async def bound(ctx: NodeContext) -> NodeUpdate:
            return await runner(ctx, config)

        return bound


class NodeRegistryError(ValueError):
    """Raised when two kinds use the same type id."""


class NodeRegistry:
    """Map from node type id to node kind."""

    def __init__(self, kinds: Iterable[NodeKind]) -> None:
        self._kinds: dict[str, NodeKind] = {}
        for kind in kinds:
            self.register(kind)

    def register(self, kind: NodeKind) -> None:
        """Add a kind. Stop when the type id already exists."""
        if kind.type_id in self._kinds:
            raise NodeRegistryError(f"node type '{kind.type_id}' is already registered")
        self._kinds[kind.type_id] = kind
        logger.info("node type registered type_id=%s", kind.type_id)

    def get(self, type_id: str) -> NodeKind | None:
        """Return the kind for a type id, or None when no kind matches."""
        return self._kinds.get(type_id)

    def catalog(self) -> list[CatalogEntry]:
        """Return all catalog entries sorted by type id."""
        return [self._kinds[key].catalog_entry() for key in sorted(self._kinds)]
