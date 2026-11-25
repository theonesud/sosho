import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

IDENTIFIER = r"^[A-Za-z][A-Za-z0-9_-]{0,63}$"
ID_PATTERN = re.compile(IDENTIFIER)
QueueName = Literal["local-gpu", "cloud-io", "host-browser"]
HumanAction = Literal["approve", "reject", "input", "edit"]
NodeKind = Literal[
    "trigger", "llm", "agent", "tool", "router", "map", "join", "human", "subworkflow", "wait"
]
MAX_TIMEOUT_SECONDS = 3600.0
MAX_WAIT_SECONDS = 7 * 24 * 3600.0
MAX_HUMAN_SECONDS = 30 * 24 * 3600.0
MAX_MAP_ITEMS = 1000


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RetryPolicy(Strict):
    max_attempts: int = Field(default=1, ge=1, le=10)
    interval_seconds: float = Field(default=1.0, ge=0.0, le=600.0)
    backoff_rate: float = Field(default=2.0, ge=1.0, le=10.0)


class NodeBase(Strict):
    id: str = Field(pattern=IDENTIFIER)
    name: str | None = None
    queue: QueueName | None = None
    retry: RetryPolicy = RetryPolicy()
    timeout_seconds: float | None = Field(default=None, gt=0.0, le=MAX_TIMEOUT_SECONDS)
    continue_on_error: bool = False


class TriggerNode(NodeBase):
    kind: Literal["trigger"] = "trigger"
    mode: Literal["manual", "cron", "webhook", "workflow_finished"] = "manual"
    cron: str | None = None
    cron_timezone: str | None = None
    source_workflow_id: str | None = None
    on_status: Literal["succeeded", "failed", "any"] = "succeeded"

    @model_validator(mode="after")
    def _check_mode(self) -> "TriggerNode":
        if self.mode == "cron" and len(self.cron.split() if self.cron else []) != 6:
            raise ValueError("a cron trigger needs a cron string with 6 fields")
        if self.mode == "workflow_finished" and not self.source_workflow_id:
            raise ValueError("a workflow_finished trigger needs source_workflow_id")
        return self


class LlmNode(NodeBase):
    kind: Literal["llm"] = "llm"
    role: str
    prompt: str
    system: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1)
    json_output: bool = False


class AgentNode(NodeBase):
    kind: Literal["agent"] = "agent"
    role: str
    prompt: str
    instructions: str | None = None
    tools: list[str] = []
    max_requests: int = Field(default=10, ge=1, le=100)


class ToolNode(NodeBase):
    kind: Literal["tool"] = "tool"
    tool: str
    args: dict[str, JsonValue] = {}


class Condition(Strict):
    path: str
    op: Literal["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "truthy", "exists"] = (
        "truthy"
    )
    value: JsonValue = None


class Branch(Strict):
    name: str = Field(pattern=IDENTIFIER)
    when: Condition


class RouterNode(NodeBase):
    kind: Literal["router"] = "router"
    branches: list[Branch] = Field(min_length=1)
    default: str | None = None


class MapNode(NodeBase):
    kind: Literal["map"] = "map"
    items: str
    workflow_id: str
    version: int = Field(ge=1)
    max_items: int = Field(default=100, ge=1, le=MAX_MAP_ITEMS)


class JoinNode(NodeBase):
    kind: Literal["join"] = "join"
    require_all: bool = False


class HumanNode(NodeBase):
    kind: Literal["human"] = "human"
    prompt: str
    actions: list[HumanAction] = Field(default=["approve", "reject"], min_length=1)
    wait_seconds: float = Field(default=86400.0, gt=0.0, le=MAX_HUMAN_SECONDS)
    default_action: HumanAction = "reject"
    default_value: JsonValue = None
    show: str | None = None

    @model_validator(mode="after")
    def _check_default(self) -> "HumanNode":
        if self.default_action not in self.actions:
            raise ValueError("default_action must be one of actions")
        return self


class SubworkflowNode(NodeBase):
    kind: Literal["subworkflow"] = "subworkflow"
    workflow_id: str
    version: int = Field(ge=1)
    input: dict[str, JsonValue] = {}


class WaitNode(NodeBase):
    kind: Literal["wait"] = "wait"
    seconds: float = Field(ge=0.0, le=MAX_WAIT_SECONDS)


Node = Annotated[
    TriggerNode
    | LlmNode
    | AgentNode
    | ToolNode
    | RouterNode
    | MapNode
    | JoinNode
    | HumanNode
    | SubworkflowNode
    | WaitNode,
    Field(discriminator="kind"),
]

NODE_CLASSES: dict[str, type[NodeBase]] = {
    "trigger": TriggerNode,
    "llm": LlmNode,
    "agent": AgentNode,
    "tool": ToolNode,
    "router": RouterNode,
    "map": MapNode,
    "join": JoinNode,
    "human": HumanNode,
    "subworkflow": SubworkflowNode,
    "wait": WaitNode,
}
