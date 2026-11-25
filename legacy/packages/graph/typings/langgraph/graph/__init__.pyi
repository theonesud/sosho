# Typed declarations for langgraph.graph. Reason: langgraph 1.2.24 ships no py.typed
# marker in langgraph/graph, so pyright strict treats the installed module as untyped.
# The declarations cover only the API that packages/graph uses. Update them with langgraph.
from typing import Literal

from langgraph.graph.state import StateGraph as StateGraph

START: Literal["__start__"]
END: Literal["__end__"]

__all__ = ["END", "START", "StateGraph"]
