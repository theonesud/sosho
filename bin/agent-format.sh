#!/bin/sh
# Format the one file that an agent edit changed. Run as a PostToolUse hook.
# Input: hook JSON on stdin. The path is in tool_input.file_path.
# Always exit 0. Skip legacy paths, missing tools, and unknown file types.

root=$(cd "$(dirname "$0")/.." && pwd) || exit 0
cd "$root" || exit 0

file=$(python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
except Exception:
    print("")
' 2>/dev/null)

[ -n "$file" ] && [ -f "$file" ] || exit 0

# Make the path relative to the repository root.
case "$file" in
  "$root"/*) rel=${file#"$root"/} ;;
  /*) exit 0 ;;
  *) rel=$file ;;
esac

# Legacy paths. The rebuild stages remove them from this list.
case "$rel" in
  apps/* | packages/* | yue2/* | workflows/* | tests/* | docker/* | compose.yaml | .pi/* | \
    .agents/skills/* | .impeccable/* | models/* | \
    bin/autotune.sh | bin/doctor.sh | bin/pi-launcher.sh | bin/chunk-read.sh | \
    docs/context/* | skills-lock.json | tsconfig.legacy.json) exit 0 ;;
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
