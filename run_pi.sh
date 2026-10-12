#!/bin/bash
set -e

# ==========================================
# Configuration
# ==========================================
IMAGE_NAME="pi-sandbox:latest"
NETWORK_NAME="webui-net"
SERVER_CONTAINER="llama-cpp"
LLAMA_SERVER_URL="${LLAMA_BASE_URL:-http://$SERVER_CONTAINER:8080}"
WORKSPACE_DIR="$(pwd)"

# ==========================================
# 1. Ensure Docker Network & llama-server
# ==========================================
docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME"

if docker ps --format '{{.Names}}' | grep -Eq "^${SERVER_CONTAINER}\$"; then
    echo "✓ Detected running $SERVER_CONTAINER on network $NETWORK_NAME."
else
    echo "⚠️  Warning: $SERVER_CONTAINER does not appear to be running."
    echo "   Ensure you have started it with ./start_llama_router.sh"
fi

# ==========================================
# 2. Build Pi Docker Image if needed
# ==========================================
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Pi Docker image ($IMAGE_NAME) not found. Building from Dockerfile.pi..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.pi" "$SCRIPT_DIR"
fi

# ==========================================
# 3. Run Pi Container
# ==========================================
echo "Starting Pi agent container connected to $LLAMA_SERVER_URL..."

# -t and -i only if stdin is an interactive terminal
DOCKER_FLAGS=()
if [ -t 0 ] && [ -t 1 ]; then
    DOCKER_FLAGS+=("-it")
fi

# Resolve physical directories (handles symlinks as well as normal folders)
REAL_WORKSPACE="$(realpath "$WORKSPACE_DIR")"
REAL_PI_DIR="$(realpath "$WORKSPACE_DIR/.pi")"
mkdir -p "$REAL_PI_DIR/.cache" "$REAL_PI_DIR/.config" "$REAL_PI_DIR/memory"

exec docker run "${DOCKER_FLAGS[@]}" --rm \
    --name pi-agent \
    --network "$NETWORK_NAME" \
    -e "LLAMA_BASE_URL=$LLAMA_SERVER_URL" \
    -e "PI_MEMORY_DIR=/root/.pi/agent/memory" \
    -e "XDG_CACHE_HOME=/root/.pi/agent/.cache" \
    -e "XDG_CONFIG_HOME=/root/.pi/agent/.config" \
    -e "PI_MEMORY_SNAPSHOT=stable" \
    -e "PI_MEMORY_EXIT_SUMMARY=1" \
    -v "$REAL_WORKSPACE:/workspace" \
    -v "$REAL_PI_DIR:/root/.pi/agent" \
    "$IMAGE_NAME" \
    --approve \
    "$@"
