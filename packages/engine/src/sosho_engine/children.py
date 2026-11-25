from dbos import DBOS
from pydantic import JsonValue

from sosho_engine.agents import run_agent_node
from sosho_engine.errors import NodeFailedError
from sosho_engine.human import run_human_node
from sosho_engine.jobs import NodeJob
from sosho_engine.spec_nodes import AgentNode, HumanNode, WaitNode
from sosho_engine.steps import run_inline_step


async def run_node_job(payload: dict[str, JsonValue]) -> dict[str, JsonValue]:
    job = NodeJob.model_validate(payload)
    node = job.node
    if isinstance(node, AgentNode):
        return (await run_agent_node(job, node)).model_dump(mode="json")
    if isinstance(node, HumanNode):
        return (await run_human_node(job, node)).model_dump(mode="json")
    if isinstance(node, WaitNode):
        await DBOS.sleep_async(node.seconds)
        return {"output": {"waited": node.seconds}, "llm_calls": 0}
    if node.kind in ("llm", "tool"):
        return await run_inline_step(job)
    raise NodeFailedError(f"node {node.id} of kind {node.kind} cannot run as a child")
