"""Built-in node kinds. Add a kind to default_kinds to expose it in the catalog."""

from sosho_graph.nodes.builtin import END_KIND, START_KIND
from sosho_graph.nodes.checkpoint import CHECKPOINT_KIND
from sosho_graph.nodes.decision import DECISION_KIND
from sosho_graph.nodes.llm_nodes import AGENT_KIND, SUBAGENT_KIND
from sosho_graph.registry import NodeKind, NodeRegistry


def default_kinds() -> list[NodeKind]:
    """Return the built-in node kinds."""
    return [AGENT_KIND, SUBAGENT_KIND, DECISION_KIND, CHECKPOINT_KIND, START_KIND, END_KIND]


def default_registry() -> NodeRegistry:
    """Return a registry with the built-in kinds."""
    return NodeRegistry(default_kinds())
