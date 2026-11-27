import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sosho_memory import (
    AgentRole,
    CompressedPath,
    ConceptNetRelation,
    ErrorFixPair,
    MemoryEdge,
    MemoryNode,
    MemoryRetriever,
    MemorySourceScope,
    MemoryValidationError,
    MemoryWriteService,
    NodeKind,
    Provenance,
    ScoredNode,
    SurrealMemoryStore,
    WorkflowRelation,
    extract_compressed_paths,
    load_memory_settings,
    pack_context_within_budget,
)

_BASE_TIME = datetime(2026, 3, 1, 10, 0, 0, tzinfo=UTC)


def _prov() -> Provenance:
    return Provenance(
        valid_from=_BASE_TIME,
        valid_to=None,
        confidence=0.95,
        agent_id="coord-1",
        agent_role=AgentRole.COORDINATOR,
        session_id="sess-retrieval",
        timestamp=_BASE_TIME,
    )


def _node(
    kind: NodeKind,
    key: str,
    content: str,
    *,
    label: str | None = None,
    embedding: tuple[float, ...] | None = None,
) -> MemoryNode:
    return MemoryNode(
        kind=kind,
        key=key,
        label=label if label is not None else key,
        content=content,
        embedding=embedding,
        provenance=_prov(),
    )


def _edge(
    relation: ConceptNetRelation | WorkflowRelation,
    source: tuple[NodeKind, str],
    target: tuple[NodeKind, str],
    *,
    weight: float = 1.0,
) -> MemoryEdge:
    return MemoryEdge(
        relation=relation,
        source_kind=source[0],
        source_key=source[1],
        target_kind=target[0],
        target_key=target[1],
        weight=weight,
        provenance=_prov(),
    )


async def _seed_precedence_scopes(
    writer: MemoryWriteService,
    user_db: str,
    project_db: str,
) -> None:
    user_nodes = (
        _node(
            NodeKind.PREFERENCE,
            "pref_tone",
            "concise",
            label="tone",
            embedding=(1.0, 0.0, 0.0, 0.0),
        ),
        _node(
            NodeKind.PREFERENCE,
            "pref_lang",
            "python",
            label="language",
            embedding=(0.0, 1.0, 0.0, 0.0),
        ),
        _node(
            NodeKind.ENTITY,
            "style_guide",
            "tone guidelines for architecture notes",
            label="style guide",
            embedding=(1.0, 0.0, 0.0, 0.0),
        ),
    )
    for idx, node in enumerate(user_nodes, start=1):
        await writer.write_node(user_db, node, transaction_id=f"tx-u-{idx}")
    await writer.write_node(
        project_db,
        _node(
            NodeKind.PREFERENCE,
            "pref_tone",
            "formal technical",
            label="tone",
            embedding=(1.0, 0.0, 0.0, 0.0),
        ),
        transaction_id="tx-p-1",
    )


async def _run_two_graph_precedence(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        writer = MemoryWriteService(store)
        retriever = MemoryRetriever(store)
        user_db = await store.ensure_user_scope()
        project_db = await store.ensure_project_scope("alpha")
        await _seed_precedence_scopes(writer, user_db, project_db)
        pack = await retriever.build_context_pack(
            project_id="alpha",
            query_text="tone",
            query_vector=(1.0, 0.0, 0.0, 0.0),
            token_budget=400,
        )
        by_key = {item.node.key: item for item in pack.preferences}
        assert set(by_key) == {"pref_tone", "pref_lang"}
        assert by_key["pref_tone"].scope is MemorySourceScope.PROJECT
        assert by_key["pref_tone"].node.content == "formal technical"
        assert by_key["pref_lang"].scope is MemorySourceScope.USER
        assert by_key["pref_lang"].node.content == "python"
        assert pack.rendered_text.startswith("[PREFERENCES]")
        assert any(
            item.node.key == "style_guide" and item.scope is MemorySourceScope.USER
            for item in pack.supporting_nodes
        )
        assert pack.estimated_tokens <= pack.token_budget


def test_two_graph_precedence_and_preference_priority(tmp_path: Path) -> None:
    asyncio.run(_run_two_graph_precedence(tmp_path / "precedence.db"))


async def _seed_hybrid_graph(writer: MemoryWriteService, db: str) -> None:
    nodes = (
        _node(
            NodeKind.ERROR,
            "err_lock",
            "sqlite database lock timeout",
            embedding=(1.0, 0.0, 0.0, 0.0),
        ),
        _node(
            NodeKind.FIX,
            "fix_wal",
            "enable WAL mode and busy timeout",
            embedding=(0.9, 0.1, 0.0, 0.0),
        ),
        _node(
            NodeKind.CONCEPT,
            "sqlite",
            "embedded sql engine",
            embedding=(0.0, 1.0, 0.0, 0.0),
        ),
        _node(
            NodeKind.CONCEPT,
            "database",
            "structured persistence system",
            embedding=(0.0, 0.8, 0.2, 0.0),
        ),
        _node(
            NodeKind.CONCEPT,
            "storage",
            "durable disk layer",
            embedding=(0.0, 0.0, 1.0, 0.0),
        ),
    )
    for idx, node in enumerate(nodes, start=1):
        await writer.write_node(db, node, transaction_id=f"tx-h-n-{idx}")
    edges = (
        _edge(WorkflowRelation.FIXED_BY, (NodeKind.ERROR, "err_lock"), (NodeKind.FIX, "fix_wal")),
        _edge(
            ConceptNetRelation.IS_A, (NodeKind.CONCEPT, "sqlite"), (NodeKind.CONCEPT, "database")
        ),
        _edge(
            ConceptNetRelation.IS_A, (NodeKind.CONCEPT, "database"), (NodeKind.CONCEPT, "storage")
        ),
    )
    for idx, edge in enumerate(edges, start=1):
        await writer.write_edge(db, edge, transaction_id=f"tx-h-e-{idx}")


async def _run_hybrid_and_expansion(db_path: Path) -> None:
    settings = load_memory_settings(surreal_url=f"surrealkv://{db_path}", embedding_dimensions=4)
    async with SurrealMemoryStore(settings) as store:
        writer = MemoryWriteService(store)
        retriever = MemoryRetriever(store)
        db = await store.ensure_project_scope("beta")
        await _seed_hybrid_graph(writer, db)
        scored = await retriever.hybrid_search_scope(
            db,
            MemorySourceScope.PROJECT,
            query_text="sqlite lock",
            query_vector=(1.0, 0.0, 0.0, 0.0),
        )
        err_hits = [
            item
            for item in scored
            if item.node.kind is NodeKind.ERROR and item.node.key == "err_lock"
        ]
        assert len(err_hits) == 1
        assert err_hits[0].score > 0.0
        assert err_hits[0].vector_score > 0.0
        assert err_hits[0].bm25_score > 0.0
        pairs = await retriever.find_error_fixes(
            db,
            MemorySourceScope.PROJECT,
            query_text="sqlite lock",
            query_vector=(1.0, 0.0, 0.0, 0.0),
        )
        assert len(pairs) == 1
        assert pairs[0].error_node.key == "err_lock"
        assert pairs[0].fix_node.key == "fix_wal"
        assert pairs[0].scope is MemorySourceScope.PROJECT
        hop1 = await retriever.expand_subgraph(db, NodeKind.CONCEPT, "sqlite", hops=1)
        assert {node.key for node in hop1.nodes} == {"sqlite", "database"}
        hop2 = await retriever.expand_subgraph(db, NodeKind.CONCEPT, "sqlite", hops=2)
        assert {node.key for node in hop2.nodes} == {"sqlite", "database", "storage"}
        assert len(hop2.paths) >= 1
        assert any("--[IsA]-->" in path.rendered for path in hop2.paths)
        for bad_hops in (0, 5):
            with pytest.raises(MemoryValidationError):
                await retriever.expand_subgraph(db, NodeKind.CONCEPT, "sqlite", hops=bad_hops)


def test_hybrid_search_error_fixes_and_graph_expansion(tmp_path: Path) -> None:
    asyncio.run(_run_hybrid_and_expansion(tmp_path / "hybrid.db"))


def _verify_compressed_paths() -> tuple[CompressedPath, ...]:
    edges = (
        _edge(
            WorkflowRelation.DEPENDS_ON,
            (NodeKind.ENTITY, "app"),
            (NodeKind.CONCEPT, "sqlite"),
            weight=2.0,
        ),
        _edge(
            ConceptNetRelation.IS_A,
            (NodeKind.CONCEPT, "sqlite"),
            (NodeKind.CONCEPT, "database"),
            weight=2.0,
        ),
        _edge(
            WorkflowRelation.FIXED_BY,
            (NodeKind.ERROR, "timeout"),
            (NodeKind.FIX, "retry"),
            weight=0.5,
        ),
    )
    seeds = ("entity:app", "concept:database", "error:timeout", "fix:retry")
    paths = extract_compressed_paths(seeds, edges, max_paths=5)
    assert len(paths) == 2
    assert paths[0].total_cost < paths[1].total_cost
    assert "--[DependsOn]-->" in paths[0].rendered
    assert "--[IsA]-->" in paths[0].rendered
    assert "--[FixedBy]-->" in paths[1].rendered
    assert extract_compressed_paths(seeds, edges, max_paths=1) == (paths[0],)
    return paths


def _budget_fixtures() -> tuple[
    tuple[ScoredNode, ...],
    tuple[ErrorFixPair, ...],
    tuple[ScoredNode, ...],
]:
    preferences = (
        ScoredNode(
            node=_node(NodeKind.PREFERENCE, "pref_tone", "concise", label="tone"),
            scope=MemorySourceScope.PROJECT,
            score=2.0,
        ),
    )
    error_fixes = (
        ErrorFixPair(
            error_node=_node(NodeKind.ERROR, "err_lock", "sqlite lock", label="lock"),
            fix_node=_node(NodeKind.FIX, "fix_wal", "use WAL mode", label="wal"),
            scope=MemorySourceScope.PROJECT,
            weight=1.0,
        ),
    )
    supporting = (
        ScoredNode(
            node=_node(
                NodeKind.ENTITY,
                "ctx_long",
                "long context entry that exceeds remaining token budget for testing overflow",
                label="ctx_long",
            ),
            scope=MemorySourceScope.USER,
            score=1.0,
        ),
    )
    return preferences, error_fixes, supporting


def test_path_compression_and_hard_token_budget() -> None:
    paths = _verify_compressed_paths()
    preferences, error_fixes, supporting = _budget_fixtures()
    pack_40 = pack_context_within_budget(
        preferences=preferences,
        error_fixes=error_fixes,
        paths=paths,
        supporting_nodes=supporting,
        token_budget=40,
    )
    assert pack_40.estimated_tokens <= pack_40.token_budget
    assert pack_40.truncated is True
    assert "[PREFERENCES]" in pack_40.rendered_text
    assert "[PAST ERROR FIXES]" in pack_40.rendered_text
    assert pack_40.rendered_text.index("[PREFERENCES]") < pack_40.rendered_text.index(
        "[PAST ERROR FIXES]"
    )
    assert "[CONTEXT]" not in pack_40.rendered_text
    pack_12 = pack_context_within_budget(
        preferences=preferences,
        error_fixes=error_fixes,
        paths=paths,
        supporting_nodes=supporting,
        token_budget=12,
    )
    assert pack_12.estimated_tokens <= pack_12.token_budget
    assert pack_12.truncated is True
    assert pack_12.rendered_text.startswith("[PREFERENCES]")
