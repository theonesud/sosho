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

# 2b. Auto-install and configure Graphify locally for Pi
GRAPHIFY_VENV="$TARGET_PI/venv-graphify"
if [ ! -x "$GRAPHIFY_VENV/bin/python" ]; then
    echo "Initializing Graphify local environment in $GRAPHIFY_VENV..."
    python3 -m venv "$GRAPHIFY_VENV"
    "$GRAPHIFY_VENV/bin/pip" install -q -U pip
    "$GRAPHIFY_VENV/bin/pip" install -q "graphifyy[mcp]"
fi

# Ensure graphify skill is copied to workspace .pi/skills
if [ ! -d "$TARGET_PI/skills/graphify" ] && [ -d "$SOSHO_PI/skills/graphify" ]; then
    mkdir -p "$TARGET_PI/skills"
    cp -r "$SOSHO_PI/skills/graphify" "$TARGET_PI/skills/"
fi

# Ensure .pi/mcp.json has local graphify server registered
if [ ! -f "$TARGET_PI/mcp.json" ] || ! grep -q '"graphify"' "$TARGET_PI/mcp.json" 2>/dev/null; then
    python3 - "$TARGET_PI/mcp.json" "$WORKSPACE" <<'PY'
import json, sys, os
mcp_path, ws = sys.argv[1], sys.argv[2]
data = {"mcpServers": {}}
if os.path.exists(mcp_path):
    try:
        with open(mcp_path) as f:
            data = json.load(f)
    except Exception:
        pass
servers = data.setdefault("mcpServers", {})
servers["graphify"] = {
    "command": f"{ws}/.pi/venv-graphify/bin/python",
    "args": [
        "-m",
        "graphify.serve",
        f"{ws}/graphify-out/graph.json"
    ]
}
with open(mcp_path, "w") as f:
    json.dump(data, f, indent=2)
PY
fi

# Ensure graphify-out/graph.json exists for the workspace (index codebase if missing)
if [ ! -f "$WORKSPACE/graphify-out/graph.json" ] && [ -x "$GRAPHIFY_VENV/bin/python" ]; then
    echo "Generating initial codebase knowledge graph with Graphify..."
    "$GRAPHIFY_VENV/bin/python" -m graphify extract "$WORKSPACE" --code-only --no-cluster >/dev/null 2>&1 || true
fi

# 3. Pre-warm the local model (if configured). llama.cpp loads the GGUF lazily and,
#    when the model does not fully fit in RAM, the very first prompt is served from
#    disk and can take many minutes. Absorb that cost here so pi's first turn is fast.
if [ -f "$TARGET_PI/models.json" ] && command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    read -r BASE_URL MODEL_ID < <(python3 - "$TARGET_PI/models.json" <<'PY' 2>/dev/null
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
    p = next(iter(cfg.get("providers", {}).values()), {})
    print(p.get("baseUrl", "").rstrip("/"), (p.get("models") or [{}])[0].get("id", ""))
except Exception:
    print("")
PY
)
    case "$BASE_URL" in
        http://127.0.0.1:*|http://localhost:*|http://0.0.0.0:*)
            if [ -n "$MODEL_ID" ]; then
                echo "Pre-warming local model $MODEL_ID (first load can take a few minutes)..."
                WARM_PAYLOAD="$(python3 - "$MODEL_ID" <<'PY'
import json, sys
print(json.dumps({
    "model": sys.argv[1],
    "messages": [{"role": "user", "content": ("The quick brown fox jumps over the lazy dog. " * 300) + "\nReply with OK."}],
    "max_tokens": 1,
    "temperature": 0,
}))
PY
)"
                if curl -s -m 900 -o /dev/null -H 'Content-Type: application/json' \
                    -X POST "$BASE_URL/chat/completions" --data-binary "$WARM_PAYLOAD"; then
                    echo "Model ready."
                else
                    echo "Warning: model warm-up failed (is llama-cpp running?); continuing anyway."
                fi
            fi
            ;;
    esac
fi

# 4. Mount list
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

# 5. Run Pi container attached to current working directory
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
