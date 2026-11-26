import time
from itertools import pairwise
from pathlib import Path

from dbos import DBOS
from engine_support import Api, dig, publish, run_to_end, start, wait_terminal
from fault_proxy import fault_proxy
from flows import (
    DIRECT_ROLE,
    LONG,
    MISSING_ROLE,
    PI_ROLE,
    SHORT,
    Spec,
    draft,
    edge,
    llm,
    trigger,
    unique,
)
from pi_support import REPO_ROOT, proxy_root, run_workdir, system_sections, user_text
from pydantic import JsonValue
from worker_support import WorkerEnv, WorkerHandle, wait_pi, worker_with

from tests.conftest import LITELLM_URL

WRITE_TASK = (
    "Use the write tool to create the file note.txt with the text hi. "
    "Then reply with the single word DONE."
)
WRITE_FILE = (
    "Use the write tool to create the file out.txt with the text {{input.x}}. "
    "Then reply with the single word DONE."
)
SAY = "Reply with the single word {{input.x}}"
CAP_BYTES = 12_000
LINE_CAP_BYTES = 1_024


def agent(prompt: str, node_id: str = "n", **extra: JsonValue) -> Spec:
    return {
        "id": node_id,
        "kind": "agent",
        "role": PI_ROLE,
        "prompt": prompt,
        "thinking": "off",
        **extra,
    }


def skill(task: str, name: str = "alpha", node_id: str = "n", **extra: JsonValue) -> Spec:
    return {
        "id": node_id,
        "kind": "skill",
        "skill": name,
        "task": task,
        "role": PI_ROLE,
        "thinking": "off",
        **extra,
    }


def run_node(api: Api, node: Spec, run_input: dict[str, JsonValue] | None = None) -> JsonValue:
    wid = unique("host")
    publish(api, draft([trigger(), node], [edge("start", "n")]), wid)
    return run_to_end(api, wid, run_input)


def workdir_in(detail: JsonValue, node_id: str) -> Path:
    return Path(str(dig(collected(detail, node_id), "workdir")))


def chain(*nodes: Spec, collect: list[str] | None = None, **extra: JsonValue) -> Spec:
    ids = ["start", *[str(node["id"]) for node in nodes]]
    edges: list[JsonValue] = [edge(a, b) for a, b in pairwise(ids)]
    joined: list[JsonValue] = [{"id": "all", "kind": "join"}] if collect else []
    edges += [edge(node_id, "all") for node_id in collect or []]
    return draft([trigger(), *nodes, *joined], edges, **extra)


def run_chain(
    api: Api, *nodes: Spec, collect: list[str] | None = None, **extra: JsonValue
) -> JsonValue:
    wid = unique("chain")
    publish(api, chain(*nodes, collect=collect, **extra), wid)
    return run_to_end(api, wid)


def collected(detail: JsonValue, node_id: str) -> JsonValue:
    return dig(detail, "output", "output", "all", "inputs", node_id)


def child_error(detail: JsonValue, node_id: str) -> str:
    run_id = str(dig(detail, "summary", "run_id"))
    rows = {row.workflow_id: row for row in DBOS.list_workflows(workflow_id_prefix=run_id)}
    return str(rows[f"{run_id}:{node_id}:1"].error)


def turns_of(node: JsonValue) -> int:
    turns = dig(node, "usage", "turns")
    assert isinstance(turns, int)
    return turns


def _fork(api: Api, run_id: str, node: str, occurrence: int) -> int:
    return api.post(f"/runs/{run_id}/fork", {"node_id": node, "occurrence": occurrence}).status


def _check_agent_with_files(detail: JsonValue, worker_env: WorkerEnv) -> None:
    node = collected(detail, "ag1")
    assert dig(node, "role") == PI_ROLE
    assert dig(node, "skills") == []
    assert str(dig(node, "text")).strip()
    assert "DONE" in str(dig(node, "text"))
    assert turns_of(node) >= 2
    calls = dig(node, "tool_calls")
    assert isinstance(calls, list)
    assert {"name": "write", "ok": True} in calls
    assert (workdir_in(detail, "ag1") / "out.txt").read_text().strip() == "work"
    assert str(workdir_in(detail, "ag1")).startswith(str(worker_env.runs.resolve()))


def _check_skill_node(detail: JsonValue) -> None:
    node = collected(detail, "sk")
    assert dig(node, "skill") == "beta"
    assert str(dig(node, "text")).strip()
    workdir = workdir_in(detail, "sk")
    assert sorted(p.name for p in (workdir / ".agents" / "skills").iterdir()) == ["beta"]
    assert "Use the skill beta" not in system_sections(workdir)["addendum"]
    assert user_text(workdir) == (
        "Instructions:\nUse the skill beta for this task.\n\nTask:\nReply with the single word work"
    )


def _check_llm_node(detail: JsonValue, worker_env: WorkerEnv) -> None:
    output = collected(detail, "lm")
    assert isinstance(output, dict)
    assert set(output) == {"text", "role"}
    assert output["role"] == PI_ROLE
    assert str(output["text"]).strip()
    workdir = run_workdir(worker_env.runs, detail, "lm")
    assert workdir.is_dir()
    assert user_text(workdir) == (
        "Instructions:\nBe brief MARKER7\n\nTask:\nReply with the single word work"
    )
    sections = system_sections(workdir)
    assert "MARKER7" not in sections["addendum"]
    assert "(none)" in sections["tools"]
    assert "skills" not in sections


def _check_agent_with_skills(detail: JsonValue, worker_env: WorkerEnv) -> None:
    node = collected(detail, "ag2")
    assert dig(node, "skills") == ["alpha", "beta"]
    workdir = workdir_in(detail, "ag2")
    assert str(workdir).startswith(str(worker_env.runs.resolve()))
    assert user_text(workdir) == (
        "Instructions:\nBe brief MARKER42\n\nTask:\nReply with the single word work"
    )
    sections = system_sections(workdir)
    assert "MARKER42" not in sections["addendum"]
    link = workdir / ".agents" / "skills" / "alpha"
    assert link.is_symlink()
    assert link.resolve() == (worker_env.skills / "alpha").resolve()
    assert "alpha" in sections["skills"]
    assert "beta" in sections["skills"]
    usage = dig(node, "usage")
    assert isinstance(usage, dict)
    assert int(str(usage["turns"])) == 1
    assert int(str(usage["input"])) > 0
    assert int(str(usage["output"])) > 0
    assert int(str(usage["total_tokens"])) > 0
    assert isinstance(dig(node, "duration_ms"), int)
    assert dig(node, "truncated") is False


def test_host_nodes_run_on_the_host_worker_while_the_engine_runs_the_run(
    live_host_api: Api, worker: WorkerHandle, worker_env: WorkerEnv
) -> None:
    api = live_host_api
    nodes = [
        agent(WRITE_FILE, "ag1"),
        skill(SAY, "beta", "sk"),
        llm("lm", SAY, role=PI_ROLE, thinking="off", system="Be brief MARKER7"),
        agent(SAY, "ag2", skills=["alpha", "beta"], instructions="Be brief MARKER42"),
    ]
    wid = unique("host")
    publish(api, chain(*nodes, collect=[str(n["id"]) for n in nodes]), wid)
    worker.stop()
    try:
        run_id = start(api, wid, {"x": "work"})
        time.sleep(2.0)
        assert dig(api.get(f"/runs/{run_id}").body, "summary", "status") == "running"
    finally:
        worker.start()
    assert wait_terminal(api, run_id) == "succeeded"
    assert worker_env.runs.exists()
    detail = api.get(f"/runs/{run_id}").body
    rows = {row.workflow_id: row for row in DBOS.list_workflows(workflow_id_prefix=run_id)}
    assert rows[run_id].executor_id == "engine"
    for node_id in ("ag1", "sk", "lm", "ag2"):
        child = rows[f"{run_id}:{node_id}:1"]
        assert child.queue_name == "host"
        assert child.executor_id == "host-worker"
    _check_agent_with_files(detail, worker_env)
    _check_skill_node(detail)
    _check_llm_node(detail, worker_env)
    _check_agent_with_skills(detail, worker_env)
    expected = turns_of(collected(detail, "ag1")) + turns_of(collected(detail, "sk")) + 1
    assert dig(detail, "output", "llm_calls") == expected + turns_of(collected(detail, "ag2"))
    assert _fork(api, run_id, "ag2", 2) == 404
    forked = api.post(f"/runs/{run_id}/fork", {"node_id": "ag2", "occurrence": 1})
    assert forked.status == 202
    assert wait_terminal(api, str(dig(forked.body, "run_id"))) == "succeeded"


def _proxy_extra(tmp_path: Path, proxy_url: str) -> dict[str, str]:
    root = proxy_root(tmp_path / "root", f"{proxy_url}/v1")
    launcher = REPO_ROOT / "bin" / "pi-launcher.sh"
    return {"SOSHO_ENGINE_REPO_ROOT": str(root), "SOSHO_ENGINE_PI_COMMAND": str(launcher)}


def test_model_errors_and_exit_code_fail_the_node(
    live_host_api: Api, worker: WorkerHandle, tmp_path: Path
) -> None:
    with (
        fault_proxy(LITELLM_URL, fail_first=1) as proxy,
        worker_with(worker, _proxy_extra(tmp_path, proxy.url)),
    ):
        detail = run_node(live_host_api, agent(SHORT))
        assert dig(detail, "summary", "status") == "failed"
        assert "pi model error: " in str(dig(detail, "error"))
        assert proxy.requests == 1
        detail = run_node(live_host_api, llm("n", SHORT, role=MISSING_ROLE))
        assert dig(detail, "summary", "status") == "failed"
        assert "pi model error: " in str(dig(detail, "error"))
        assert MISSING_ROLE in str(dig(detail, "error"))
    with worker_with(worker, {"PI_VERSION": "0.0.1-no-such-version"}):
        detail = run_node(live_host_api, agent(SHORT))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi exited with code 1: " in str(dig(detail, "error"))
    assert len(str(dig(detail, "error"))) > len("pi exited with code 1: ") + 10


def test_limits_stop_the_node_and_count_calls_on_both_paths(
    live_host_api: Api, worker: WorkerHandle
) -> None:
    capped = run_chain(
        live_host_api,
        agent(WRITE_TASK, "cap", max_turns=1, continue_on_error=True),
        agent(WRITE_TASK, "bud"),
        policy={"max_llm_calls": 2},
    )
    assert dig(capped, "summary", "status") == "failed"
    assert "pi needs more than 1 turns" in child_error(capped, "cap")
    assert "pi needs more than 1 turns" in str(dig(capped, "error"))
    counted = run_chain(
        live_host_api,
        llm("d1", SHORT, role=DIRECT_ROLE),
        llm("p1", SHORT, role=PI_ROLE, thinking="off"),
        llm("d2", SHORT, role=DIRECT_ROLE),
        llm("d3", SHORT, role=DIRECT_ROLE, continue_on_error=True),
        llm("p2", SHORT, role=PI_ROLE, thinking="off", continue_on_error=True),
        collect=["d3", "p2"],
        policy={"max_llm_calls": 3},
    )
    assert dig(counted, "summary", "status") == "succeeded"
    assert dig(counted, "output", "llm_calls") == 3
    assert "budget" in str(dig(collected(counted, "d3"), "error"))
    assert "budget" in str(dig(collected(counted, "p2"), "error"))
    caps = {
        "SOSHO_ENGINE_PI_STDOUT_CAP_BYTES": str(CAP_BYTES),
        "SOSHO_ENGINE_PI_LINE_CAP_BYTES": str(CAP_BYTES * 100),
    }
    with worker_with(worker, caps):
        over = run_node(live_host_api, agent(LONG, timeout_seconds=600))
    assert dig(over, "summary", "status") == "failed"
    assert str(dig(over, "error")) == f"node n failed: pi output is above {CAP_BYTES} bytes"
    with worker_with(worker, {"SOSHO_ENGINE_PI_LINE_CAP_BYTES": str(LINE_CAP_BYTES)}):
        wide = run_node(live_host_api, agent(LONG, timeout_seconds=600))
    assert dig(wide, "summary", "status") == "failed"
    assert str(dig(wide, "error")) == "node n failed: a pi output line is above the size cap"


def test_timeout_kills_the_pi_process(live_host_api: Api) -> None:
    tag = unique("tmo-")
    detail = run_node(live_host_api, agent(f"{LONG} {tag}", timeout_seconds=1))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi ran longer than 1" in str(dig(detail, "error"))
    assert wait_pi(tag, running=False)


def test_cancel_kills_the_pi_process(live_host_api: Api) -> None:
    tag = unique("cnl-")
    wid = unique("cancel")
    publish(live_host_api, draft([trigger(), agent(f"{LONG} {tag}")], [edge("start", "n")]), wid)
    run_id = start(live_host_api, wid)
    assert wait_pi(tag, running=True)
    assert live_host_api.post(f"/runs/{run_id}/cancel").status == 202
    assert wait_terminal(live_host_api, run_id) == "cancelled"
    assert wait_pi(tag, running=False)


def test_agent_retry_runs_the_agent_again_after_a_model_failure(
    live_host_api: Api, worker: WorkerHandle, tmp_path: Path
) -> None:
    node = agent(SHORT, max_turns=3, retry={"max_attempts": 2, "interval_seconds": 0})
    with (
        fault_proxy(LITELLM_URL, fail_first=1) as proxy,
        worker_with(worker, _proxy_extra(tmp_path, proxy.url)),
    ):
        detail = run_node(live_host_api, node)
    assert dig(detail, "summary", "status") == "succeeded"
    assert proxy.failed == 1
    assert proxy.requests == 2
    assert dig(detail, "output", "llm_calls") == 4


def test_health_shows_a_live_worker_with_the_engine_version(host_api: Api) -> None:
    worker = dig(host_api.send("GET", "/health", headers={}).body, "worker")
    assert worker == {"alive": True, "version": "test", "version_mismatch": False}
