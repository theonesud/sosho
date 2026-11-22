from sosho_graph.registry import NodeConfig, NodeContext, TypedNodeKind
from sosho_graph.state import NodeUpdate


class NoConfig(NodeConfig):
    pass


async def run_no_op(ctx: NodeContext, node: NoConfig) -> NodeUpdate:
    return {}


START_KIND = TypedNodeKind(
    type_id="start",
    display_name="Start",
    description="Mark the entry of a graph. Writes no state.",
    config_model=NoConfig,
    output_schema={"type": "object"},
    runner=run_no_op,
)

END_KIND = TypedNodeKind(
    type_id="end",
    display_name="End",
    description="Mark an exit of a graph. Writes no state.",
    config_model=NoConfig,
    output_schema={"type": "object"},
    runner=run_no_op,
)
