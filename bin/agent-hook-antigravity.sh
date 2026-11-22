#!/bin/sh

root=$(cd "$(dirname "$0")/.." && pwd) || exit 0
mode=${1:-}
input=$(cat || true)

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
