#!/usr/bin/env bash
# ==============================================================================
# dev.sh: Run Next.js, FastAPI, or Presentation deck in background
# ==============================================================================
set -euo pipefail

FRAMEWORK="${1:-static}"
PROJECT_DIR="${2:-.}"
PORT="${3:-}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$SCRATCH_DIR"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ Error: Project directory '$PROJECT_DIR' does not exist." >&2
    exit 1
fi

PROJECT_ABS="$(cd "$PROJECT_DIR" && pwd)"

case "$FRAMEWORK" in
    next|nextjs)
        PORT="${PORT:-3001}"
        LOG_FILE="${SCRATCH_DIR}/next_${PORT}.log"
        PID_FILE="${SCRATCH_DIR}/next_${PORT}.pid"
        echo "🚀 Starting Next.js dev server on port $PORT..."
        (cd "$PROJECT_ABS" && npx next dev -p "$PORT" > "$LOG_FILE" 2>&1) &
        DEV_PID=$!
        echo "$DEV_PID" > "$PID_FILE"
        echo "• URL: http://localhost:$PORT"
        echo "• PID: $DEV_PID (Logs: $LOG_FILE)"
        ;;
    fastapi|api)
        PORT="${PORT:-8001}"
        LOG_FILE="${SCRATCH_DIR}/fastapi_${PORT}.log"
        PID_FILE="${SCRATCH_DIR}/fastapi_${PORT}.pid"
        echo "⚡ Starting FastAPI uvicorn server on port $PORT..."
        (cd "$PROJECT_ABS" && python3 -m uvicorn app:app --host 127.0.0.1 --port "$PORT" --reload > "$LOG_FILE" 2>&1) &
        DEV_PID=$!
        echo "$DEV_PID" > "$PID_FILE"
        echo "• URL: http://127.0.0.1:$PORT (Docs: http://127.0.0.1:$PORT/docs)"
        echo "• PID: $DEV_PID (Logs: $LOG_FILE)"
        ;;
    static|deck|presentation)
        PORT="${PORT:-8005}"
        LOG_FILE="${SCRATCH_DIR}/static_${PORT}.log"
        PID_FILE="${SCRATCH_DIR}/static_${PORT}.pid"
        echo "📑 Serving website presentation on port $PORT..."
        (cd "$PROJECT_ABS" && python3 -m http.server "$PORT" > "$LOG_FILE" 2>&1) &
        DEV_PID=$!
        echo "$DEV_PID" > "$PID_FILE"
        echo "• URL: http://localhost:$PORT"
        echo "• PID: $DEV_PID (Logs: $LOG_FILE)"
        ;;
    *)
        echo "Usage: $0 <next|fastapi|static> <dir> [port]" >&2
        exit 1
        ;;
esac
