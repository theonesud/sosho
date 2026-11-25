import hashlib
import json
import os
import sys
import time
from pathlib import Path

ENV_KEYS = (
    "PI_SKIP_WARMUP",
    "SOSHO_ROOT",
    "LANGFUSE_PI_PARENT_TRACE_ID",
    "LANGFUSE_PI_PARENT_SPAN_ID",
    "LANGFUSE_PI_PARENT_SESSION_ID",
)
USAGE = {"input": 10, "output": 5, "cacheRead": 2, "reasoning": 1, "totalTokens": 15}


def emit(event: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def assistant(text: str, stop: str = "stop", error: str | None = None) -> dict[str, object]:
    message: dict[str, object] = {
        "role": "assistant",
        "content": [{"type": "text", "text": text}],
        "usage": {**USAGE, "cost": {"total": 0.5}},
        "stopReason": stop,
    }
    if error is not None:
        message["errorMessage"] = error
    return message


def turn(text: str, stop: str = "stop", error: str | None = None) -> None:
    message = assistant(text, stop, error)
    emit({"type": "turn_start"})
    emit({"type": "message_end", "message": message})
    emit({"type": "turn_end", "message": message, "toolResults": []})


def state_count(tag: str) -> int:
    state = Path(os.environ["FAKE_PI_STATE"])
    path = state / hashlib.sha256(tag.encode()).hexdigest()
    count = int(path.read_text()) + 1 if path.exists() else 1
    path.write_text(str(count))
    return count


def record(argv: list[str]) -> None:
    skills_dir = Path(".agents/skills")
    skills = sorted(p.name for p in skills_dir.iterdir()) if skills_dir.is_dir() else []
    info = {"argv": argv, "skills": skills, "env": {k: os.environ.get(k) for k in ENV_KEYS}}
    Path("invocation.json").write_text(json.dumps(info))


def append_prompt(argv: list[str]) -> str:
    index = argv.index("--append-system-prompt") if "--append-system-prompt" in argv else -1
    return argv[index + 1] if index >= 0 else ""


def main() -> int:
    argv = sys.argv[1:]
    prompt = argv[-1].strip()
    record(argv)
    emit({"type": "session", "id": "fake"})
    emit({"type": "agent_start"})
    emit({"type": "message_start", "message": {"role": "system", "content": ""}})
    kind, _, rest = prompt.partition(":")
    if kind == "error":
        turn("", "error", "model failed")
        end = assistant("", "error", "model failed")
    elif kind == "exit1":
        sys.stderr.write("Error: Unknown provider\n")
        return 1
    elif kind == "sleep":
        Path(os.environ["FAKE_PI_STATE"], f"{rest}.pid").write_text(str(os.getpid()))
        time.sleep(60)
        return 0
    elif kind == "huge":
        for _ in range(3000):
            emit({"type": "noise", "pad": "x" * 1000})
        end = assistant("late")
    elif kind == "flaky" and state_count(prompt) < 2:
        sys.stderr.write("flaky failure\n")
        return 1
    elif kind == "big":
        turn("big")
        end = assistant("y" * 30000)
    elif kind == "turns":
        for _ in range(int(rest)):
            turn("more")
        end = assistant("many")
    else:
        sys.stdout.write("not json\n")
        if kind == "tool":
            Path("out.txt").write_text("written")
            emit({"type": "tool_execution_start", "toolName": "write", "args": {}})
            emit({"type": "tool_execution_end", "toolName": "write", "isError": False})
            emit({"type": "tool_execution_end", "toolName": "bash", "isError": True})
            turn("calling")
        turn("ok")
        text = f"instructions:{append_prompt(argv)}" if kind == "ins" else f"fake done:{prompt}"
        end = assistant(text)
    emit({"type": "agent_end", "messages": [{"role": "user", "content": "x"}, end]})
    return 0


sys.exit(main())
