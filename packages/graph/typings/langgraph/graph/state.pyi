# Typed declarations for langgraph.graph.state. See __init__.pyi in this folder.
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.types import Command, StateSnapshot, StreamPart

class CompiledStateGraph[StateT, ContextT, InputT, OutputT]:
    def astream(
        self,
        input: InputT | Command[str] | None,
        config: RunnableConfig | None = None,
        *,
        stream_mode: Sequence[Literal["tasks", "messages"]],
        version: Literal["v2"],
    ) -> AsyncIterator[StreamPart[OutputT, StateT]]: ...
    async def aget_state(self, config: RunnableConfig) -> StateSnapshot: ...

class StateGraph[StateT, ContextT, InputT, OutputT]:
    def __init__(self, state_schema: type[StateT]) -> None: ...
    def add_node(
        self,
        node: str,
        action: Callable[[StateT, RunnableConfig], Awaitable[Mapping[str, object]]],
    ) -> None: ...
    def add_edge(self, start_key: str, end_key: str) -> None: ...
    def add_conditional_edges(
        self,
        source: str,
        path: Callable[[StateT], Sequence[str]],
        path_map: Sequence[str],
    ) -> None: ...
    def compile(
        self, checkpointer: BaseCheckpointSaver[str] | None = None
    ) -> CompiledStateGraph[StateT, ContextT, InputT, OutputT]: ...
