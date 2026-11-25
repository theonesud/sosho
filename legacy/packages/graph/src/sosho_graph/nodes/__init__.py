from sosho_graph.nodes.builtin import END_KIND, START_KIND
from sosho_graph.nodes.checkpoint import CHECKPOINT_KIND
from sosho_graph.nodes.decision import DECISION_KIND
from sosho_graph.nodes.llm_nodes import AGENT_KIND, SUBAGENT_KIND
from sosho_graph.registry import NodeKind, NodeRegistry


def default_kinds() -> list[NodeKind]:
    return [AGENT_KIND, SUBAGENT_KIND, DECISION_KIND, CHECKPOINT_KIND, START_KIND, END_KIND]


def default_registry() -> NodeRegistry:
    return NodeRegistry(default_kinds())
