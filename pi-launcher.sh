#!/usr/bin/env bash
set -e

# ==============================================================================
# Global Pi CLI launcher (Docker-backed)
# ==============================================================================
IMAGE_NAME="pi-sandbox:latest"
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_SOURCE" ]; do
    SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
    SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
    [[ $SCRIPT_SOURCE != /* ]] && SCRIPT_SOURCE="$SCRIPT_DIR/$SCRIPT_SOURCE"
done
SOSHO_ROOT="${SOSHO_ROOT:-$(cd -P "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd)}"
[ ! -d "$SOSHO_ROOT/.pi" ] && SOSHO_ROOT="/home/vegeta/sosho"
SOSHO_PI="$SOSHO_ROOT/.pi"
# 0. Ensure Docker image exists; build if missing
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Image $IMAGE_NAME not found locally. Building from $SOSHO_ROOT..."
    docker build -t "$IMAGE_NAME" -f "$SOSHO_ROOT/Dockerfile.pi" "$SOSHO_ROOT"
fi

WORKSPACE="$(pwd)"

# 1. Ensure target workspace has a local .pi directory for caching/config
TARGET_PI="$WORKSPACE/.pi"
mkdir -p "$TARGET_PI/.cache" "$TARGET_PI/.config"

# 2. If target workspace does NOT have its own models.json, provide the default
#    pointing to local llama.cpp from sosho without mutating online configs if present.
if [ ! -f "$TARGET_PI/models.json" ] && [ -f "$SOSHO_PI/models.json" ]; then
    cp "$SOSHO_PI/models.json" "$TARGET_PI/models.json"
fi

# 3. Mount list
MOUNTS=(
    -v "$WORKSPACE:$WORKSPACE"
    -v "$TARGET_PI:$TARGET_PI"
)

# Optional worktrees dir
WORKTREES_DIR="$(realpath "$WORKSPACE/../worktrees" 2>/dev/null || echo "$(dirname "$WORKSPACE")/worktrees")"
mkdir -p "$WORKTREES_DIR" 2>/dev/null || true
[ -d "$WORKTREES_DIR" ] && MOUNTS+=(-v "$WORKTREES_DIR:$WORKTREES_DIR")

# Mount Dokobot & Skills if they exist
[ -d "$HOME/.dokobot" ] && MOUNTS+=(-v "$HOME/.dokobot:$HOME/.dokobot")
[ -d "$HOME/skills" ] && MOUNTS+=(-v "$HOME/skills:$HOME/skills:ro")

# Pass any API keys from local .env if present in workspace (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY)
ENV_ARGS=()
if [ -f "$WORKSPACE/.env" ]; then
    ENV_ARGS+=(--env-file "$WORKSPACE/.env")
fi

# TTY flags
DOCKER_INTERACTIVE_FLAGS=()
if [ -t 0 ] && [ -t 1 ]; then
    DOCKER_INTERACTIVE_FLAGS+=("-it")
fi

# 4. Run Pi container attached to current working directory
exec docker run "${DOCKER_INTERACTIVE_FLAGS[@]}" --rm \
    --network host \
    --pid host \
    --user "$(id -u):$(id -g)" \
    -e "HOME=$HOME" \
    -e "LLAMA_BASE_URL=http://127.0.0.1:8080" \
    -e "PI_CODING_AGENT_DIR=$TARGET_PI" \
    -e "XDG_CACHE_HOME=$TARGET_PI/.cache" \
    -e "XDG_CONFIG_HOME=$TARGET_PI/.config" \
    -e "LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-http://127.0.0.1:3000}" \
    -e "LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-pk-lf-local-pi}" \
    -e "LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-sk-lf-local-pi}" \
    --tmpfs "$HOME:uid=$(id -u),gid=$(id -g),mode=0755" \
    "${ENV_ARGS[@]}" \
    "${MOUNTS[@]}" \
    -w "$WORKSPACE" \
    "$IMAGE_NAME" \
    --approve \
    "$@"
