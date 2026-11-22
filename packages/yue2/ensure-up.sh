#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Start the YuE2 music services on demand.
#
# Exit 0: the gateway reports ready.
# Exit 1: the start failed or the timeout passed.
#
# The first start downloads the model. That can take many minutes.
# ==============================================================================

# Resolve the real path, so the script works through the ~/.local/bin symlink.
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SOSHO_ROOT="$(cd -P "$(dirname "$SCRIPT_PATH")/../.." && pwd)"
COMPOSE_FILE="$SOSHO_ROOT/compose.yaml"

GATEWAY_URL="${YUE2_GATEWAY_URL:-http://127.0.0.1:8021}"
START_TIMEOUT="${YUE2_START_TIMEOUT:-900}"
POLL_SECONDS=5
PROGRESS_SECONDS=60
LOG_HINT="docker compose -p sosho logs yue2-model-download yue2-engine yue2-gateway"

# The gateway returns 200 on /health/ready only when the engine is ready.
# /health/live does not check the engine, so it is not used here.
gateway_ready() {
  curl -fsS -m 3 "$GATEWAY_URL/health/ready" >/dev/null 2>&1
}

if gateway_ready; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi

echo "Starting the YuE2 music services. The first start downloads the model."

# The gateway depends on yue2-engine, and yue2-engine depends on
# yue2-model-download. One command starts all three services.
if ! docker compose -p sosho -f "$COMPOSE_FILE" --profile music up -d yue2-gateway; then
  echo "Error: docker compose could not start yue2-gateway." >&2
  exit 1
fi

start_epoch="$(date +%s)"
deadline=$((start_epoch + START_TIMEOUT))
last_progress="$start_epoch"

while :; do
  if gateway_ready; then
    echo "YuE2 gateway is ready at $GATEWAY_URL."
    exit 0
  fi

  now="$(date +%s)"
  if ((now >= deadline)); then
    echo "Error: YuE2 gateway is not ready after ${START_TIMEOUT} s." >&2
    echo "Check the logs with:" >&2
    echo "  $LOG_HINT" >&2
    exit 1
  fi

  if ((now - last_progress >= PROGRESS_SECONDS)); then
    echo "Still waiting for the YuE2 gateway after $((now - start_epoch)) s."
    last_progress="$now"
  fi

  sleep "$POLL_SECONDS"
done
