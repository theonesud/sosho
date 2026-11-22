#!/usr/bin/env bash
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INPUT="$(cat || true)"
[ -z "$INPUT" ] && exit 0

FILE="$(printf '%s' "$INPUT" | python3 -c '
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
')"
REL="${FILE#"$ROOT"/}"
REL="${REL#./}"

case "$REL" in
  AGENTS.md | .claude/* | .agents/rules/* | .agents/hooks.json | .agents/mcp_config.json | .mcp.json | .opencode/* | opencode.json | .pi/*.md | .pi/settings.json | .pi/mcp.json | bin/agent-* | bin/check-agent-docs.sh)
    "$ROOT/bin/check-agent-docs.sh"
    ;;
esac
