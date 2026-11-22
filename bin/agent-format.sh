#!/bin/sh
# Format the one file that an agent edit changed. Run as a PostToolUse hook.
# Input: one tool JSON payload on stdin. Any supported agent payload works.
# Always exit 0. Skip legacy paths, missing tools, and unknown file types.

root=$(cd "$(dirname "$0")/.." && pwd) || exit 0
cd "$root" || exit 0

file=$(python3 -c '
import json, sys
try:
    p = json.load(sys.stdin)
except Exception:
    p = {}
if not isinstance(p, dict):
    p = {}

def first_str(d, keys):
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v:
            return v
    return ""

ti = p
for k in ("tool_input", "toolInput", "input", "args", "arguments"):
    if isinstance(p.get(k), dict):
        ti = p[k]
        break
print(first_str(ti, ("file_path", "filePath", "path", "TargetFile", "target_file", "AbsolutePath")))
' 2>/dev/null)

[ -n "$file" ] && [ -f "$file" ] || exit 0

# Make the path relative to the repository root.
case "$file" in
  "$root"/*) rel=${file#"$root"/} ;;
  /*) exit 0 ;;
  *) rel=$file ;;
esac

# Legacy code lives in legacy/. The rebuild stages remove it from this list.
case "$rel" in
  legacy/* | apps/* | workflows/* | packages/llm/* | packages/memory/* | packages/workflow-engine/* | packages/yue2/* | .pi/* | .agents/skills/* | models/* | skills-lock.json) exit 0 ;;
esac

# Run tools through mise so they work without an activated shell. Skip if mise is missing.
command -v mise >/dev/null 2>&1 || exit 0
run() { mise exec -- "$@" >/dev/null 2>&1; }

case "$rel" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc)
    run pnpm exec biome check --write --no-errors-on-unmatched "$rel"
    ;;
  *.py)
    run uv run ruff format "$rel"
    run uv run ruff check --fix --quiet "$rel"
    ;;
  *.sh)
    run shfmt -i 2 -ci -w "$rel"
    ;;
  *.toml)
    run taplo fmt "$rel"
    ;;
esac

exit 0
