import json
import time
from pathlib import Path

from dbos import DBOS
from engine_support import Api, dig, publish, run_to_end, start, wait_terminal
from flows import Spec, draft, edge, trigger, unique
from pydantic import JsonValue
from worker_support import WorkerEnv, WorkerHandle, process_alive, wait_for

INVOKED = "invocation.json"


def agent(prompt: str, **extra: JsonValue) -> Spec:
    return {"id": "n", "kind": "agent", "role": "main", "prompt": prompt, **extra}


def skill(task: str, name: str = "alpha", **extra: JsonValue) -> Spec:
    return {"id": "n", "kind": "skill", "skill": name, "task": task, "role": "subagent", **extra}


def run_node(api: Api, node: Spec, run_input: dict[str, JsonValue] | None = None) -> JsonValue:
    wid = unique("host")
    publish(api, draft([trigger(), node], [edge("start", "n")]), wid)
    return run_to_end(api, wid, run_input)


def output_of(detail: JsonValue) -> JsonValue:
    return dig(detail, "output", "output", "n")


def invocation(detail: JsonValue) -> dict[str, JsonValue]:
    path = Path(str(dig(output_of(detail), "workdir"))) / INVOKED
    loaded: dict[str, JsonValue] = json.loads(path.read_text())
    return loaded


def wait_dead(pid: int, attempts: int = 100) -> bool:
    for _ in range(attempts):
        if not process_alive(pid):
            return True
        time.sleep(0.1)
    return False


def test_agent_runs_on_the_host_worker_and_the_engine_runs_the_run(host_api: Api) -> None:
    detail = run_node(host_api, agent("go"))
    run_id = str(dig(detail, "summary", "run_id"))
    rows = {row.workflow_id: row for row in DBOS.list_workflows(workflow_id_prefix=run_id)}
    assert rows[run_id].executor_id == "engine"
    child = rows[f"{run_id}:n:1"]
    assert child.queue_name == "host"
    assert child.executor_id == "host-worker"


def test_enqueued_host_work_waits_while_the_worker_is_down(
    host_api: Api, worker: WorkerHandle, worker_env: WorkerEnv
) -> None:
    worker.stop()
    try:
        wid = unique("down")
        publish(host_api, draft([trigger(), agent("go")], [edge("start", "n")]), wid)
        run_id = start(host_api, wid)
        time.sleep(2.0)
        assert dig(host_api.get(f"/runs/{run_id}").body, "summary", "status") == "running"
    finally:
        worker.start()
    assert wait_terminal(host_api, run_id) == "succeeded"
    assert worker_env.runs.exists()


def test_worker_gets_environment_and_arguments_for_pi(host_api: Api, worker_env: WorkerEnv) -> None:
    detail = run_node(host_api, agent("go {{input.x}}", instructions="Be brief"), {"x": "now"})
    info = invocation(detail)
    argv = dig(info, "argv")
    assert isinstance(argv, list)
    head = ["--raw", "-p", "--no-session", "--mode", "json", "--provider", "litellm"]
    assert argv[:7] == head
    assert argv[7:9] == ["--model", "main"]
    extensions = [str(item) for item in argv[10:13:2]]
    assert [Path(item).parts[-3] for item in extensions] == ["guard", "langfuse"]
    assert argv[9:12:2] == ["-e", "-e"]
    assert argv[13:15] == ["--append-system-prompt", "Be brief"]
    assert argv[-1] == "go now"
    assert dig(info, "env", "PI_SKIP_WARMUP") == "1"
    assert dig(info, "env", "SOSHO_ROOT") is not None
    run_id = str(dig(detail, "summary", "run_id"))
    assert dig(info, "env", "LANGFUSE_PI_PARENT_SESSION_ID") == run_id
    assert len(str(dig(info, "env", "LANGFUSE_PI_PARENT_TRACE_ID"))) == 32
    assert len(str(dig(info, "env", "LANGFUSE_PI_PARENT_SPAN_ID"))) == 16
    assert str(dig(output_of(detail), "workdir")).startswith(str(worker_env.runs.resolve()))


def test_agent_skills_are_linked_into_the_session_directory(
    host_api: Api, worker_env: WorkerEnv
) -> None:
    detail = run_node(host_api, agent("go", skills=["alpha", "beta"]))
    assert dig(output_of(detail), "skills") == ["alpha", "beta"]
    assert dig(invocation(detail), "skills") == ["alpha", "beta"]
    link = Path(str(dig(output_of(detail), "workdir"))) / ".agents" / "skills" / "alpha"
    assert link.is_symlink()
    assert link.resolve() == (worker_env.skills / "alpha").resolve()


def test_skill_node_runs_one_skill_and_reports_it(host_api: Api) -> None:
    detail = run_node(host_api, skill("do {{input.x}}", "beta"), {"x": "it"})
    assert dig(detail, "summary", "status") == "succeeded"
    node = output_of(detail)
    assert dig(node, "skill") == "beta"
    assert dig(node, "text") == "fake done:do it"
    assert dig(invocation(detail), "skills") == ["beta"]
    argv = dig(invocation(detail), "argv")
    assert isinstance(argv, list)
    assert "Use the skill beta for this task." in argv


def test_output_has_usage_and_a_capped_text(host_api: Api) -> None:
    detail = run_node(host_api, agent("big:x"))
    node = output_of(detail)
    assert len(str(dig(node, "text"))) == 20000
    assert dig(node, "truncated") is True
    assert dig(node, "usage") == {
        "turns": 1,
        "cost": 0.5,
        "input": 10,
        "output": 5,
        "cache_read": 2,
        "reasoning": 1,
        "total_tokens": 15,
    }
    assert isinstance(dig(node, "duration_ms"), int)


def test_model_error_with_exit_zero_fails_the_node(host_api: Api) -> None:
    detail = run_node(host_api, agent("error:x"))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi model error: model failed" in str(dig(detail, "error"))


def test_exit_code_one_fails_the_node_with_the_stderr_text(host_api: Api) -> None:
    detail = run_node(host_api, agent("exit1:x"))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi exited with code 1: Error: Unknown provider" in str(dig(detail, "error"))


def test_output_above_the_cap_fails_the_node(host_api: Api) -> None:
    detail = run_node(host_api, agent("huge:x", timeout_seconds=60))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi output is above" in str(dig(detail, "error"))


def test_turn_limit_stops_a_session_that_needs_more_turns(host_api: Api) -> None:
    detail = run_node(host_api, agent("turns:5", max_turns=2))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi needs more than 2 turns" in str(dig(detail, "error"))


def test_budget_counts_real_turns_and_caps_the_session(host_api: Api) -> None:
    detail = run_node(host_api, agent("turns:3", max_turns=5))
    assert dig(detail, "output", "llm_calls") == 3
    wid = unique("budget")
    publish(
        host_api,
        draft([trigger(), agent("turns:3")], [edge("start", "n")], policy={"max_llm_calls": 2}),
        wid,
    )
    capped = run_to_end(host_api, wid)
    assert dig(capped, "summary", "status") == "failed"
    assert "pi needs more than 2 turns" in str(dig(capped, "error"))


def test_timeout_kills_the_pi_process(host_api: Api, worker_env: WorkerEnv) -> None:
    tag = unique("tmo")
    detail = run_node(host_api, agent(f"sleep:{tag}", timeout_seconds=1))
    assert dig(detail, "summary", "status") == "failed"
    assert "pi ran longer than 1" in str(dig(detail, "error"))
    pid = int((worker_env.state / f"{tag}.pid").read_text())
    assert wait_dead(pid)


def test_cancel_kills_the_pi_process(host_api: Api, worker_env: WorkerEnv) -> None:
    tag = unique("cnl")
    wid = unique("cancel")
    publish(host_api, draft([trigger(), agent(f"sleep:{tag}")], [edge("start", "n")]), wid)
    run_id = start(host_api, wid)
    marker = worker_env.state / f"{tag}.pid"
    assert wait_for(marker)
    pid = int(marker.read_text())
    assert process_alive(pid)
    assert host_api.post(f"/runs/{run_id}/cancel").status == 202
    assert wait_terminal(host_api, run_id) == "cancelled"
    assert wait_dead(pid)


def test_health_shows_a_live_worker_with_the_engine_version(host_api: Api) -> None:
    worker = dig(host_api.send("GET", "/health", headers={}).body, "worker")
    assert worker == {"alive": True, "version": "test", "version_mismatch": False}
