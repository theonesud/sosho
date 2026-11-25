import pytest
from engine_support import Api, dig, wait_terminal
from flows import Spec, draft, edge, trigger, unique
from pydantic import JsonValue
from sosho_engine.budget import effective_policy, inherit_from, reserve
from sosho_engine.errors import PolicyError
from sosho_engine.host_node import check_skills_allowed
from sosho_engine.spec import Policy, Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.spec_nodes import AgentNode, SkillNode
from sosho_engine.validation import validate_workflow

Nodes = list[JsonValue]
KNOWN = {"alpha", "beta"}


def _agent(**extra: JsonValue) -> Spec:
    return {"id": "n", "kind": "agent", "role": "main", "prompt": "go", **extra}


def _skill(**extra: JsonValue) -> Spec:
    return {"id": "n", "kind": "skill", "skill": "alpha", "task": "t", "role": "main", **extra}


def _codes(node: Spec, skills: set[str] | None = None, **policy: JsonValue) -> set[str]:
    nodes: Nodes = [trigger(), node]
    body = WorkflowDraft.model_validate(draft(nodes, [edge("start", "n")], policy=policy))
    spec: Workflow = draft_to_workflow(body, "wf", 1)
    return {issue.code for issue in validate_workflow(spec, None, skills)}


def test_known_skills_pass_validation() -> None:
    assert _codes(_agent(skills=["alpha", "beta"]), KNOWN) == set()
    assert _codes(_skill(), KNOWN) == set()


@pytest.mark.parametrize("node", [_agent(skills=["alpha", "ghost"]), _skill(skill="ghost")])
def test_unknown_skill_is_reported_at_validation(node: Spec) -> None:
    assert _codes(node, KNOWN) == {"unknown_skill"}


def test_empty_skill_catalog_rejects_each_skill() -> None:
    assert _codes(_skill(), set()) == {"unknown_skill"}


@pytest.mark.parametrize("role", ["decision", "embed", "nope"])
def test_roles_that_cannot_run_pi_are_rejected(role: str) -> None:
    assert _codes(_agent(role=role)) == {"role_unsupported"}
    assert _codes(_skill(role=role), KNOWN) == {"role_unsupported"}


def test_host_nodes_accept_only_the_host_queue() -> None:
    assert _codes(_agent(queue="host")) == set()
    assert _codes(_agent(queue="local-gpu")) == {"host_queue"}
    other: Spec = {"id": "n", "kind": "tool", "tool": "echo", "queue": "host"}
    assert _codes(other) == {"host_queue"}


def test_policy_allowed_skills_denies_other_skills_at_save() -> None:
    assert _codes(_agent(skills=["alpha"]), KNOWN, allowed_skills=["alpha"]) == set()
    denied = _codes(_agent(skills=["alpha", "beta"]), KNOWN, allowed_skills=["alpha"])
    assert denied == {"skill_denied"}
    assert _codes(_skill(skill="beta"), KNOWN, allowed_skills=[]) == {"skill_denied"}


def test_child_policy_keeps_only_skills_both_policies_allow() -> None:
    parent = Policy(allowed_skills=["alpha", "beta"])
    spec = Workflow(id="p", version=1, name="p", nodes=[], entry="start", policy=parent)
    inherited = inherit_from(spec, 10, 1)
    assert effective_policy(Policy(allowed_skills=["beta", "gamma"]), inherited).allowed_skills == [
        "beta"
    ]
    assert effective_policy(Policy(), inherited).allowed_skills == ["alpha", "beta"]
    assert effective_policy(Policy(allowed_skills=["x"]), None).allowed_skills == ["x"]


def test_runtime_skill_check_raises_policy_error() -> None:
    check_skills_allowed(["alpha"], None)
    check_skills_allowed(["alpha"], ["alpha"])
    with pytest.raises(PolicyError, match="policy denies skill beta"):
        check_skills_allowed(["alpha", "beta"], ["alpha"])


def test_reservation_covers_max_turns_for_each_attempt() -> None:
    agent = AgentNode.model_validate(_agent(max_turns=5, retry={"max_attempts": 2}))
    skill = SkillNode.model_validate({**_skill(), "id": "s", "max_turns": 4})
    assert reserve([agent, skill], 12) == {"n": 10, "s": 2}


def test_skill_catalog_is_listed_in_the_node_catalog(host_api: Api) -> None:
    body = host_api.get("/nodes").body
    assert dig(body, "skills") == ["alpha", "beta"]
    assert dig(body, "pi_roles") == [
        "cloud-uncensored",
        "local-uncensored",
        "main",
        "subagent",
        "subagent-code",
    ]


def test_save_rejects_an_unknown_skill_with_a_clear_issue(host_api: Api) -> None:
    wid = unique("skillsave")
    host_api.post("/workflows", {"id": wid, "name": wid})
    body = draft([trigger(), _skill(skill="ghost")], [edge("start", "n")])
    reply = host_api.post(f"/workflows/{wid}/versions", body)
    assert reply.status == 422
    assert dig(reply.body, "issues", 0, "code") == "unknown_skill"
    assert (
        host_api.post(
            f"/workflows/{wid}/versions", draft([trigger(), _skill()], [edge("start", "n")])
        ).status
        == 201
    )


def test_child_run_with_a_denied_skill_fails_with_policy_denies(host_api: Api) -> None:
    child = unique("skchild")
    host_api.post("/workflows", {"id": child, "name": child})
    spec = draft([trigger(), _skill(skill="beta")], [edge("start", "n")])
    assert host_api.post(f"/workflows/{child}/versions", spec).status == 201
    parent = unique("skparent")
    host_api.post("/workflows", {"id": parent, "name": parent})
    sub: Spec = {"id": "inner", "kind": "subworkflow", "workflow_id": child, "version": 1}
    body = draft([trigger(), sub], [edge("start", "inner")], policy={"allowed_skills": ["alpha"]})
    assert host_api.post(f"/workflows/{parent}/versions", body).status == 201
    run = host_api.post(f"/workflows/{parent}/runs", {"input": {}})
    assert run.status == 202
    run_id = str(dig(run.body, "run_id"))
    assert wait_terminal(host_api, run_id) == "failed"
    detail = host_api.get(f"/runs/{run_id}").body
    assert "policy denies skill beta" in str(dig(detail, "error"))
