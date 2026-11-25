from dbos import DBOS, StepOptions
from pydantic import JsonValue
from pydantic_ai.tools import Tool
from pydantic_ai.toolsets import FunctionToolset
from pydantic_ai.usage import UsageLimits

from sosho_engine import runtime
from sosho_engine.errors import RunLimitError
from sosho_engine.executors import check_tool_allowed
from sosho_engine.jobs import NodeJob, NodeResult
from sosho_engine.spec_nodes import AgentNode
from sosho_engine.templating import render_template
from sosho_engine.tools import JsonDict, ToolSpec


async def _side_effect_body(spec: ToolSpec, args: JsonDict) -> JsonDict:
    return await spec.run(args)


def _make_tool(spec: ToolSpec) -> Tool[None]:
    async def call(**kwargs: JsonValue) -> JsonDict:
        if not spec.side_effect:
            return await spec.run(dict(kwargs))
        options = StepOptions(name=f"tool:{spec.name}")
        return await DBOS.run_step_async(options, _side_effect_body, spec, dict(kwargs))

    return Tool.from_schema(
        call, name=spec.name, description=spec.description, json_schema=spec.schema, takes_ctx=False
    )


def build_toolset(node: AgentNode, job: NodeJob) -> FunctionToolset[None]:
    registry = runtime.current().tools
    tools: list[Tool[None]] = []
    for name in node.tools:
        check_tool_allowed(name, job.allowed_tools)
        tools.append(_make_tool(registry.get(name)))
    return FunctionToolset(tools)


async def run_agent_node(job: NodeJob, node: AgentNode) -> NodeResult:
    limit = min(node.max_requests, job.llm_left)
    if limit < 1:
        raise RunLimitError("the LLM call budget is used")
    agent = runtime.current().agents.get(node.role)
    result = await agent.run(
        render_template(node.prompt, job.data),
        instructions=render_template(node.instructions, job.data) if node.instructions else None,
        toolsets=[build_toolset(node, job)],
        usage_limits=UsageLimits(request_limit=limit),
    )
    requests = result.usage.requests
    return NodeResult(output={"text": str(result.output), "role": node.role}, llm_calls=requests)
