import json
from pathlib import Path

import pytest
from pydantic import JsonValue
from sosho_engine import version
from sosho_engine.errors import NodeFailedError
from sosho_engine.health import worker_health
from sosho_engine.lifecycle import dbos_config
from sosho_engine.pi_events import PiTrace
from sosho_engine.settings import ENGINE_EXECUTOR, WORKER_EXECUTOR, Settings
from sosho_engine.skills import discover_skills, link_skills
from sosho_engine.store_tables import WorkerBeat
from sosho_engine.workdir import prepare_workdir, workdir_for
from sosho_engine.worker import worker_settings

TOKEN = "unit-token-0123456789abcdef"  # noqa: S105
NOW = 1_000_000


def _line(event: dict[str, JsonValue]) -> bytes:
    return (json.dumps(event) + "\n").encode()


def _skills(root: Path, *names: str) -> Path:
    for name in names:
        (root / name).mkdir(parents=True)
        (root / name / "SKILL.md").write_text("x")
    return root


def test_trace_skips_lines_that_are_not_json_and_collects_the_result() -> None:
    trace = PiTrace()
    assert trace.feed(b"hello\n") is None
    assert trace.feed(b"[1]\n") is None
    assert trace.feed(_line({"type": "message_end", "message": {"role": "user"}})) == "message_end"
    reply: dict[str, JsonValue] = {
        "role": "assistant",
        "content": [{"type": "thinking", "thinking": "x"}, {"type": "text", "text": "DONE"}],
        "usage": {"input": 3, "output": 4, "cacheRead": 5, "totalTokens": 12, "cost": {"total": 1}},
        "stopReason": "stop",
    }
    trace.feed(_line({"type": "message_end", "message": reply}))
    trace.feed(_line({"type": "turn_end", "message": reply}))
    trace.feed(_line({"type": "tool_execution_end", "toolName": "bash", "isError": True}))
    trace.feed(_line({"type": "agent_end", "messages": [reply]}))
    assert (trace.turns, trace.text, trace.stop_reason, trace.ended) == (1, "DONE", "stop", True)
    assert trace.tokens["cache_read"] == 5
    assert trace.cost == 1.0
    assert trace.tool_calls == [{"name": "bash", "ok": False}]


def test_trace_ignores_an_event_with_a_wrong_shape() -> None:
    trace = PiTrace()
    assert trace.feed(_line({"type": "turn_end", "messages": "bad"})) is None
    assert trace.turns == 0


def test_workdir_path_stays_under_the_runs_directory(tmp_path: Path) -> None:
    path = workdir_for(tmp_path, "../../etc:run", "node")
    assert path.is_relative_to(tmp_path.resolve())
    assert path.name == "node"
    assert workdir_for(tmp_path, "..", "..").relative_to(tmp_path.resolve()).as_posix() == "_/_"


def test_prepare_workdir_is_safe_to_run_twice(tmp_path: Path) -> None:
    skills = _skills(tmp_path / "skills", "alpha")
    path = workdir_for(tmp_path / "runs", "run1", "n")
    prepare_workdir(path, skills, ["alpha"])
    (path / "stale.txt").write_text("old")
    prepare_workdir(path, skills, ["alpha"])
    assert not (path / "stale.txt").exists()
    link = path / ".agents" / "skills" / "alpha"
    assert link.is_symlink()
    assert link.resolve() == (skills / "alpha").resolve()


def test_link_skills_refuses_a_skill_that_is_missing(tmp_path: Path) -> None:
    with pytest.raises(NodeFailedError, match="skill ghost is not in"):
        link_skills(tmp_path / "work", _skills(tmp_path / "skills", "alpha"), ["ghost"])


def test_discover_skills_lists_directories_with_a_skill_file(tmp_path: Path) -> None:
    root = _skills(tmp_path / "skills", "beta", "alpha")
    (root / "empty").mkdir()
    (root / ".hidden").mkdir()
    (root / "note.txt").write_text("x")
    assert discover_skills(root) == ["alpha", "beta"]
    assert discover_skills(tmp_path / "none") == []


def _beat(version_name: str, age_ms: int) -> WorkerBeat:
    return WorkerBeat(executor_id="w", app_version=version_name, seen_ms=NOW - age_ms)


def test_health_reports_a_live_worker_with_the_same_version() -> None:
    health = worker_health([_beat("v1", 1000)], "v1", NOW, 30)
    assert (health.alive, health.version, health.version_mismatch) == (True, "v1", False)


def test_health_detects_a_live_worker_with_another_version() -> None:
    health = worker_health([_beat("v0", 1000)], "v1", NOW, 30)
    assert (health.alive, health.version, health.version_mismatch) == (False, "v0", True)


def test_health_reports_no_worker_when_the_beat_is_old_or_missing() -> None:
    assert worker_health([_beat("v1", 40_000)], "v1", NOW, 30).alive is False
    health = worker_health([], "v1", NOW, 30)
    assert (health.alive, health.version, health.version_mismatch) == (False, None, False)


def test_source_version_changes_with_the_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(version, "PACKAGE_DIR", tmp_path)
    (tmp_path / "a.py").write_text("x = 1")
    first = version.source_version()
    assert first == version.source_version()
    (tmp_path / "a.py").write_text("x = 2")
    assert version.source_version() != first


def test_engine_and_worker_use_distinct_executor_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SOSHO_ENGINE_EXECUTOR_ID", raising=False)
    monkeypatch.setenv("SOSHO_ENGINE_API_TOKEN", TOKEN)
    engine = Settings()
    worker = worker_settings()
    assert engine.executor_id == ENGINE_EXECUTOR
    assert worker.executor_id == WORKER_EXECUTOR
    engine_config, worker_config = dbos_config(engine), dbos_config(worker)
    assert engine_config.get("executor_id") != worker_config.get("executor_id")
    assert engine_config.get("application_version") == worker_config.get("application_version")


def test_worker_builds_its_database_url_from_the_postgres_variables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SOSHO_ENGINE_DB_URL", raising=False)
    monkeypatch.setenv("SOSHO_ENGINE_API_TOKEN", TOKEN)
    monkeypatch.setenv("SOSHO_PG_USER", "u")
    monkeypatch.setenv("SOSHO_PG_PASSWORD", "p@ss/w")
    monkeypatch.setenv("SOSHO_POSTGRES_PORT", "5433")
    url = worker_settings().db_url
    assert url == "postgresql://u:p%40ss%2Fw@127.0.0.1:5433/sosho_engine"
