"""Decision node kind. A model picks one branch. Outgoing edges use the branch as condition."""

import json
import re
from collections.abc import Sequence

from pydantic import BaseModel, Field, ValidationError

from sosho_graph.nodes.common import Tier, call_model
from sosho_graph.registry import NodeConfig, NodeContext, TypedNodeKind
from sosho_graph.state import NodeUpdate
from sosho_graph.templating import render_template

_JSON_OBJECT = re.compile(r"\{[\s\S]*\}")


class DecisionConfig(NodeConfig):
    """Config for the decision kind."""

    prompt_template: str = Field(min_length=1)
    branches: list[str] = Field(min_length=1)
    tier: Tier = "decision"
    output_key: str = "decision"
    timeout_seconds: int = Field(default=120, ge=5, le=3600)


class _ReplyJson(BaseModel):
    """The JSON reply of the router. Other keys are ignored."""

    branch: str | None = None


def parse_branch(text: str, branches: Sequence[str]) -> str:
    """Pick a branch from the model reply. Fall back to the first branch when unclear.

    A reply with a JSON value is trusted. Its unknown branch maps to the first branch.
    A reply without JSON uses the first branch name found in the text.
    """
    match = _JSON_OBJECT.search(text)
    candidate = match.group(0) if match else text
    try:
        parsed: object = json.loads(candidate)
    except json.JSONDecodeError:
        return _first_named_branch(text, branches)
    reply = _reply_from(parsed)
    chosen = reply.branch if reply is not None else None
    if chosen is not None and chosen in branches:
        return chosen
    return branches[0]


def _reply_from(parsed: object) -> _ReplyJson | None:
    try:
        return _ReplyJson.model_validate(parsed)
    except ValidationError:
        return None


def _first_named_branch(text: str, branches: Sequence[str]) -> str:
    lowered = text.lower()
    for branch in branches:
        if branch.lower() in lowered:
            return branch
    return branches[0]


def _system_prompt(branches: Sequence[str]) -> str:
    options = json.dumps(list(branches))
    return (
        "You are a fast deterministic router. Choose exactly ONE branch from: "
        f'{options}. Respond ONLY with valid JSON: {{"branch": "<chosen>", "reason": "<short>"}}.'
    )


async def run_decision(ctx: NodeContext, node: DecisionConfig) -> NodeUpdate:
    """Ask the model for one branch. Record it for the outgoing condition edges."""
    prompt = render_template(node.prompt_template, ctx.state["data"])
    text = await call_model(
        ctx, node.tier, _system_prompt(node.branches), prompt, node.timeout_seconds
    )
    branch = parse_branch(text, node.branches)
    return {"data": {node.output_key: branch}, "branches": {ctx.node_id: branch}}


DECISION_KIND = TypedNodeKind(
    type_id="decision",
    display_name="Decision",
    description="Ask a model tier to choose one branch. Edges use the branch as condition.",
    config_model=DecisionConfig,
    output_schema={"type": "object", "properties": {"outputKey": {"type": "string"}}},
    runner=run_decision,
)
