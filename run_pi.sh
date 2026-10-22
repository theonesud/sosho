#!/bin/bash
set -e

# ==========================================
# Configuration
# ==========================================
IMAGE_NAME="pi-sandbox:latest"
NETWORK_NAME="webui-net"
SERVER_CONTAINER="llama-cpp"
# pi runs on the host network so it can reach services that bind 127.0.0.1 only
# (notably the tldraw desktop agent API on :7236). Your llama.cpp server is
# published on the host, so the container name is no longer needed.
LLAMA_SERVER_URL="${LLAMA_BASE_URL:-http://127.0.0.1:8080}"
# Host paths mounted read-only so the in-container tldraw skill finds its
# server.json (port + bearer token) and its tq helper.
TLDRAW_CONFIG_DIR="${TLDRAW_CONFIG_DIR:-$HOME/.config/tldraw}"
PI_SKILLS_DIR="${PI_SKILLS_DIR:-$HOME/skills}"
WORKSPACE_DIR="$(pwd)"

# --raw: run pi directly on the host instead of inside Docker
RAW_MODE=0
ARGS=()
for arg in "$@"; do
    if [ "$arg" = "--raw" ]; then
        RAW_MODE=1
    else
        ARGS+=("$arg")
    fi
done
set -- "${ARGS[@]}"

# ==========================================
# Shared setup (identical for Docker and --raw)
# ==========================================
# Both modes use the SAME absolute paths and run as the SAME user, so files,
# sessions (keyed by cwd) and memory are interchangeable between them.
REAL_WORKSPACE="$(realpath "$WORKSPACE_DIR")"
REAL_PI_DIR="$(realpath "$WORKSPACE_DIR/.pi")"
REAL_WORKTREES_DIR="$(realpath "$WORKSPACE_DIR/../worktrees" 2>/dev/null || echo "$(dirname "$REAL_WORKSPACE")/worktrees")"
mkdir -p "$REAL_PI_DIR/.cache" "$REAL_PI_DIR/.config" "$REAL_PI_DIR/memory" "$REAL_WORKTREES_DIR"

# Files left behind by the old root-run container must be re-owned once.
if [ -n "$(find "$REAL_PI_DIR" "$REAL_WORKTREES_DIR" ! -user "$(id -u)" -print -quit 2>/dev/null)" ]; then
    echo "Some files in .pi/worktrees are owned by another user (old root container)."
    echo "Fixing ownership (sudo required)..."
    sudo chown -R "$(id -u):$(id -g)" "$REAL_PI_DIR" "$REAL_WORKTREES_DIR"
fi

PI_ENV=(
    "LLAMA_BASE_URL=$LLAMA_SERVER_URL"
    "PI_CODING_AGENT_DIR=$REAL_PI_DIR"
    "PI_MEMORY_DIR=$REAL_PI_DIR/memory"
    "XDG_CACHE_HOME=$REAL_PI_DIR/.cache"
    "XDG_CONFIG_HOME=$REAL_PI_DIR/.config"
    "PI_MEMORY_SNAPSHOT=stable"
    "PI_MEMORY_EXIT_SUMMARY=1"
)

# ==========================================
# Raw mode: run on the host
# ==========================================
if [ "$RAW_MODE" = "1" ]; then
    command -v pi >/dev/null 2>&1 || { echo "Error: 'pi' not found on PATH."; exit 1; }
    echo "Starting Pi agent on host (raw) connected to $LLAMA_SERVER_URL..."
    exec env "${PI_ENV[@]}" pi --approve "$@"
fi

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

ENV_FLAGS=()
for e in "${PI_ENV[@]}"; do ENV_FLAGS+=(-e "$e"); done

# Optional read-only mounts, only if they exist on the host
OPT_MOUNTS=()
[ -d "$TLDRAW_CONFIG_DIR" ] && OPT_MOUNTS+=(-v "$TLDRAW_CONFIG_DIR:$TLDRAW_CONFIG_DIR:ro")
[ -d "$PI_SKILLS_DIR" ] && OPT_MOUNTS+=(-v "$PI_SKILLS_DIR:$PI_SKILLS_DIR:ro")

# Run as the host user with a throwaway, user-owned $HOME. Every mount uses its
# real host path so cwd, session dirs and absolute paths match --raw exactly.
exec docker run "${DOCKER_FLAGS[@]}" --rm \
    --name pi-agent \
    --network host \
    --user "$(id -u):$(id -g)" \
    -e "HOME=$HOME" \
    --tmpfs "$HOME:uid=$(id -u),gid=$(id -g),mode=0755" \
    "${ENV_FLAGS[@]}" \
    -v "$REAL_WORKSPACE:$REAL_WORKSPACE" \
    -v "$REAL_PI_DIR:$REAL_PI_DIR" \
    -v "$REAL_WORKTREES_DIR:$REAL_WORKTREES_DIR" \
    "${OPT_MOUNTS[@]}" \
    -w "$REAL_WORKSPACE" \
    "$IMAGE_NAME" \
    --approve \
    "$@"
