from pydantic import BaseModel, JsonValue

from sosho_engine.spec_nodes import NODE_CLASSES
from sosho_engine.tools import JsonDict, ToolRegistry
from sosho_engine.validation import PI_ROLES

KIND_INFO: dict[str, tuple[str, str]] = {
    "trigger": ("Trigger", "Start a run. Modes: manual, cron, webhook, workflow_finished."),
    "llm": ("LLM", "Send one prompt to a model role and return the text."),
    "agent": (
        "Agent",
        "Run a pi session on a model role with optional skills. Runs on the host worker.",
    ),
    "skill": ("Skill", "Run a pi session that uses one skill. Runs on the host worker."),
    "tool": ("Tool", "Call a registered Python tool."),
    "router": ("Router", "Choose one branch from conditions on earlier outputs."),
    "map": ("Map", "Run a child workflow for each item of a list."),
    "join": ("Join", "Wait for parallel branches and merge their outputs."),
    "human": ("Human", "Wait for approve, reject, input, or edit from the owner."),
    "subworkflow": ("Subworkflow", "Run one child workflow version."),
    "wait": ("Wait", "Sleep for a fixed time. The sleep survives a restart."),
}
QUEUES: dict[str, dict[str, int]] = {
    "local-gpu": {"global_concurrency": 1, "worker_concurrency": 1},
    "cloud-io": {"global_concurrency": 8, "worker_concurrency": 8},
    "host-browser": {"global_concurrency": 2, "worker_concurrency": 2},
    "host": {"global_concurrency": 4, "worker_concurrency": 4},
}


class KindEntry(BaseModel):
    kind: str
    title: str
    description: str
    json_schema: JsonDict


class ToolEntry(BaseModel):
    name: str
    description: str
    side_effect: bool
    json_schema: JsonDict


class Catalog(BaseModel):
    kinds: list[KindEntry]
    tools: list[ToolEntry]
    queues: dict[str, dict[str, int]]
    skills: list[str]
    pi_roles: list[str]


def build_catalog(tools: ToolRegistry, skills: list[str]) -> Catalog:
    kinds: list[KindEntry] = []
    for kind, node_class in NODE_CLASSES.items():
        title, description = KIND_INFO[kind]
        schema: dict[str, JsonValue] = node_class.model_json_schema()
        kinds.append(KindEntry(kind=kind, title=title, description=description, json_schema=schema))
    entries = [
        ToolEntry(
            name=spec.name,
            description=spec.description,
            side_effect=spec.side_effect,
            json_schema=spec.schema,
        )
        for spec in tools.specs()
    ]
    return Catalog(
        kinds=kinds, tools=entries, queues=QUEUES, skills=skills, pi_roles=sorted(PI_ROLES)
    )
