import time

from dbos import DBOS, StepOptions
from pydantic import BaseModel, JsonValue, ValidationError

from sosho_engine.errors import NodeFailedError
from sosho_engine.jobs import NodeJob, NodeResult
from sosho_engine.spec_nodes import HumanAction, HumanNode
from sosho_engine.templating import render_template

HUMAN_TOPIC = "human"
PENDING_EVENT = "pending"


class PendingEvent(BaseModel):
    node_id: str
    prompt: str
    show: str | None = None
    actions: list[HumanAction]
    wait_seconds: float


class ProgressView(BaseModel):
    waiting: dict[str, str] = {}


class HumanReply(BaseModel):
    action: HumanAction
    value: JsonValue = None


async def _deadline(seconds: float) -> float:
    return time.time() + seconds


def _offered(node: HumanNode, job: NodeJob) -> list[HumanAction]:
    offered: list[HumanAction] = [a for a in node.actions if a not in job.blocked]
    if not offered:
        raise NodeFailedError(f"human {node.id} has no action left at the loop cap")
    return offered


def _valid_reply(message: JsonValue, offered: list[HumanAction]) -> HumanReply | None:
    try:
        reply = HumanReply.model_validate(message)
    except ValidationError:
        return None
    return reply if reply.action in offered else None


async def _await_reply(node: HumanNode, offered: list[HumanAction]) -> HumanReply | None:
    deadline = await DBOS.run_step_async(
        StepOptions(name="human_deadline"), _deadline, node.wait_seconds
    )
    while True:
        remaining = max(deadline - time.time(), 0.0)
        message = await DBOS.recv_async(HUMAN_TOPIC, timeout_seconds=remaining)
        if message is None:
            return None
        reply = _valid_reply(message, offered)
        if reply is not None:
            return reply


async def run_human_node(job: NodeJob, node: HumanNode) -> NodeResult:
    offered = _offered(node, job)
    fallback = node.default_action if node.default_action in offered else offered[0]
    pending: dict[str, JsonValue] = {
        "node_id": node.id,
        "prompt": render_template(node.prompt, job.data),
        "show": render_template(node.show, job.data) if node.show else None,
        "actions": list(offered),
        "wait_seconds": node.wait_seconds,
    }
    await DBOS.set_event_async(PENDING_EVENT, pending)
    answer = await _await_reply(node, offered)
    timed_out = answer is None
    reply = answer or HumanReply(action=fallback, value=node.default_value)
    await DBOS.set_event_async(PENDING_EVENT, None)
    output: dict[str, JsonValue] = {
        "action": reply.action,
        "value": reply.value,
        "branch": reply.action,
        "timed_out": timed_out,
    }
    return NodeResult(output=output)
