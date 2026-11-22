#!/bin/sh
# Antigravity hook adapter. Usage: agent-hook-antigravity.sh pre|post
# Input: hook JSON on stdin with toolCall.name and toolCall.args.
# pre: run the shared guard. On a block, print a deny JSON object on stdout.
# post: run the shared post-edit steps and print nothing.
# Always exit 0. Assumes Antigravity runs hooks from the workspace root.

root=$(cd "$(dirname "$0")/.." && pwd) || exit 0
mode=${1:-}
input=$(cat || true)

# Convert the Antigravity payload to the shared payload shape.
mapped=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    p = json.load(sys.stdin)
except Exception:
    p = {}
tc = p.get("toolCall") if isinstance(p, dict) else None
if isinstance(tc, dict):
    p = {"tool_name": tc.get("name", ""), "tool_input": tc.get("args") or {}}
print(json.dumps(p))
' 2>/dev/null)

case "$mode" in
  pre)
    err=$(printf '%s' "$mapped" | "$root/bin/agent-guard.sh" 2>&1 >/dev/null)
    if [ $? -eq 2 ]; then
      printf '%s' "$err" | python3 -c '
import json, sys
print(json.dumps({"decision": "deny", "reason": sys.stdin.read().strip()}))
'
    fi
    ;;
  post)
    printf '%s' "$mapped" | "$root/bin/agent-post-edit.sh" >/dev/null 2>&1
    printf '%s' "$mapped" | "$root/bin/agent-format.sh" >/dev/null 2>&1
    ;;
esac

exit 0
