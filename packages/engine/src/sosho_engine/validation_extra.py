from collections import defaultdict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter

from sosho_engine.graph import reachable
from sosho_engine.issues import Issue
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import HumanNode, RetryPolicy, RouterNode, TriggerNode
from sosho_engine.templating import NODE_REF, referenced_nodes, template_paths

RETRY_KINDS = frozenset({"llm", "agent", "skill", "tool", "router", "join"})
PATH_ROOTS = frozenset({"input", "nodes", "loop"})


def check_cron(node: TriggerNode) -> list[Issue]:
    issues: list[Issue] = []
    if not croniter.is_valid(node.cron or "", second_at_beginning=True):
        issues.append(Issue("bad_cron", f"cron string {node.cron} is not valid", node.id))
    if node.cron_timezone:
        try:
            ZoneInfo(node.cron_timezone)
        except (ZoneInfoNotFoundError, ModuleNotFoundError, ValueError):
            issues.append(
                Issue("bad_timezone", f"time zone {node.cron_timezone} is unknown", node.id)
            )
    return issues


def check_cron_triggers(spec: Workflow) -> list[Issue]:
    return [
        issue
        for node in spec.nodes
        if isinstance(node, TriggerNode) and node.mode == "cron"
        for issue in check_cron(node)
    ]


def check_retry(spec: Workflow) -> list[Issue]:
    return [
        Issue("retry_kind", f"a {node.kind} node has no retry", node.id)
        for node in spec.nodes
        if node.kind not in RETRY_KINDS and node.retry != RetryPolicy()
    ]


def check_loop_exits(spec: Workflow) -> list[Issue]:
    nodes = spec.node_map()
    issues: list[Issue] = []
    for edge in spec.edges:
        source = nodes.get(edge.source)
        if not edge.loop or edge.on_limit != "exit" or edge.when is None:
            continue
        others: list[str] = []
        if isinstance(source, RouterNode):
            others = [branch.name for branch in source.branches if branch.name != edge.when]
        elif isinstance(source, HumanNode):
            others = [action for action in source.actions if action != edge.when]
        else:
            continue
        if not others:
            issues.append(
                Issue(
                    "loop_no_exit",
                    f"{edge.source} needs another branch to exit the loop",
                    source.id,
                )
            )
    return issues


def _upstream(spec: Workflow, node_id: str) -> set[str]:
    reverse: dict[str, list[str]] = defaultdict(list)
    for edge in spec.edges:
        reverse[edge.target].append(edge.source)
    return reachable(reverse.get(node_id, []), reverse)


def _path_issues(node_id: str, path: str, known: set[str], upstream: set[str]) -> list[Issue]:
    if path.split(".", maxsplit=1)[0] not in PATH_ROOTS:
        return [
            Issue(
                "bad_condition_path", f"path {path} must start with input, nodes, or loop", node_id
            )
        ]
    refs = referenced_nodes([path]) if NODE_REF.match(path) else set[str]()
    return [
        Issue("unknown_reference", f"condition uses unknown node {ref}", node_id)
        for ref in sorted(refs - known)
    ]


def _upstream_issues(
    node_id: str, refs: set[str], known: set[str], upstream: set[str]
) -> list[Issue]:
    return [
        Issue("not_upstream", f"condition uses node {ref}, which is not upstream", node_id)
        for ref in sorted(refs)
        if ref in known and ref not in upstream
    ]


def check_conditions(spec: Workflow) -> list[Issue]:
    known = {node.id for node in spec.nodes}
    issues: list[Issue] = []
    for node in spec.nodes:
        if not isinstance(node, RouterNode):
            continue
        upstream = _upstream(spec, node.id)
        for branch in node.branches:
            condition = branch.when
            issues.extend(_path_issues(node.id, condition.path, known, upstream))
            refs = referenced_nodes([condition.path]) | referenced_nodes(
                template_paths(condition.value)
            )
            issues.extend(_upstream_issues(node.id, refs, known, upstream))
    return issues
