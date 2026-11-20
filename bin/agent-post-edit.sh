#!/usr/bin/env bash
set -euo pipefail

# PostToolUse governance hook: immediately verify agent docs after edits to governance files.
ROOT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT="$(cat || true)"
[ -z "$INPUT" ] && exit 0

SHOULD_CHECK="$(python3 - "$INPUT" <<'PY'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
except Exception:
    print("0")
    sys.exit(0)

tool_input = payload.get("tool_input") or {}
file_path = str(tool_input.get("file_path") or tool_input.get("path") or "")
watched = (
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "opencode.json",
    "APPEND_SYSTEM.md",
    "SYSTEM.md",
    "docs/context/",
    ".claude/settings.json",
)
print("1" if any(w in file_path for w in watched) else "0")
PY
)"

if [ "$SHOULD_CHECK" = "1" ]; then
    "$ROOT_DIR/bin/check-agent-docs.sh"
fi
