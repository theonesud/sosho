import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sosho_memory import (
    AgentRole,
    ConceptNetLoadResult,
    GraphHealthSummary,
    MemoryNode,
    MemoryWriteService,
    NodeKind,
    Provenance,
    RollbackResult,
    SurrealMemoryStore,
    load_memory_settings,
)
from sosho_memory.cli import CliInitResult, run_cli

_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "conceptnet_sample.tsv"
_BASE_TIME = datetime(2026, 4, 1, 10, 0, 0, tzinfo=UTC)


async def _seed_node(
    surreal_url: str,
    *,
    project_id: str,
    key: str,
    session_id: str,
    transaction_id: str,
) -> None:
    settings = load_memory_settings(surreal_url=surreal_url)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope(project_id)
        write_service = MemoryWriteService(store)
        provenance = Provenance(
            valid_from=_BASE_TIME,
            valid_to=None,
            confidence=0.9,
            agent_id="cli-test-agent",
            agent_role=AgentRole.COORDINATOR,
            session_id=session_id,
            timestamp=_BASE_TIME,
        )
        node = MemoryNode(
            kind=NodeKind.PREFERENCE,
            key=key,
            label=key,
            content=f"content for {key}",
            embedding=None,
            provenance=provenance,
        )
        await write_service.write_node(db, node, transaction_id=transaction_id)


async def _node_exists(surreal_url: str, project_id: str, key: str) -> bool:
    settings = load_memory_settings(surreal_url=surreal_url)
    async with SurrealMemoryStore(settings) as store:
        db = await store.ensure_project_scope(project_id)
        return await store.get_node(db, NodeKind.PREFERENCE, key) is not None


def test_cli_init_preload_and_health(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    surreal_url = f"surrealkv://{tmp_path / 'cli.db'}"

    rc_init = run_cli(["init", "--surreal-url", surreal_url, "--project", "alpha-1"])
    assert rc_init == 0
    init_result = CliInitResult.model_validate_json(capsys.readouterr().out)
    assert init_result.surreal_url == surreal_url
    assert init_result.user_database == "user_memory"
    assert init_result.project_database == "project_alpha_1"
    assert init_result.databases == ("user_memory", "project_alpha_1")

    rc_preload = run_cli(
        [
            "preload-conceptnet",
            "--surreal-url",
            surreal_url,
            "--input",
            str(_FIXTURE_PATH),
            "--min-degree",
            "2",
            "--session-id",
            "sess-cli-preload",
        ]
    )
    assert rc_preload == 0
    preload_result = ConceptNetLoadResult.model_validate_json(capsys.readouterr().out)
    assert preload_result.skipped is False
    assert preload_result.concept_count == 20
    assert preload_result.spine_edge_count == 17
    assert preload_result.lateral_edge_count == 7
    assert preload_result.created_edge_count == 24

    rc_health = run_cli(["health", "--surreal-url", surreal_url])
    assert rc_health == 0
    health = GraphHealthSummary.model_validate_json(capsys.readouterr().out)
    assert health.database == "user_memory"
    assert health.total_nodes == 20
    assert health.total_active_edges == 24
    assert health.orphan_node_count == 0


async def _seed_two_nodes(surreal_url: str, project_id: str) -> None:
    await _seed_node(
        surreal_url,
        project_id=project_id,
        key="pref_tx",
        session_id="sess-1",
        transaction_id="tx-1",
    )
    await _seed_node(
        surreal_url,
        project_id=project_id,
        key="pref_sess",
        session_id="sess-2",
        transaction_id="tx-2",
    )


def _run_rollback(
    capsys: pytest.CaptureFixture[str],
    surreal_url: str,
    project_id: str,
    flag: str,
    value: str,
) -> RollbackResult:
    rc = run_cli(
        [
            "rollback",
            "--surreal-url",
            surreal_url,
            "--project",
            project_id,
            flag,
            value,
        ]
    )
    assert rc == 0
    return RollbackResult.model_validate_json(capsys.readouterr().out)


def test_cli_audit_and_rollback(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    surreal_url = f"surrealkv://{tmp_path / 'cli.db'}"
    project_id = "proj-ops"

    assert run_cli(["init", "--surreal-url", surreal_url, "--project", project_id]) == 0
    capsys.readouterr()
    asyncio.run(_seed_two_nodes(surreal_url, project_id))

    rc_audit = run_cli(
        ["audit", "--surreal-url", surreal_url, "--project", project_id, "--transaction-id", "tx-1"]
    )
    assert rc_audit == 0
    audit_out = capsys.readouterr().out
    assert "| timestamp | transaction_id | session_id |" in audit_out
    assert "tx-1" in audit_out
    assert "preference:pref_tx" in audit_out
    assert "tx-2" not in audit_out

    rb_tx = _run_rollback(capsys, surreal_url, project_id, "--transaction-id", "tx-1")
    assert rb_tx.scope == "transaction"
    assert rb_tx.target_id == "tx-1"
    assert rb_tx.reverted_entries == 1
    assert rb_tx.reverted_transaction_ids == ("tx-1",)
    assert not asyncio.run(_node_exists(surreal_url, project_id, "pref_tx"))
    assert asyncio.run(_node_exists(surreal_url, project_id, "pref_sess"))

    rb_sess = _run_rollback(capsys, surreal_url, project_id, "--session-id", "sess-2")
    assert rb_sess.scope == "session"
    assert rb_sess.target_id == "sess-2"
    assert rb_sess.reverted_entries == 1
    assert rb_sess.reverted_transaction_ids == ("tx-2",)
    assert not asyncio.run(_node_exists(surreal_url, project_id, "pref_sess"))
