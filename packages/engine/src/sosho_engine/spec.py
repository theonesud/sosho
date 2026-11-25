from pydantic import Field, JsonValue

from sosho_engine.spec_nodes import (
    ID_PATTERN,
    IDENTIFIER,
    Node,
    NodeKind,
    Strict,
)

MAX_LOOP_ITERATIONS = 50
MAX_NODES = 500


class Edge(Strict):
    source: str
    target: str
    when: str | None = None
    loop: bool = False
    max_iterations: int | None = Field(default=None, ge=1, le=MAX_LOOP_ITERATIONS)


class Policy(Strict):
    allowed_kinds: list[NodeKind] | None = None
    allowed_tools: list[str] | None = None
    max_steps: int = Field(default=200, ge=1, le=10000)
    max_run_seconds: int = Field(default=3600, ge=1, le=7 * 24 * 3600)
    max_llm_calls: int = Field(default=50, ge=0, le=10000)
    max_depth: int = Field(default=3, ge=0, le=8)


class WorkflowDraft(Strict):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    nodes: list[Node] = Field(max_length=MAX_NODES)
    edges: list[Edge] = Field(default=[])
    entry: str
    policy: Policy = Policy()


class Workflow(WorkflowDraft):
    id: str = Field(pattern=IDENTIFIER)
    version: int = Field(ge=1)

    def node_map(self) -> dict[str, Node]:
        return {node.id: node for node in self.nodes}


def is_valid_workflow_id(value: str) -> bool:
    return ID_PATTERN.match(value) is not None


def draft_to_workflow(draft: WorkflowDraft, workflow_id: str, version: int) -> Workflow:
    return Workflow(id=workflow_id, version=version, **dict(draft))


def workflow_json(spec: Workflow) -> dict[str, JsonValue]:
    return spec.model_dump(mode="json")
