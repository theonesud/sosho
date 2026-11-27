from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from sosho_memory.models import MemoryEdge, MemoryNode, NodeKind


class MemorySourceScope(StrEnum):
    USER = "user"
    PROJECT = "project"


class ScoredNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    node: MemoryNode
    scope: MemorySourceScope
    score: float
    vector_score: float = 0.0
    bm25_score: float = 0.0
    priority_boost: float = 0.0


class ErrorFixPair(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    error_node: MemoryNode
    fix_node: MemoryNode
    scope: MemorySourceScope
    weight: float = Field(gt=0.0)


class CompressedPath(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    nodes: tuple[str, ...]
    relations: tuple[str, ...]
    total_cost: float
    rendered: str


class ContextPack(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    preferences: tuple[ScoredNode, ...]
    error_fixes: tuple[ErrorFixPair, ...]
    paths: tuple[CompressedPath, ...]
    supporting_nodes: tuple[ScoredNode, ...]
    rendered_text: str
    estimated_tokens: int = Field(ge=0)
    token_budget: int = Field(ge=1)
    truncated: bool


class GraphExpansionResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    center_kind: NodeKind
    center_key: str
    hops: int = Field(ge=1)
    nodes: tuple[MemoryNode, ...]
    edges: tuple[MemoryEdge, ...]
    paths: tuple[CompressedPath, ...]
