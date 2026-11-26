from collections.abc import Callable, Collection

from sosho_engine.graph import adjacency, has_cycle, incoming_edges, reachable
from sosho_engine.issues import Issue
from sosho_engine.placement import DEFAULT_DIRECT_ROLES, is_host_node
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import (
    AgentNode,
    HumanNode,
    LlmNode,
    MapNode,
    Node,
    RouterNode,
    SkillNode,
    SubworkflowNode,
    ToolNode,
    TriggerNode,
)
from sosho_engine.templating import referenced_nodes, template_paths
from sosho_engine.validation_extra import (
    check_conditions,
    check_cron_triggers,
    check_loop_exits,
    check_retry,
)

QUEUE_KINDS = frozenset({"llm", "agent", "skill", "tool"})
PI_ROLES = frozenset({"main", "subagent", "subagent-code", "local-uncensored", "cloud-uncensored"})
BRANCH_KINDS = frozenset({"router", "human"})


class SpecInvalidError(ValueError):
    def __init__(self, issues: list[Issue]) -> None:
        super().__init__("; ".join(f"{issue.code}: {issue.message}" for issue in issues))
        self.issues = issues


Check = Callable[[Workflow], list[Issue]]


def _check_ids(spec: Workflow) -> list[Issue]:
    seen: set[str] = set()
    issues: list[Issue] = []
    for node in spec.nodes:
        if node.id in seen:
            issues.append(Issue("duplicate_node", f"node id {node.id} is used twice", node.id))
        seen.add(node.id)
    entry = spec.node_map().get(spec.entry)
    if entry is None:
        issues.append(Issue("unknown_entry", f"entry {spec.entry} is not a node"))
    elif not isinstance(entry, TriggerNode):
        issues.append(Issue("entry_not_trigger", "entry must be a trigger node", spec.entry))
    return issues


def _check_edges(spec: Workflow) -> list[Issue]:
    nodes = spec.node_map()
    issues: list[Issue] = []
    for edge in spec.edges:
        issues.extend(
            Issue("dangling_edge", f"edge uses unknown node {end}", end)
            for end in (edge.source, edge.target)
            if end not in nodes
        )
        if edge.loop and edge.max_iterations is None:
            issues.append(Issue("loop_unbounded", "a loop edge needs max_iterations", edge.source))
        if not edge.loop and edge.max_iterations is not None:
            issues.append(Issue("loop_flag", "max_iterations needs loop=true", edge.source))
        if edge.target in nodes and isinstance(nodes[edge.target], TriggerNode):
            issues.append(Issue("trigger_input", "a trigger has no input edge", edge.target))
    return issues


def _branch_names(node: Node) -> set[str]:
    if isinstance(node, RouterNode):
        return {branch.name for branch in node.branches}
    if isinstance(node, HumanNode):
        return set(node.actions)
    return set()


def _check_branches(spec: Workflow) -> list[Issue]:
    nodes = spec.node_map()
    issues: list[Issue] = []
    for edge in spec.edges:
        source = nodes.get(edge.source)
        if edge.when is None or source is None:
            continue
        if source.kind not in BRANCH_KINDS:
            issues.append(Issue("when_source", "only router and human edges use when", source.id))
        elif edge.when not in _branch_names(source):
            issues.append(Issue("unknown_branch", f"branch {edge.when} is not defined", source.id))
    issues.extend(
        Issue("unknown_default", "default must name a branch", node.id)
        for node in spec.nodes
        if isinstance(node, RouterNode) and node.default not in (None, *_branch_names(node))
    )
    return issues


def _check_cycles(spec: Workflow) -> list[Issue]:
    ids = [node.id for node in spec.nodes]
    plain = adjacency(spec.edges, include_loops=False)
    if has_cycle(ids, plain):
        return [Issue("cycle", "a cycle needs a loop edge with max_iterations")]
    return [
        Issue("loop_not_back", "a loop edge must point back", edge.source)
        for edge in spec.edges
        if edge.loop and edge.source not in reachable([edge.target], plain)
    ]


def _check_reachable(spec: Workflow) -> list[Issue]:
    starts = [node.id for node in spec.nodes if isinstance(node, TriggerNode)]
    seen = reachable(starts, adjacency(spec.edges, include_loops=True))
    return [
        Issue("unreachable", f"node {node.id} has no path from a trigger", node.id)
        for node in spec.nodes
        if node.id not in seen
    ]


def _check_joins(spec: Workflow) -> list[Issue]:
    incoming = incoming_edges(spec.edges, include_loops=False)
    issues: list[Issue] = []
    for node in spec.nodes:
        count = len(incoming.get(node.id, []))
        if node.kind == "join" and count < 2:
            issues.append(Issue("join_inputs", "a join needs two or more input edges", node.id))
        if node.kind != "join" and count > 1:
            issues.append(Issue("missing_join", "several input edges need a join node", node.id))
    return issues


def _check_queues(spec: Workflow, direct_roles: Collection[str]) -> list[Issue]:
    issues: list[Issue] = []
    for node in spec.nodes:
        on_host = is_host_node(node, direct_roles)
        if node.queue is not None and node.kind not in QUEUE_KINDS:
            issues.append(Issue("queue_kind", f"a {node.kind} node has no queue", node.id))
        if on_host and node.queue not in (None, "host"):
            issues.append(
                Issue("host_queue", f"a {node.kind} node runs only on queue host", node.id)
            )
        if not on_host and node.queue == "host":
            issues.append(Issue("host_queue", f"a {node.kind} node cannot use queue host", node.id))
    return issues


def _check_thinking(spec: Workflow, direct_roles: Collection[str]) -> list[Issue]:
    return [
        Issue("thinking_direct", "a direct llm node has no thinking level", node.id)
        for node in spec.nodes
        if isinstance(node, LlmNode)
        and node.thinking is not None
        and not is_host_node(node, direct_roles)
    ]


def _check_timeouts(spec: Workflow) -> list[Issue]:
    return [
        Issue("timeout_kind", f"a {node.kind} node has no timeout", node.id)
        for node in spec.nodes
        if node.timeout_seconds is not None and node.kind not in QUEUE_KINDS
    ]


def _node_tools(node: Node) -> list[str]:
    if isinstance(node, ToolNode):
        return [node.tool]
    return []


def _node_skills(node: Node) -> list[str]:
    if isinstance(node, SkillNode):
        return [node.skill]
    if isinstance(node, AgentNode):
        return list(node.skills)
    return []


def _check_roles(spec: Workflow) -> list[Issue]:
    return [
        Issue("role_unsupported", f"role {node.role} cannot run a pi session", node.id)
        for node in spec.nodes
        if isinstance(node, (AgentNode, SkillNode)) and node.role not in PI_ROLES
    ]


def check_policy(spec: Workflow) -> list[Issue]:
    policy = spec.policy
    issues: list[Issue] = []
    for node in spec.nodes:
        if policy.allowed_kinds is not None and node.kind not in policy.allowed_kinds:
            issues.append(Issue("kind_denied", f"policy denies {node.kind} nodes", node.id))
        issues.extend(
            Issue("tool_denied", f"policy denies tool {tool}", node.id)
            for tool in _node_tools(node)
            if policy.allowed_tools is not None and tool not in policy.allowed_tools
        )
        issues.extend(
            Issue("skill_denied", f"policy denies skill {skill}", node.id)
            for skill in _node_skills(node)
            if policy.allowed_skills is not None and skill not in policy.allowed_skills
        )
    return issues


def _check_triggers(spec: Workflow) -> list[Issue]:
    return [
        Issue("finished_self", "a workflow cannot start from its own end", node.id)
        for node in spec.nodes
        if isinstance(node, TriggerNode)
        and node.mode == "workflow_finished"
        and node.source_workflow_id == spec.id
    ]


def _runs_itself(node: Node, spec: Workflow) -> bool:
    if not isinstance(node, (MapNode, SubworkflowNode)):
        return False
    return node.workflow_id == spec.id and node.version == spec.version


def _check_refs(spec: Workflow) -> list[Issue]:
    ids = {node.id for node in spec.nodes}
    issues: list[Issue] = []
    for node in spec.nodes:
        paths = template_paths(node.model_dump(mode="json", exclude={"id", "name"}))
        if isinstance(node, MapNode):
            paths.append(node.items)
        issues.extend(
            Issue("unknown_reference", f"template uses unknown node {ref}", node.id)
            for ref in sorted(referenced_nodes(paths) - ids)
        )
        if _runs_itself(node, spec):
            issues.append(Issue("self_reference", "a node runs its own version", node.id))
    return issues


CHECKS: tuple[Check, ...] = (
    _check_ids,
    _check_edges,
    _check_branches,
    _check_timeouts,
    check_policy,
    _check_roles,
    _check_refs,
    _check_triggers,
    check_cron_triggers,
    check_retry,
    check_loop_exits,
)
GRAPH_CHECKS: tuple[Check, ...] = (_check_cycles, _check_reachable, _check_joins, check_conditions)


def validate_workflow(
    spec: Workflow,
    known_tools: set[str] | None = None,
    known_skills: set[str] | None = None,
    direct_roles: Collection[str] = DEFAULT_DIRECT_ROLES,
) -> list[Issue]:
    issues = [issue for check in CHECKS for issue in check(spec)]
    issues.extend(_check_queues(spec, direct_roles))
    issues.extend(_check_thinking(spec, direct_roles))
    if not any(issue.code in ("dangling_edge", "duplicate_node") for issue in issues):
        issues.extend(issue for check in GRAPH_CHECKS for issue in check(spec))
    if known_tools is not None:
        for node in spec.nodes:
            issues.extend(
                Issue("unknown_tool", f"tool {tool} is not registered", node.id)
                for tool in _node_tools(node)
                if tool not in known_tools
            )
    if known_skills is not None:
        for node in spec.nodes:
            issues.extend(
                Issue("unknown_skill", f"skill {skill} is not in the skill catalog", node.id)
                for skill in _node_skills(node)
                if skill not in known_skills
            )
    return issues


def assert_valid(
    spec: Workflow, known_tools: set[str] | None = None, known_skills: set[str] | None = None
) -> None:
    issues = validate_workflow(spec, known_tools, known_skills)
    if issues:
        raise SpecInvalidError(issues)
