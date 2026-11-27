from collections.abc import Sequence

from sosho_memory.conceptnet_filter import concept_slug
from sosho_memory.curation_models import (
    CandidateEdge,
    CandidateNode,
    ContradictionDecision,
    ContradictionResolutionResult,
    CurationReport,
    ExtractionPayload,
    OntologyGrowthResult,
    ParentAttachmentDecision,
    build_contradiction_prompts,
    build_curation_prompts,
    build_parent_attachment_prompts,
    select_best_sense_candidate,
)
from sosho_memory.errors import (
    MemoryValidationError,
    SecretRejectedError,
    UnapprovedRelationError,
)
from sosho_memory.litellm_client import LiteLLMClient
from sosho_memory.models import (
    ConceptNetRelation,
    MemoryEdge,
    MemoryNode,
    NodeKind,
    Provenance,
    WorkflowRelation,
)
from sosho_memory.write_gate import validate_edge_write, validate_relation_name
from sosho_memory.write_service import MemoryWriteService


def _is_contradiction_candidate(existing: MemoryEdge, new_edge: MemoryEdge) -> bool:
    return (
        existing.provenance.valid_to is None
        and existing.source_kind == new_edge.source_kind
        and existing.source_key == new_edge.source_key
        and existing.relation == new_edge.relation
        and (existing.target_kind, existing.target_key)
        != (new_edge.target_kind, new_edge.target_key)
    )


def _build_concept_node(
    term: str,
    slug: str,
    embedding: tuple[float, ...],
    provenance: Provenance,
) -> MemoryNode:
    return MemoryNode(
        kind=NodeKind.CONCEPT,
        key=slug,
        label=term,
        content=term,
        embedding=embedding,
        provenance=provenance,
    )


def _to_memory_node(
    candidate: CandidateNode,
    embedding: tuple[float, ...],
    provenance: Provenance,
) -> MemoryNode:
    return MemoryNode(
        kind=candidate.kind,
        key=candidate.key,
        label=candidate.label,
        content=candidate.content,
        embedding=embedding,
        provenance=provenance.model_copy(update={"confidence": candidate.confidence}),
    )


def _to_memory_edge(candidate: CandidateEdge, provenance: Provenance) -> MemoryEdge:
    relation = validate_relation_name(candidate.relation_name)
    return MemoryEdge(
        relation=relation,
        source_kind=candidate.source_kind,
        source_key=candidate.source_key,
        target_kind=candidate.target_kind,
        target_key=candidate.target_key,
        weight=candidate.weight,
        provenance=provenance.model_copy(update={"confidence": candidate.confidence}),
    )


class OntologyCurator:
    def __init__(self, write_service: MemoryWriteService, model_client: LiteLLMClient) -> None:
        self._write_service = write_service
        self._model_client = model_client

    async def _resolve_parent_attachment(
        self,
        term: str,
        context: str,
        candidate_parents: Sequence[tuple[str, str]],
    ) -> tuple[str, ConceptNetRelation]:
        if candidate_parents:
            vecs = await self._model_client.embed(
                [context, *(defn for _, defn in candidate_parents)]
            )
            candidates = [
                (parent_term, vec)
                for (parent_term, _), vec in zip(candidate_parents, vecs[1:], strict=True)
            ]
            selected = select_best_sense_candidate(vecs[0], candidates)
            if selected is None:
                raise MemoryValidationError("No parent candidate selected.")
            return selected, ConceptNetRelation.IS_A
        sys_p, user_p = build_parent_attachment_prompts(term, context)
        decision = await self._model_client.decide_json(sys_p, user_p, ParentAttachmentDecision)
        relation = validate_relation_name(decision.relation_name)
        if not isinstance(relation, ConceptNetRelation):
            raise UnapprovedRelationError(
                f"Relation '{decision.relation_name}' is not a ConceptNetRelation."
            )
        return decision.parent_term, relation

    async def attach_unknown_concept(  # noqa: PLR0913
        self,
        database: str,
        term: str,
        context: str,
        candidate_parents: Sequence[tuple[str, str]],
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> OntologyGrowthResult:
        parent_term, relation = await self._resolve_parent_attachment(
            term, context, candidate_parents
        )
        term_vecs = await self._model_client.embed([term, parent_term])
        term_slug = concept_slug(term)
        parent_slug = concept_slug(parent_term)
        await self._write_service.write_node(
            database,
            _build_concept_node(term, term_slug, term_vecs[0], provenance),
            transaction_id=transaction_id,
        )
        await self._write_service.write_node(
            database,
            _build_concept_node(parent_term, parent_slug, term_vecs[1], provenance),
            transaction_id=transaction_id,
        )
        edge = MemoryEdge(
            relation=relation,
            source_kind=NodeKind.CONCEPT,
            source_key=term_slug,
            target_kind=NodeKind.CONCEPT,
            target_key=parent_slug,
            provenance=provenance,
        )
        edge_audit = await self._write_service.write_edge(
            database,
            edge,
            transaction_id=transaction_id,
        )
        return OntologyGrowthResult(
            term=term,
            attached_parent=parent_term,
            relation=relation,
            created_edge_id=edge_audit.target_id,
        )

    async def _resolve_existing_contradictions(
        self,
        database: str,
        new_edge: MemoryEdge,
        existing_edges: Sequence[tuple[str, MemoryEdge]],
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> tuple[tuple[str, ...], tuple[str, ...]]:
        closed_edge_ids: list[str] = []
        supersedes_edge_ids: list[str] = []
        for edge_id, existing in existing_edges:
            if not _is_contradiction_candidate(existing, new_edge):
                continue
            decision = await self._model_client.decide_json(
                *build_contradiction_prompts(existing, new_edge),
                ContradictionDecision,
            )
            if not decision.contradicts:
                continue
            close_audit = await self._write_service.close_edge(
                database,
                existing.relation,
                edge_id,
                valid_to=provenance.timestamp,
                provenance=provenance,
                transaction_id=transaction_id,
            )
            closed_edge_ids.append(close_audit.target_id)
            supersedes_edge = MemoryEdge(
                relation=WorkflowRelation.SUPERSEDES,
                source_kind=new_edge.target_kind,
                source_key=new_edge.target_key,
                target_kind=existing.target_kind,
                target_key=existing.target_key,
                provenance=provenance,
            )
            supersedes_audit = await self._write_service.write_edge(
                database,
                supersedes_edge,
                transaction_id=transaction_id,
            )
            supersedes_edge_ids.append(supersedes_audit.target_id)
        return tuple(closed_edge_ids), tuple(supersedes_edge_ids)

    async def resolve_and_write_edge(
        self,
        database: str,
        new_edge: MemoryEdge,
        existing_edges: Sequence[tuple[str, MemoryEdge]],
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> ContradictionResolutionResult:
        validate_edge_write(new_edge)
        closed_edge_ids, supersedes_edge_ids = await self._resolve_existing_contradictions(
            database,
            new_edge,
            existing_edges,
            provenance=provenance,
            transaction_id=transaction_id,
        )
        new_edge_audit = await self._write_service.write_edge(
            database,
            new_edge,
            transaction_id=transaction_id,
        )
        return ContradictionResolutionResult(
            contradicted=bool(closed_edge_ids),
            closed_edge_ids=closed_edge_ids,
            new_edge_id=new_edge_audit.target_id,
            supersedes_edge_ids=supersedes_edge_ids,
        )

    async def _write_curated_nodes(
        self,
        database: str,
        nodes: tuple[CandidateNode, ...],
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> tuple[int, int]:
        if not nodes:
            return 0, 0
        embeddings = await self._model_client.embed([node.content for node in nodes])
        written_nodes = 0
        rejected_secret_items = 0
        for candidate, embedding in zip(nodes, embeddings, strict=True):
            node = _to_memory_node(candidate, embedding, provenance)
            try:
                await self._write_service.write_node(
                    database,
                    node,
                    transaction_id=transaction_id,
                )
                written_nodes += 1
            except SecretRejectedError:
                rejected_secret_items += 1
        return written_nodes, rejected_secret_items

    async def _write_curated_edges(
        self,
        database: str,
        edges: tuple[CandidateEdge, ...],
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> tuple[int, int, int]:
        written_edges = 0
        rejected_unapproved_edges = 0
        rejected_secret_items = 0
        for candidate in edges:
            try:
                edge = _to_memory_edge(candidate, provenance)
            except UnapprovedRelationError:
                rejected_unapproved_edges += 1
                continue
            try:
                await self._write_service.write_edge(
                    database,
                    edge,
                    transaction_id=transaction_id,
                )
                written_edges += 1
            except SecretRejectedError:
                rejected_secret_items += 1
        return written_edges, rejected_unapproved_edges, rejected_secret_items

    async def curate_task_output(
        self,
        database: str,
        task_output: str,
        *,
        provenance: Provenance,
        transaction_id: str,
    ) -> CurationReport:
        payload = await self._model_client.decide_json(
            *build_curation_prompts(task_output),
            ExtractionPayload,
        )
        written_nodes, node_secrets = await self._write_curated_nodes(
            database,
            payload.nodes,
            provenance=provenance,
            transaction_id=transaction_id,
        )
        written_edges, rejected_unapproved, edge_secrets = await self._write_curated_edges(
            database,
            payload.edges,
            provenance=provenance,
            transaction_id=transaction_id,
        )
        return CurationReport(
            written_nodes=written_nodes,
            written_edges=written_edges,
            rejected_unapproved_edges=rejected_unapproved,
            rejected_secret_items=node_secrets + edge_secrets,
            superseded_edges=0,
        )
