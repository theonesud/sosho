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
RESOLVED_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd)"
SOSHO_ROOT="${SOSHO_ROOT:-$RESOLVED_DIR}"
[ ! -d "$SOSHO_ROOT/.pi" ] && SOSHO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo "$HOME/sosho")"
SOSHO_PI="$SOSHO_ROOT/.pi"

# Filter out our custom launcher flags from arguments
FORWARD_ARGS=()
SKIP_WARMUP="${PI_SKIP_WARMUP:-0}"
for arg in "$@"; do
    case "$arg" in
        --no-warmup)
            SKIP_WARMUP=1
            ;;
        *)
            FORWARD_ARGS+=("$arg")
            ;;
    esac
done

# 0. Ensure Docker image exists; build if missing
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Image $IMAGE_NAME not found locally. Building from $SOSHO_ROOT..."
    docker build -t "$IMAGE_NAME" -f "$SOSHO_ROOT/docker/Dockerfile.pi" "$SOSHO_ROOT"
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

# 2b. Centralize Graphify venv in user-level cache (~/.local/share/sosho/venv-graphify)
#     Avoids re-downloading and duplicating ~250MB virtualenvs across every repository
SHARED_GRAPHIFY_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sosho"
GRAPHIFY_VENV="$SHARED_GRAPHIFY_DIR/venv-graphify"
if [ ! -x "$GRAPHIFY_VENV/bin/python" ]; then
    echo "Initializing shared Graphify environment in $GRAPHIFY_VENV..."
    mkdir -p "$SHARED_GRAPHIFY_DIR"
    python3 -m venv "$GRAPHIFY_VENV"
    "$GRAPHIFY_VENV/bin/pip" install -q -U pip
    "$GRAPHIFY_VENV/bin/pip" install -q "graphifyy[mcp]"
fi

# Ensure graphify skill is copied to workspace .pi/skills
if [ ! -d "$TARGET_PI/skills/graphify" ] && [ -d "$SOSHO_PI/skills/graphify" ]; then
    mkdir -p "$TARGET_PI/skills"
    cp -r "$SOSHO_PI/skills/graphify" "$TARGET_PI/skills/"
fi

# Ensure .pi/mcp.json has local graphify server registered using shared venv
if [ ! -f "$TARGET_PI/mcp.json" ] || ! grep -q '"graphify"' "$TARGET_PI/mcp.json" 2>/dev/null; then
    python3 - "$TARGET_PI/mcp.json" "$WORKSPACE" "$GRAPHIFY_VENV/bin/python" <<'PY'
import json, sys, os
mcp_path, ws, py_bin = sys.argv[1], sys.argv[2], sys.argv[3]
data = {"mcpServers": {}}
if os.path.exists(mcp_path):
    try:
        with open(mcp_path) as f:
            data = json.load(f)
    except Exception:
        pass
servers = data.setdefault("mcpServers", {})
servers["graphify"] = {
    "command": py_bin,
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

# 3. Pre-warm the local model (unless skipped).
if [ "$SKIP_WARMUP" != "1" ] && [ -f "$TARGET_PI/models.json" ] && command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
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
                # Check if model server is reachable first
                if curl -fsS -m 2 "$BASE_URL/health" >/dev/null 2>&1; then
                    echo "Pre-warming local model $MODEL_ID (press Ctrl+C to skip, or use --no-warmup)..."
WARM_PAYLOAD="$(python3 - "$MODEL_ID" "$SOSHO_PI/APPEND_SYSTEM.md" <<'PY'
import json, sys, os
model_id, sys_prompt_path = sys.argv[1], sys.argv[2]
content = "You are an autonomous AI coding assistant."
if os.path.isfile(sys_prompt_path):
    try:
        with open(sys_prompt_path) as f:
            content = f.read()
    except Exception:
        pass
print(json.dumps({
    "model": model_id,
    "messages": [
        {"role": "system", "content": content},
        {"role": "user", "content": "Ready. Acknowledge with OK."}
    ],
    "max_tokens": 1,
    "temperature": 0,
}))
PY
)"
                    if curl -s -m 180 -o /dev/null -H 'Content-Type: application/json' \
                        -X POST "$BASE_URL/chat/completions" --data-binary "$WARM_PAYLOAD"; then
                        echo "Model ready."
                    else
                        echo "Warning: model warm-up timed out or returned error; continuing anyway."
                    fi
                fi
            fi
            ;;
    esac
fi

# 4. Mount list
MOUNTS=(
    -v "$WORKSPACE:$WORKSPACE"
    -v "$TARGET_PI:$TARGET_PI"
    -v "$SHARED_GRAPHIFY_DIR:$SHARED_GRAPHIFY_DIR"
)

# Mount user git config if present (so commits have author name/email)
[ -f "$HOME/.gitconfig" ] && MOUNTS+=(-v "$HOME/.gitconfig:$HOME/.gitconfig:ro")

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
    "${FORWARD_ARGS[@]}"
