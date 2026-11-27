from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict, Field

from sosho_memory.curation_models import cosine_similarity
from sosho_memory.models import MemoryNode, NodeKind


class DuplicateCandidate(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: NodeKind
    primary_key: str
    duplicate_key: str
    similarity: float = Field(ge=-1.0, le=1.0)


class DuplicateVerification(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    same_concept: bool
    canonical_label: str = Field(min_length=1)
    reason: str


class MergeResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: NodeKind
    primary_key: str
    duplicate_key: str
    rewired_edges: int = Field(ge=0)
    closed_edges: int = Field(ge=0)


class ConsolidationResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    promoted_fixes: int = Field(ge=0)
    source_episode_keys: tuple[str, ...]
    created_fix_keys: tuple[str, ...]


class DecayConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    half_life_days: float = Field(default=30.0, gt=0.0)
    min_active_weight: float = Field(default=0.1, gt=0.0)
    max_weight_to_decay: float = Field(default=1.5, gt=0.0)


class DecayResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    inspected_edges: int = Field(ge=0)
    decayed_edges: int = Field(ge=0)
    closed_edges: int = Field(ge=0)


class GraphHealthSummary(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    database: str
    node_counts: dict[str, int]
    edge_counts: dict[str, int]
    total_nodes: int = Field(ge=0)
    total_active_edges: int = Field(ge=0)
    orphan_node_count: int = Field(ge=0)
    orphan_node_ids: tuple[str, ...]


def compute_decayed_weight(weight: float, age_days: float, half_life_days: float) -> float:
    if not (weight >= 0.0):
        raise ValueError("weight must be non-negative")
    if not (half_life_days > 0.0):
        raise ValueError("half_life_days must be positive")
    if age_days <= 0.0:
        return weight
    return weight * (0.5 ** (age_days / half_life_days))


def _order_pair(node_a: MemoryNode, node_b: MemoryNode) -> tuple[MemoryNode, MemoryNode]:
    key_a = (node_a.provenance.valid_from, node_a.key)
    key_b = (node_b.provenance.valid_from, node_b.key)
    if key_a <= key_b:
        return (node_a, node_b)
    return (node_b, node_a)


def find_duplicate_candidates(
    nodes: Sequence[MemoryNode],
    *,
    similarity_threshold: float = 0.90,
) -> tuple[DuplicateCandidate, ...]:
    grouped: dict[NodeKind, list[tuple[MemoryNode, tuple[float, ...]]]] = {}
    for node in nodes:
        if node.provenance.valid_to is None and node.embedding is not None:
            grouped.setdefault(node.kind, []).append((node, node.embedding))
    candidates: list[DuplicateCandidate] = []
    for kind, items in grouped.items():
        for idx, (node_a, emb_a) in enumerate(items):
            for node_b, emb_b in items[idx + 1 :]:
                sim = max(-1.0, min(1.0, cosine_similarity(emb_a, emb_b)))
                if sim < similarity_threshold:
                    continue
                primary, duplicate = _order_pair(node_a, node_b)
                candidates.append(
                    DuplicateCandidate(
                        kind=kind,
                        primary_key=primary.key,
                        duplicate_key=duplicate.key,
                        similarity=sim,
                    )
                )
    candidates.sort(
        key=lambda item: (-item.similarity, item.kind.value, item.primary_key, item.duplicate_key)
    )
    return tuple(candidates)


def _format_node_summary(role: str, node: MemoryNode) -> str:
    return (
        f"{role} node [{node.kind.value}:{node.key}]\nLabel: {node.label}\nContent: {node.content}"
    )


def build_duplicate_verification_prompts(
    primary: MemoryNode,
    duplicate: MemoryNode,
) -> tuple[str, str]:
    system_prompt = (
        "Decide whether two memory nodes represent the same concept. "
        "Return strict JSON with keys: same_concept (boolean), "
        "canonical_label (non-empty string), and reason (string)."
    )
    user_prompt = (
        f"{_format_node_summary('Primary', primary)}\n\n"
        f"{_format_node_summary('Duplicate', duplicate)}"
    )
    return (system_prompt, user_prompt)
