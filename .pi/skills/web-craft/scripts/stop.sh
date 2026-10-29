#!/usr/bin/env bash
# ==============================================================================
# stop.sh: Stop background dev server by port
# ==============================================================================
set -euo pipefail

PORT="${1:-}"
if [ -z "$PORT" ]; then
    echo "Usage: $0 <port>" >&2
    exit 1
fi

PID="$(lsof -t -i:"$PORT" 2>/dev/null || true)"
if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    echo "🛑 Stopped server on port $PORT (PID $PID)"
else
    echo "No server running on port $PORT."
fi
