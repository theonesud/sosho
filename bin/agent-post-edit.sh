#!/usr/bin/env bash
# PostToolUse hook: run the agent-file check after an edit to a watched path.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INPUT="$(cat || true)"
[ -z "$INPUT" ] && exit 0

FILE="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    ti = json.load(sys.stdin).get("tool_input") or {}
except Exception:
    ti = {}
print(ti.get("file_path") or ti.get("path") or "")
')"
REL="${FILE#"$ROOT"/}"

case "$REL" in
  AGENTS.md|.claude/*|opencode.json|bin/agent-guard.sh|bin/check-agent-docs.sh|docs/context/*)
    "$ROOT/bin/check-agent-docs.sh" ;;
esac
