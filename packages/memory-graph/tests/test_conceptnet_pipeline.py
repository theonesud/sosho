import asyncio
from datetime import UTC, datetime
from pathlib import Path

import networkx as nx
from sosho_memory import (
    ConceptNetFilterConfig,
    ConceptNetRelation,
    MemoryEdge,
    NodeKind,
    SurrealMemoryStore,
    build_filtered_ontology,
    load_conceptnet_from_lines,
    load_memory_settings,
)

_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "conceptnet_sample.tsv"
_BASE_TIME = datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC)


def _sample_lines() -> list[str]:
    return _FIXTURE_PATH.read_text(encoding="utf-8").splitlines()


def test_conceptnet_filter_and_canonical_spine() -> None:
    lines = _sample_lines()
    config = ConceptNetFilterConfig(min_degree=2)
    ontology = build_filtered_ontology(lines, config)

    excluded = {
        "chien",
        "tier",
        "very big dog",
        "model 3",
        "piece of cake",
        "a",
        "orphan left",
        "orphan right",
        "feline",
    }
    assert excluded.isdisjoint(ontology.concepts)

    spine_pairs = {(edge.source, edge.target): edge.weight for edge in ontology.spine_edges}
    assert spine_pairs[("poodle", "dog")] == 4.0

    spine_graph: nx.DiGraph[str] = nx.DiGraph()
    for edge in ontology.spine_edges:
        assert edge.relation == ConceptNetRelation.IS_A
        spine_graph.add_edge(edge.source, edge.target)
    assert nx.is_directed_acyclic_graph(spine_graph)
    assert all(spine_graph.out_degree(node) <= 1 for node in spine_graph.nodes())
    assert ("poodle", "animal") not in spine_pairs
    assert ("dog", "canine") not in spine_pairs
    assert ("dog", "mammal") in spine_pairs
    assert ("dog", "pet") not in spine_pairs

    lateral_relations = {edge.relation for edge in ontology.lateral_edges}
    assert ConceptNetRelation.IS_A not in lateral_relations
    assert lateral_relations == {
        ConceptNetRelation.PART_OF,
        ConceptNetRelation.USED_FOR,
        ConceptNetRelation.CAUSES,
        ConceptNetRelation.HAS_PREREQUISITE,
        ConceptNetRelation.ANTONYM,
    }

    without_poodle = build_filtered_ontology(
        lines,
        config,
        noun_predicate=lambda term: term != "poodle",
    )
    assert "poodle" not in without_poodle.concepts
    assert all(
        edge.source != "poodle" and edge.target != "poodle"
        for edge in (*without_poodle.spine_edges, *without_poodle.lateral_edges)
    )


async def _verify_initial_graph(
    store: SurrealMemoryStore,
    db: str,
    expected_fingerprint: str,
) -> tuple[tuple[MemoryEdge, ...], tuple[MemoryEdge, ...]]:
    poodle_node = await store.get_node(db, NodeKind.CONCEPT, "poodle")
    assert poodle_node is not None
    assert poodle_node.label == "poodle"

    poodle_isa = await store.list_outgoing_edges(
        db, NodeKind.CONCEPT, "poodle", relation=ConceptNetRelation.IS_A
    )
    assert len(poodle_isa) == 1
    assert poodle_isa[0].target_key == "dog"
    assert poodle_isa[0].weight == 4.0

    bark_causes = await store.list_outgoing_edges(
        db, NodeKind.CONCEPT, "bark", relation=ConceptNetRelation.CAUSES
    )
    assert len(bark_causes) == 1
    assert bark_causes[0].target_key == "noise"

    meta = await store.get_ontology_metadata(db, "conceptnet-5.7.0")
    assert meta is not None
    assert meta.filter_fingerprint == expected_fingerprint
    assert meta.concept_count == 20
    assert meta.spine_edge_count == 17
    assert meta.lateral_edge_count == 7

    poodle_edges = await store.list_outgoing_edges(db, NodeKind.CONCEPT, "poodle")
    dog_edges = await store.list_outgoing_edges(db, NodeKind.CONCEPT, "dog")
    assert len(poodle_edges) == 1
    assert len(dog_edges) == 2
    return poodle_edges, dog_edges


async def _run_idempotent_preload(db_path: Path) -> None:
    lines = _sample_lines()
    settings = load_memory_settings(
        surreal_url=f"surrealkv://{db_path}",
        embedding_dimensions=4,
    )
    base_config = ConceptNetFilterConfig(min_degree=2)
    changed_config = ConceptNetFilterConfig(min_degree=2, min_weight=1.5)

    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_user_scope()
        assert db == "user_memory"

        result1 = await load_conceptnet_from_lines(
            store, db, lines, base_config, timestamp=_BASE_TIME, session_id="sess-load-1"
        )
        assert result1.skipped is False
        assert result1.concept_count == 20
        assert result1.spine_edge_count == 17
        assert result1.lateral_edge_count == 7
        assert result1.created_edge_count == 24

        poodle_edges, dog_edges = await _verify_initial_graph(store, db, result1.filter_fingerprint)

        result2 = await load_conceptnet_from_lines(
            store, db, lines, base_config, timestamp=_BASE_TIME, session_id="sess-load-1"
        )
        assert result2.skipped is True
        assert result2.created_edge_count == 0
        assert await store.list_outgoing_edges(db, NodeKind.CONCEPT, "poodle") == poodle_edges
        assert await store.list_outgoing_edges(db, NodeKind.CONCEPT, "dog") == dog_edges

        result3 = await load_conceptnet_from_lines(
            store, db, lines, changed_config, timestamp=_BASE_TIME, session_id="sess-load-1"
        )
        assert result3.skipped is False
        assert result3.created_edge_count == 0
        assert await store.list_outgoing_edges(db, NodeKind.CONCEPT, "poodle") == poodle_edges
        assert await store.list_outgoing_edges(db, NodeKind.CONCEPT, "dog") == dog_edges

        meta3 = await store.get_ontology_metadata(db, "conceptnet-5.7.0")
        assert meta3 is not None
        assert meta3.filter_fingerprint == result3.filter_fingerprint
        assert meta3.filter_fingerprint != result1.filter_fingerprint


def test_conceptnet_idempotent_preload_into_surrealkv(tmp_path: Path) -> None:
    asyncio.run(_run_idempotent_preload(tmp_path / "conceptnet.db"))
