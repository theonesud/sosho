from sosho_engine.errors import PolicyError, RunLimitError
from sosho_engine.jobs import Inherited, NodeJob
from sosho_engine.spec import Policy, Workflow
from sosho_engine.spec_nodes import AgentNode, LlmNode, Node, SkillNode
from sosho_engine.tools import JsonDict

FANOUT_KINDS = frozenset({"map", "subworkflow"})
COUNTED_KINDS = frozenset({"llm", "agent", "skill", "map", "subworkflow"})


def _want(node: Node) -> int:
    if isinstance(node, LlmNode):
        return node.retry.max_attempts
    if isinstance(node, (AgentNode, SkillNode)):
        return node.max_turns * node.retry.max_attempts
    return 0


def reserve(nodes: list[Node], left: int) -> dict[str, int]:
    remaining = max(left, 0)
    shares: dict[str, int] = {}
    for node in nodes:
        shares[node.id] = min(_want(node), remaining)
        remaining -= shares[node.id]
    fanout = [node for node in nodes if node.kind in FANOUT_KINDS]
    for node in fanout:
        shares[node.id] = remaining // len(fanout)
    return shares


def failure_charge(job: NodeJob, error: Exception) -> int:
    if job.node.kind not in COUNTED_KINDS or isinstance(error, (RunLimitError, PolicyError)):
        return 0
    return job.llm_left


def child_budget(reserved: int, children: int) -> int:
    return reserved // children if children else 0


def _meet[T](own: list[T] | None, inherited: list[T] | None) -> list[T] | None:
    if own is None:
        return inherited
    if inherited is None:
        return own
    return [item for item in own if item in inherited]


def effective_policy(policy: Policy, inherited: Inherited | None) -> Policy:
    if inherited is None:
        return policy
    return policy.model_copy(
        update={
            "allowed_kinds": _meet(policy.allowed_kinds, inherited.allowed_kinds),
            "allowed_tools": _meet(policy.allowed_tools, inherited.allowed_tools),
            "allowed_skills": _meet(policy.allowed_skills, inherited.allowed_skills),
            "max_llm_calls": min(policy.max_llm_calls, inherited.llm_budget),
            "max_depth": min(policy.max_depth, inherited.max_depth),
        }
    )


def inherit_from(spec: Workflow, reserved: int, children: int) -> Inherited:
    policy = spec.policy
    return Inherited(
        llm_budget=child_budget(reserved, children),
        allowed_kinds=policy.allowed_kinds,
        allowed_tools=policy.allowed_tools,
        allowed_skills=policy.allowed_skills,
        max_depth=policy.max_depth,
    )


def sum_calls(results: list[JsonDict]) -> int:
    total = 0
    for result in results:
        calls = result.get("llm_calls")
        total += calls if isinstance(calls, int) else 0
    return total
