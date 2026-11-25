import asyncio
import hashlib
import os
import threading
import time

from dbos import DBOS
from pydantic import JsonValue

from sosho_engine import runtime
from sosho_engine.errors import NodeFailedError, PolicyError, RunLimitError
from sosho_engine.executors import attempt_number
from sosho_engine.jobs import NodeJob, NodeResult
from sosho_engine.launch import outside_workflow
from sosho_engine.pi_events import PiTrace
from sosho_engine.pi_process import PiRun, run_pi
from sosho_engine.settings import Settings
from sosho_engine.spec_nodes import AgentNode, SkillNode
from sosho_engine.templating import render_template
from sosho_engine.tools import JsonDict
from sosho_engine.workdir import prepare_workdir, workdir_for

MAX_TEXT_CHARS = 20_000
GPU_GATE = threading.Semaphore(1)
GATE_POLL_SECONDS = 0.2
CANCELLED = "CANCELLED"


def trace_env(run_id: str, node_id: str) -> dict[str, str]:
    return {
        "LANGFUSE_PI_PARENT_TRACE_ID": hashlib.sha256(run_id.encode()).hexdigest()[:32],
        "LANGFUSE_PI_PARENT_SPAN_ID": hashlib.sha256(f"{run_id}:{node_id}".encode()).hexdigest()[
            :16
        ],
        "LANGFUSE_PI_PARENT_SESSION_ID": run_id,
    }


def check_skills_allowed(names: list[str], allowed: list[str] | None) -> None:
    for name in names:
        if allowed is not None and name not in allowed:
            raise PolicyError(f"policy denies skill {name}")


def node_skills(node: AgentNode | SkillNode) -> list[str]:
    return [node.skill] if isinstance(node, SkillNode) else list(node.skills)


def safe_prompt(prompt: str) -> str:
    return f" {prompt}" if prompt.startswith(("-", "@")) else prompt


def build_argv(settings: Settings, node: AgentNode | SkillNode, job: NodeJob) -> list[str]:
    argv = [settings.pi_path(), "--raw", "-p", "--no-session", "--mode", "json"]
    argv += ["--provider", "litellm", "--model", node.role]
    for extension in settings.pi_extension_paths():
        argv += ["-e", str(extension)]
    if isinstance(node, SkillNode):
        argv += ["--append-system-prompt", f"Use the skill {node.skill} for this task."]
        prompt = render_template(node.task, job.data)
    else:
        if node.instructions:
            argv += ["--append-system-prompt", render_template(node.instructions, job.data)]
        prompt = render_template(node.prompt, job.data)
    return [*argv, safe_prompt(prompt)]


def build_env(settings: Settings, job: NodeJob) -> dict[str, str]:
    env = dict(os.environ)
    env["PI_SKIP_WARMUP"] = "1"
    env["SOSHO_ROOT"] = str(settings.repo_root)
    env.update(trace_env(job.run_id, job.node.id))
    return env


def build_output(
    trace: PiTrace, node: AgentNode | SkillNode, started: float, workdir: str
) -> JsonDict:
    text = trace.text or ""
    usage: dict[str, JsonValue] = {"turns": trace.turns, "cost": trace.cost}
    usage.update(trace.tokens)
    output: JsonDict = {
        "text": text[:MAX_TEXT_CHARS],
        "truncated": len(text) > MAX_TEXT_CHARS,
        "role": node.role,
        "usage": usage,
        "tool_calls": list(trace.tool_calls),
        "duration_ms": int((time.monotonic() - started) * 1000),
        "workdir": workdir,
    }
    if isinstance(node, SkillNode):
        output["skill"] = node.skill
    else:
        output["skills"] = list(node.skills)
    return output


def check_trace(trace: PiTrace) -> None:
    if not trace.ended:
        raise NodeFailedError("pi ended without an agent_end event")
    if trace.stop_reason == "error":
        raise NodeFailedError(f"pi model error: {trace.error_message or 'unknown'}")


async def _cancelled() -> bool:
    workflow_id = DBOS.workflow_id
    if workflow_id is None:
        return False
    status = await outside_workflow(DBOS.get_workflow_status_async(workflow_id))
    return status is not None and status.status == CANCELLED


async def _hold_gpu(poll_seconds: float) -> None:
    while not GPU_GATE.acquire(blocking=False):
        if await _cancelled():
            raise NodeFailedError("the run was cancelled")
        await asyncio.sleep(max(poll_seconds, GATE_POLL_SECONDS))


def turn_limit(node: AgentNode | SkillNode, job: NodeJob, attempt: int) -> int:
    limit = min(node.max_turns, job.llm_left - (attempt - 1) * node.max_turns)
    if limit < 1:
        raise RunLimitError("the LLM call budget is used")
    return limit


async def _run(
    settings: Settings, node: AgentNode | SkillNode, job: NodeJob, limit: int
) -> NodeResult:
    attempt = attempt_number()
    started = time.monotonic()
    path = workdir_for(settings.runs_dir, job.run_id, node.id)
    skills = node_skills(node)
    prepare_workdir(path, settings.skills_path(), skills)
    request = PiRun(
        argv=build_argv(settings, node, job),
        env=build_env(settings, job),
        cwd=path,
        timeout_seconds=node.timeout_seconds or settings.pi_default_timeout_seconds,
        max_turns=limit,
        stdout_cap_bytes=settings.pi_stdout_cap_bytes,
        poll_seconds=settings.worker_poll_seconds,
        cancelled=_cancelled,
    )
    trace = await run_pi(request)
    check_trace(trace)
    calls = (attempt - 1) * node.max_turns + trace.turns
    return NodeResult(output=build_output(trace, node, started, str(path)), llm_calls=calls)


async def execute_host(job: NodeJob) -> NodeResult:
    node = job.node
    if not isinstance(node, (AgentNode, SkillNode)):
        raise NodeFailedError(f"node {node.id} is not a host node")
    check_skills_allowed(node_skills(node), job.allowed_skills)
    settings = runtime.current().settings
    limit = turn_limit(node, job, attempt_number())
    gated = node.role in settings.gpu_roles
    if gated:
        await _hold_gpu(settings.worker_poll_seconds)
    try:
        return await _run(settings, node, job, limit)
    finally:
        if gated:
            GPU_GATE.release()
