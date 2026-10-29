#!/usr/bin/env bash
# ==============================================================================
# kill-preview.sh: Stop active canvas preview server
# ==============================================================================
set -euo pipefail

PORT="${1:-8000}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
PID_FILE="${SCRATCH_DIR}/preview_${PORT}.pid"

if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null || true
        echo "🛑 Stopped preview server on port $PORT (PID $PID)"
    fi
    rm -f "$PID_FILE"
else
    # Fallback to fuser / lsof
    PID="$(lsof -t -i:"$PORT" 2>/dev/null || true)"
    if [ -n "$PID" ]; then
        kill "$PID" 2>/dev/null || true
        echo "🛑 Stopped process on port $PORT (PID $PID)"
    else
        echo "No preview server running on port $PORT."
    fi
fi
