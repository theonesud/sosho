#!/usr/bin/env bash
set -euo pipefail

# PreToolUse governance hook: block unsafe edits to secret files or forbidden Docker socket mounts.
INPUT="$(cat || true)"
[ -z "$INPUT" ] && exit 0

python3 - "$INPUT" <<'PY'
import json
import os
import sys

try:
    payload = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

tool_input = payload.get("tool_input") or {}
file_path = str(tool_input.get("file_path") or tool_input.get("path") or "")
content = str(tool_input.get("content") or tool_input.get("new_string") or tool_input.get("replacement") or "")

base = os.path.basename(file_path)
if base == ".env" or base.endswith((".pem", ".key")):
    print(f"BLOCKED by governance hook: direct edit to protected secret file '{file_path}' is disallowed.", file=sys.stderr)
    sys.exit(2)

if base in ("compose.yaml", "compose.langfuse.yaml") and "/var/run/docker.sock" in content:
    print("BLOCKED by governance hook: mounting /var/run/docker.sock is forbidden by ADR-004.", file=sys.stderr)
    sys.exit(2)

sys.exit(0)
PY
