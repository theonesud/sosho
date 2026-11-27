import math
from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict, Field

from sosho_memory.models import (
    APPROVED_RELATIONS,
    ConceptNetRelation,
    MemoryEdge,
    NodeKind,
)


class CandidateNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: NodeKind
    key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    content: str
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class CandidateEdge(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    relation_name: str = Field(min_length=1)
    source_kind: NodeKind
    source_key: str = Field(min_length=1)
    target_kind: NodeKind
    target_key: str = Field(min_length=1)
    weight: float = Field(default=1.0, gt=0.0)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class ExtractionPayload(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    nodes: tuple[CandidateNode, ...] = ()
    edges: tuple[CandidateEdge, ...] = ()


class ParentAttachmentDecision(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    parent_term: str = Field(min_length=1)
    relation_name: str = "IsA"
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class ContradictionDecision(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    contradicts: bool
    reason: str
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class OntologyGrowthResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    term: str
    attached_parent: str
    relation: ConceptNetRelation
    created_edge_id: str


class ContradictionResolutionResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    contradicted: bool
    closed_edge_ids: tuple[str, ...]
    new_edge_id: str
    supersedes_edge_ids: tuple[str, ...]


class CurationReport(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    written_nodes: int = Field(ge=0)
    written_edges: int = Field(ge=0)
    rejected_unapproved_edges: int = Field(ge=0)
    rejected_secret_items: int = Field(ge=0)
    superseded_edges: int = Field(ge=0)


def cosine_similarity(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
    if len(vec_a) != len(vec_b) or not vec_a:
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=True))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def select_best_sense_candidate(
    context_vec: Sequence[float],
    candidates: Sequence[tuple[str, Sequence[float]]],
) -> str | None:
    if not candidates:
        return None
    best_term, _ = min(
        candidates,
        key=lambda item: (-cosine_similarity(context_vec, item[1]), item[0]),
    )
    return best_term


def build_parent_attachment_prompts(term: str, context: str) -> tuple[str, str]:
    relations = ", ".join(relation.value for relation in ConceptNetRelation)
    system_prompt = (
        "Attach an unknown term to a broader parent concept in the ontology. "
        "Return strict JSON with keys: parent_term (non-empty string), "
        f"relation_name (one of: {relations}; default IsA), and "
        "confidence (float between 0.0 and 1.0)."
    )
    user_prompt = f"Term: {term}\nContext: {context}"
    return (system_prompt, user_prompt)


def _format_edge_summary(label: str, edge: MemoryEdge) -> str:
    return (
        f"{label}: {edge.source_kind.value}:{edge.source_key} "
        f"-[{edge.relation.value} weight={edge.weight} "
        f"confidence={edge.provenance.confidence}]-> "
        f"{edge.target_kind.value}:{edge.target_key}"
    )


def build_contradiction_prompts(
    existing_edge: MemoryEdge,
    new_edge: MemoryEdge,
) -> tuple[str, str]:
    system_prompt = (
        "Decide whether a new memory edge contradicts an existing active edge. "
        "Return strict JSON with keys: contradicts (boolean), reason (string), "
        "and confidence (float between 0.0 and 1.0)."
    )
    user_prompt = (
        f"{_format_edge_summary('Existing edge', existing_edge)}\n"
        f"{_format_edge_summary('New edge', new_edge)}"
    )
    return (system_prompt, user_prompt)


def build_curation_prompts(task_output: str) -> tuple[str, str]:
    kinds = ", ".join(kind.value for kind in NodeKind)
    relations = ", ".join(sorted(APPROVED_RELATIONS))
    system_prompt = (
        "Extract factual memory nodes and edges from the task output. "
        "Never extract secrets, credentials, API keys, or private tokens. "
        f"Allowed node kinds: {kinds}. "
        f"Allowed edge relation_name values: {relations}. "
        "Return strict JSON with keys: nodes (list of objects with kind, key, label, "
        "content, confidence) and edges (list of objects with relation_name, source_kind, "
        "source_key, target_kind, target_key, weight, confidence)."
    )
    user_prompt = f"Task output:\n{task_output}"
    return (system_prompt, user_prompt)
