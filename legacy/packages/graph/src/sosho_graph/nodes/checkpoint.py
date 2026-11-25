from typing import Literal

from langgraph.types import interrupt
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from pydantic.alias_generators import to_camel

from sosho_graph.registry import NodeConfig, NodeContext, TypedNodeKind
from sosho_graph.state import NodeUpdate


class HumanDecision(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra="forbid"
    )

    action: Literal["approve", "reject"] = "approve"
    node_id: str | None = None
    state_patch: dict[str, JsonValue] | None = None
    note: str | None = None


class CheckpointConfig(NodeConfig):
    message: str = Field(min_length=1)
    allow_state_edit: bool = True


async def run_checkpoint(ctx: NodeContext, node: CheckpointConfig) -> NodeUpdate:
    raw = interrupt(
        {"nodeId": ctx.node_id, "message": node.message, "data": dict(ctx.state["data"])}
    )
    decision = HumanDecision.model_validate(raw)
    update: NodeUpdate = {"branches": {ctx.node_id: decision.action}}
    if decision.state_patch and node.allow_state_edit:
        update["data"] = dict(decision.state_patch)
    return update


CHECKPOINT_KIND = TypedNodeKind(
    type_id="checkpoint",
    display_name="Human checkpoint",
    description="Pause the run for approve or reject. Edges use approve or reject as condition.",
    config_model=CheckpointConfig,
    output_schema={"type": "object", "properties": {"decision": {"type": "string"}}},
    runner=run_checkpoint,
)
