#!/usr/bin/env bash
# ==============================================================================
# preview.sh: Serve a creative canvas, Three.js scene, or HTML game locally
# ==============================================================================
set -euo pipefail

TARGET="${1:-index.html}"
PORT="${2:-8000}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$SCRATCH_DIR"

# Find directory to serve
SERVE_DIR="."
FILE_PATH=""
if [ -d "$TARGET" ]; then
    SERVE_DIR="$TARGET"
elif [ -f "$TARGET" ]; then
    SERVE_DIR="$(dirname "$TARGET")"
    FILE_PATH="$(basename "$TARGET")"
fi

# Pick next free port if occupied
while lsof -i:"$PORT" >/dev/null 2>&1; do
    PORT=$(( PORT + 1 ))
done

PID_FILE="${SCRATCH_DIR}/preview_${PORT}.pid"
LOG_FILE="${SCRATCH_DIR}/preview_${PORT}.log"

echo "🎨 Launching local canvas preview on port $PORT..."
(cd "$SERVE_DIR" && python3 -m http.server "$PORT" > "$LOG_FILE" 2>&1) &
PREVIEW_PID=$!
echo "$PREVIEW_PID" > "$PID_FILE"

URL="http://localhost:${PORT}/${FILE_PATH}"
echo "=== [PREVIEW SERVER RUNNING] ==="
echo "• URL: $URL"
echo "• Serving directory: $(cd "$SERVE_DIR" && pwd)"
echo "• PID: $PREVIEW_PID (stop with: .pi/skills/creative-canvas/scripts/kill-preview.sh $PORT)"
echo "============================================================"
