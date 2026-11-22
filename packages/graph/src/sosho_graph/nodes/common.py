import asyncio
from typing import Literal

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from sosho_graph.registry import NodeContext

Tier = Literal["main", "subagent", "subagent-code", "decision", "local-uncensored"]


async def call_model(
    ctx: NodeContext,
    tier: Tier,
    system: str,
    prompt: str,
    timeout_seconds: int,
) -> str:
    model = ctx.services.model_for(tier)
    messages: list[BaseMessage] = [SystemMessage(content=system), HumanMessage(content=prompt)]
    async with asyncio.timeout(timeout_seconds):
        parts = [chunk.text async for chunk in model.astream(messages, config=ctx.runnable_config)]
    return "".join(parts)
