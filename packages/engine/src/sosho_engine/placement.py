from collections.abc import Collection

from sosho_engine.spec_nodes import AgentNode, LlmNode, Node, SkillNode

DEFAULT_DIRECT_ROLES = ("decision",)
HostNode = AgentNode | SkillNode | LlmNode


def is_host_node(node: Node, direct_roles: Collection[str]) -> bool:
    if isinstance(node, LlmNode):
        return node.role not in direct_roles
    return isinstance(node, (AgentNode, SkillNode))
