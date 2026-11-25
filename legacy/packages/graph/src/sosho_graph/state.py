from typing import Annotated, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph.state import CompiledStateGraph
from pydantic import JsonValue


def merge_maps[K, V](left: dict[K, V], right: dict[K, V]) -> dict[K, V]:
    return {**left, **right}


class GraphState(TypedDict):
    data: Annotated[dict[str, JsonValue], merge_maps]
    branches: Annotated[dict[str, str], merge_maps]


class NodeUpdate(TypedDict, total=False):
    data: dict[str, JsonValue]
    branches: dict[str, str]


type Checkpointer = BaseCheckpointSaver[str]
type GraphApp = CompiledStateGraph[GraphState, None, GraphState, GraphState]
