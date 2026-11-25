import json
import re

from dbos import DBOS
from pydantic import JsonValue
from pydantic_ai.direct import model_request
from pydantic_ai.messages import ModelMessage, ModelRequest
from pydantic_ai.settings import ModelSettings

from sosho_engine import runtime
from sosho_engine.conditions import evaluate
from sosho_engine.errors import NodeFailedError, PolicyError, RunLimitError
from sosho_engine.jobs import NodeJob, NodeResult
from sosho_engine.spec_nodes import JoinNode, LlmNode, RouterNode, ToolNode
from sosho_engine.templating import render_template, render_value
from sosho_engine.tools import JsonDict

FENCE = re.compile(r"^```[a-zA-Z]*\s*(.*?)\s*```$", re.DOTALL)


def route(node: RouterNode, data: dict[str, JsonValue], blocked: list[str]) -> JsonDict:
    for branch in node.branches:
        if branch.name not in blocked and evaluate(branch.when, data):
            return {"branch": branch.name}
    if node.default is None or node.default in blocked:
        raise NodeFailedError(f"router {node.id} matched no branch")
    return {"branch": node.default}


def join(node: JoinNode, job: NodeJob) -> JsonDict:
    if node.require_all and job.join_dead:
        raise NodeFailedError(f"join {node.id} lacks inputs from {job.join_dead}")
    dead: list[JsonValue] = list(job.join_dead)
    return {"inputs": job.join_inputs, "dead": dead}


def check_tool_allowed(name: str, allowed: list[str] | None) -> None:
    if allowed is not None and name not in allowed:
        raise PolicyError(f"policy denies tool {name}")


async def run_tool(node: ToolNode, job: NodeJob) -> JsonDict:
    check_tool_allowed(node.tool, job.allowed_tools)
    spec = runtime.current().tools.get(node.tool)
    rendered = render_value(dict(node.args), job.data)
    if not isinstance(rendered, dict):
        raise NodeFailedError(f"tool {node.tool} args are not an object")
    return await spec.run(rendered)


def parse_json_text(text: str) -> JsonValue:
    stripped = text.strip()
    fenced = FENCE.match(stripped)
    try:
        return json.loads(fenced.group(1) if fenced else stripped)
    except json.JSONDecodeError as error:
        raise NodeFailedError(f"model output is not JSON: {error}") from error


def _llm_settings(node: LlmNode) -> ModelSettings:
    settings = ModelSettings()
    if node.temperature is not None:
        settings["temperature"] = node.temperature
    if node.max_tokens is not None:
        settings["max_tokens"] = node.max_tokens
    return settings


def attempt_number() -> int:
    status = DBOS.step_status
    return (status.current_attempt or 0) + 1 if status is not None else 1


async def run_llm(node: LlmNode, job: NodeJob) -> NodeResult:
    attempt = attempt_number()
    if attempt > job.llm_left:
        raise RunLimitError("the LLM call budget is used")
    messages: list[ModelMessage] = [
        ModelRequest.user_text_prompt(
            render_template(node.prompt, job.data),
            instructions=render_template(node.system, job.data) if node.system else None,
        )
    ]
    model = runtime.current().models(node.role)
    response = await model_request(model, messages, model_settings=_llm_settings(node))
    text = response.text or ""
    output: JsonDict = {"text": text, "role": node.role}
    if node.json_output:
        output["data"] = parse_json_text(text)
    return NodeResult(output=output, llm_calls=attempt)


async def execute_inline(job: NodeJob) -> NodeResult:
    node = job.node
    if isinstance(node, RouterNode):
        return NodeResult(output=route(node, job.data, job.blocked))
    if isinstance(node, JoinNode):
        return NodeResult(output=join(node, job))
    if isinstance(node, ToolNode):
        return NodeResult(output=await run_tool(node, job))
    if isinstance(node, LlmNode):
        return await run_llm(node, job)
    raise NodeFailedError(f"node {node.id} of kind {node.kind} is not an inline node")
