import asyncio
import os
import signal
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from sosho_engine.errors import NodeFailedError
from sosho_engine.pi_events import PiTrace

EVENT_LOG = "events.jsonl"
STDERR_LOG = "stderr.log"
STDERR_TAIL_BYTES = 2000
KILL_WAIT_SECONDS = 5.0
ACTIVE: set["asyncio.subprocess.Process"] = set()


class PiTimeoutError(NodeFailedError):
    pass


class PiCancelledError(NodeFailedError):
    pass


class PiOutputError(NodeFailedError):
    pass


class PiTurnLimitError(NodeFailedError):
    pass


@dataclass(frozen=True)
class PiRun:
    argv: list[str]
    env: dict[str, str]
    cwd: Path
    timeout_seconds: float
    max_turns: int
    stdout_cap_bytes: int
    line_cap_bytes: int
    poll_seconds: float
    cancelled: Callable[[], Awaitable[bool]]


def _signal_group(proc: "asyncio.subprocess.Process", number: int) -> None:
    try:
        os.killpg(proc.pid, number)
    except ProcessLookupError:
        return


async def terminate(proc: "asyncio.subprocess.Process") -> None:
    if proc.returncode is not None:
        return
    _signal_group(proc, signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), KILL_WAIT_SECONDS)
    except TimeoutError:
        _signal_group(proc, signal.SIGKILL)
        await proc.wait()


def terminate_all() -> None:
    for proc in list(ACTIVE):
        if proc.returncode is None:
            _signal_group(proc, signal.SIGKILL)


async def _read(stream: asyncio.StreamReader, run: PiRun, trace: PiTrace) -> None:
    total = 0
    with (run.cwd / EVENT_LOG).open("wb") as events:
        while True:
            try:
                line = await stream.readline()
            except ValueError as error:
                raise PiOutputError("a pi output line is above the size cap") from error
            if not line:
                return
            total += len(line)
            if total > run.stdout_cap_bytes:
                raise PiOutputError(f"pi output is above {run.stdout_cap_bytes} bytes")
            events.write(line)
            if trace.feed(line) == "turn_start" and trace.turns >= run.max_turns:
                raise PiTurnLimitError(f"pi needs more than {run.max_turns} turns")


async def _supervise(reader: "asyncio.Task[None]", run: PiRun) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + run.timeout_seconds
    while True:
        done, _ = await asyncio.wait({reader}, timeout=run.poll_seconds)
        if done:
            reader.result()
            return
        if loop.time() >= deadline:
            raise PiTimeoutError(f"pi ran longer than {run.timeout_seconds} seconds")
        if await run.cancelled():
            raise PiCancelledError("the run was cancelled")


async def _await_exit(proc: "asyncio.subprocess.Process") -> None:
    try:
        await asyncio.wait_for(proc.wait(), KILL_WAIT_SECONDS)
    except TimeoutError as error:
        raise PiTimeoutError("pi did not exit after its output ended") from error


def _tail(path: Path) -> str:
    data = path.read_bytes()[-STDERR_TAIL_BYTES:]
    return data.decode("utf-8", errors="replace").strip()


async def run_pi(run: PiRun) -> PiTrace:
    trace = PiTrace()
    stderr_path = run.cwd / STDERR_LOG
    with stderr_path.open("wb") as errors:
        proc = await asyncio.create_subprocess_exec(
            *run.argv,
            cwd=run.cwd,
            env=run.env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=errors,
            start_new_session=True,
            limit=run.line_cap_bytes,
        )
        ACTIVE.add(proc)
        if proc.stdout is None:
            raise NodeFailedError("pi has no output stream")
        reader = asyncio.create_task(_read(proc.stdout, run, trace))
        try:
            await _supervise(reader, run)
            await _await_exit(proc)
        finally:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
            await terminate(proc)
            ACTIVE.discard(proc)
    if proc.returncode != 0:
        raise NodeFailedError(f"pi exited with code {proc.returncode}: {_tail(stderr_path)}")
    return trace
