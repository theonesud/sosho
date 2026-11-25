from pydantic import BaseModel, JsonValue

from sosho_engine.spec_nodes import Node, NodeKind
from sosho_engine.tools import JsonDict


class Inherited(BaseModel):
    llm_budget: int
    allowed_kinds: list[NodeKind] | None
    allowed_tools: list[str] | None
    max_depth: int


class RunParams(BaseModel):
    workflow_id: str
    version: int | None = None
    input: JsonDict = {}
    trigger_node: str | None = None
    depth: int = 0
    parent_run_id: str | None = None
    inherited: Inherited | None = None


class NodeJob(BaseModel):
    run_id: str
    node: Node
    data: dict[str, JsonValue]
    llm_left: int
    allowed_tools: list[str] | None = None
    join_inputs: dict[str, JsonValue] = {}
    join_dead: list[str] = []


class NodeResult(BaseModel):
    output: JsonDict
    llm_calls: int = 0
