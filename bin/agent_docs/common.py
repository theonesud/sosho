import glob
import json
import os
import re
import subprocess
from collections.abc import Iterator
from typing import TypeGuard

type Obj = dict[str, object]

fails: list[str] = []
notes: list[str] = []

STD = ["code", "typescript", "python", "testing", "git"]
ADAPTERS = {
    ".pi/extensions/guard/src/index.ts": "pi",
    ".opencode/plugins/guard.ts": "OpenCode",
    "bin/agent-hook-antigravity.sh": "Antigravity",
}
REQUIRED = [
    "AGENTS.md",
    ".claude/CLAUDE.md",
    ".claude/settings.json",
    "opencode.json",
    ".mcp.json",
    ".pi/settings.json",
    ".pi/mcp.json",
    ".pi/models.json",
    ".pi/model-roles.json",
    ".agents/hooks.json",
    ".agents/mcp_config.json",
    "bin/agent-guard.py",
    "bin/agent-post-edit.sh",
    "bin/agent-format.sh",
    *ADAPTERS,
    *[f"docs/standards/{n}.md" for n in STD],
]
JSON_FILES = [f for f in REQUIRED if f.endswith(".json")]
SCRIPTS = ["agent-guard.py", "agent-post-edit.sh", "agent-format.sh"]
MODEL_CONFIGS = [".pi/models.json", ".pi/model-roles.json"]
LEGACY_TERMS = ["legacy/", "docs/context", "REFACTOR_PLAN.md", "PRODUCT.md", "DESIGN.md"]
GUARD_CASES: list[tuple[Obj, int]] = [
    ({"tool_name": "Edit", "tool_input": {"file_path": ".env", "new_string": "x"}}, 2),
    ({"tool_name": "Read", "tool_input": {"file_path": ".env"}}, 2),
    ({"tool_name": "Read", "tool_input": {"file_path": ".pi/models.json"}}, 0),
    ({"toolName": "write", "input": {"path": ".pi/model-roles.json", "content": "x"}}, 2),
    ({"tool": "bash", "args": {"command": "cat " + ".env"}}, 2),
    ({"tool_name": "Edit", "tool_input": {"file_path": "README.md", "new_string": "x"}}, 0),
]
RULE_FILES = sorted(glob.glob(".claude/rules/*.md")) + sorted(glob.glob(".agents/rules/*.md"))


def fail(msg: str) -> None:
    fails.append("FAIL: " + msg)


def read(path: str) -> str:
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


def is_obj(value: object) -> TypeGuard[Obj]:
    return isinstance(value, dict)


def is_list(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


def as_obj(value: object) -> Obj:
    return value if is_obj(value) else {}


def as_list(value: object) -> list[object]:
    return value if is_list(value) else []


def jload(path: str) -> Obj:
    try:
        return as_obj(json.loads(read(path)))
    except (OSError, ValueError):
        return {}


def walk(node: object, path: tuple[str, ...] = ()) -> Iterator[tuple[tuple[str, ...], object]]:
    if is_obj(node):
        for key, value in node.items():
            yield from walk(value, (*path, key))
    elif is_list(node):
        for value in node:
            yield from walk(value, path)
    else:
        yield path, node


def expand(pattern: str) -> list[str]:
    m = re.search(r"\{([^{}]*)\}", pattern)
    if not m:
        return [pattern]
    return [
        x
        for alt in m.group(1).split(",")
        for x in expand(pattern[: m.start()] + alt + pattern[m.end() :])
    ]


def ignored_by_git(paths: list[str]) -> set[str]:
    if not paths:
        return set()
    try:
        result = subprocess.run(
            ["git", "check-ignore", "--stdin", "-z"],  # noqa: S607
            input="\0".join(paths),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return set()
    if result.returncode not in (0, 1):
        return set()
    return {p for p in result.stdout.split("\0") if p}


def files_under(directory: str) -> list[str]:
    if not os.path.isdir(directory):
        return []
    found = [os.path.join(r, n) for r, _, names in os.walk(directory) for n in names]
    ignored = ignored_by_git(found)
    return [f for f in found if f not in ignored]
