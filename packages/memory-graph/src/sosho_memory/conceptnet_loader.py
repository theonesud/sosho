from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from sosho_memory.conceptnet_filter import ConceptNetFilterConfig, concept_slug
from sosho_memory.conceptnet_spine import (
    FilteredOntology,
    build_filtered_ontology,
    compute_filter_fingerprint,
)
from sosho_memory.models import (
    AgentRole,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    OntologyMetadata,
    Provenance,
)
from sosho_memory.store import SurrealMemoryStore


class ConceptNetLoadResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    skipped: bool
    dataset_version: str
    filter_fingerprint: str
    concept_count: int
    spine_edge_count: int
    lateral_edge_count: int
    created_edge_count: int


def _skipped_result(existing: OntologyMetadata) -> ConceptNetLoadResult:
    return ConceptNetLoadResult(
        skipped=True,
        dataset_version=existing.dataset_version,
        filter_fingerprint=existing.filter_fingerprint,
        concept_count=existing.concept_count,
        spine_edge_count=existing.spine_edge_count,
        lateral_edge_count=existing.lateral_edge_count,
        created_edge_count=0,
    )


async def _ensure_ontology_edges(
    store: SurrealMemoryStore,
    database: str,
    ontology: FilteredOntology,
    provenance: Provenance,
) -> int:
    created_edge_count = 0
    for assertion in (*ontology.spine_edges, *ontology.lateral_edges):
        _, created = await store.ensure_edge(
            database,
            MemoryEdge(
                relation=assertion.relation,
                source_kind=NodeKind.CONCEPT,
                source_key=concept_slug(assertion.source),
                target_kind=NodeKind.CONCEPT,
                target_key=concept_slug(assertion.target),
                weight=assertion.weight,
                provenance=provenance,
            ),
        )
        if created:
            created_edge_count += 1
    return created_edge_count


async def load_conceptnet_ontology(  # noqa: PLR0913
    store: SurrealMemoryStore,
    database: str,
    ontology: FilteredOntology,
    *,
    timestamp: datetime,
    session_id: str,
    agent_id: str = "conceptnet_loader",
) -> ConceptNetLoadResult:
    await store.ensure_scope(database)
    existing = await store.get_ontology_metadata(database, ontology.dataset_version)
    if existing is not None and existing.filter_fingerprint == ontology.filter_fingerprint:
        return _skipped_result(existing)
    provenance = Provenance(
        valid_from=timestamp,
        valid_to=None,
        confidence=1.0,
        agent_id=agent_id,
        agent_role=AgentRole.SYSTEM,
        session_id=session_id,
        timestamp=timestamp,
    )
    for term in ontology.concepts:
        await store.upsert_node(
            database,
            MemoryNode(
                kind=NodeKind.CONCEPT,
                key=concept_slug(term),
                label=term,
                content=term,
                embedding=None,
                provenance=provenance,
            ),
        )
    created_edge_count = await _ensure_ontology_edges(store, database, ontology, provenance)
    await store.upsert_ontology_metadata(
        database,
        OntologyMetadata(
            dataset_version=ontology.dataset_version,
            filter_fingerprint=ontology.filter_fingerprint,
            concept_count=len(ontology.concepts),
            spine_edge_count=len(ontology.spine_edges),
            lateral_edge_count=len(ontology.lateral_edges),
            loaded_at=timestamp,
            session_id=session_id,
        ),
    )
    return ConceptNetLoadResult(
        skipped=False,
        dataset_version=ontology.dataset_version,
        filter_fingerprint=ontology.filter_fingerprint,
        concept_count=len(ontology.concepts),
        spine_edge_count=len(ontology.spine_edges),
        lateral_edge_count=len(ontology.lateral_edges),
        created_edge_count=created_edge_count,
    )


async def load_conceptnet_from_lines(  # noqa: PLR0913
    store: SurrealMemoryStore,
    database: str,
    lines: Iterable[str],
    config: ConceptNetFilterConfig,
    *,
    timestamp: datetime,
    session_id: str,
    agent_id: str = "conceptnet_loader",
    noun_predicate: Callable[[str], bool] | None = None,
) -> ConceptNetLoadResult:
    await store.ensure_scope(database)
    fingerprint = compute_filter_fingerprint(config)
    existing = await store.get_ontology_metadata(database, config.dataset_version)
    if existing is not None and existing.filter_fingerprint == fingerprint:
        return _skipped_result(existing)
    ontology = build_filtered_ontology(lines, config, noun_predicate=noun_predicate)
    return await load_conceptnet_ontology(
        store,
        database,
        ontology,
        timestamp=timestamp,
        session_id=session_id,
        agent_id=agent_id,
    )
