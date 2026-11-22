"""Agent and subagent node kinds. Both call one model role with a prompt template."""

from pydantic import Field

from sosho_graph.nodes.common import Tier, call_model
from sosho_graph.registry import NodeConfig, NodeContext, TypedNodeKind
from sosho_graph.state import NodeUpdate
from sosho_graph.templating import render_template

DEFAULT_AGENT_SYSTEM = "You are a precise, concise Sosho workflow agent."


class AgentConfig(NodeConfig):
    """Config for the agent kind."""

    prompt_template: str = Field(min_length=1)
    system_prompt: str | None = None
    tier: Tier = "main"
    output_key: str = "last_output"
    timeout_seconds: int = Field(default=120, ge=5, le=3600)


class SubagentConfig(NodeConfig):
    """Config for the subagent kind."""

    role: str = Field(min_length=1)
    prompt_template: str = Field(min_length=1)
    tier: Tier = "subagent"
    output_key: str = "subagent_output"
    timeout_seconds: int = Field(default=120, ge=5, le=3600)


async def run_agent(ctx: NodeContext, node: AgentConfig) -> NodeUpdate:
    """Call the model with the rendered prompt. Write the reply under the output key."""
    prompt = render_template(node.prompt_template, ctx.state["data"])
    system = node.system_prompt or DEFAULT_AGENT_SYSTEM
    text = await call_model(ctx, node.tier, system, prompt, node.timeout_seconds)
    return {"data": {node.output_key: text}}


async def run_subagent(ctx: NodeContext, node: SubagentConfig) -> NodeUpdate:
    """Call the model with a role system prompt. Write the reply under the output key."""
    prompt = render_template(node.prompt_template, ctx.state["data"])
    system = f"You are a focused subagent ({node.role}). Return a concise structured result."
    text = await call_model(ctx, node.tier, system, prompt, node.timeout_seconds)
    return {"data": {node.output_key: text}}


AGENT_KIND = TypedNodeKind(
    type_id="agent",
    display_name="Agent",
    description="Call a model tier with a prompt template. Write the reply to outputKey.",
    config_model=AgentConfig,
    output_schema={"type": "object", "properties": {"outputKey": {"type": "string"}}},
    runner=run_agent,
)

SUBAGENT_KIND = TypedNodeKind(
    type_id="subagent",
    display_name="Subagent",
    description="Call a model tier with a role prompt. Write the reply to outputKey.",
    config_model=SubagentConfig,
    output_schema={"type": "object", "properties": {"outputKey": {"type": "string"}}},
    runner=run_subagent,
)
